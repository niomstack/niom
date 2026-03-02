import { tool } from "ai";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { loadConfig } from "../config.js";

// Shared browser-like User-Agent — many sites block non-browser UAs
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Rate Limiter ──
// DuckDuckGo blocks rapid successive requests. This ensures minimum 2s gap.

let lastSearchTime = 0;
const SEARCH_COOLDOWN_MS = 2000;

async function waitForSearchCooldown(): Promise<void> {
    const elapsed = Date.now() - lastSearchTime;
    if (elapsed < SEARCH_COOLDOWN_MS) {
        await new Promise(resolve => setTimeout(resolve, SEARCH_COOLDOWN_MS - elapsed));
    }
    lastSearchTime = Date.now();
}

// ── Search Providers ──

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * Brave Search API (free tier: 2000 queries/month).
 * Requires BRAVE_API_KEY in config.search.api_key with provider "brave".
 */
async function searchBrave(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${limit}`,
        {
            headers: {
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": apiKey,
            },
        },
    );

    if (!response.ok) {
        throw new Error(`Brave Search API error: HTTP ${response.status}`);
    }

    const data = await response.json() as any;
    const results: SearchResult[] = [];

    for (const item of (data.web?.results || [])) {
        if (results.length >= limit) break;
        results.push({
            title: item.title || "",
            url: item.url || "",
            snippet: (item.description || "").slice(0, 300),
        });
    }

    return results;
}

/**
 * DuckDuckGo HTML search (no API key needed).
 * Requires specific headers to bypass bot detection.
 */
async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);

    const response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
            "User-Agent": BROWSER_UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://duckduckgo.com/",
            "Origin": "https://duckduckgo.com",
            "Sec-Fetch-Site": "same-site",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "document",
        },
        body: `q=${encoded}&b=`,
    });

    const html = await response.text();
    const results: SearchResult[] = [];
    const resultBlocks = html.split(/class="result\s/g).slice(1);

    for (const block of resultBlocks) {
        if (results.length >= limit) break;

        const urlMatch = block.match(/class="result__a"\s+href="([^"]+)"/);
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

        if (urlMatch && titleMatch) {
            let url = urlMatch[1];
            const uddgMatch = url.match(/uddg=([^&]+)/);
            if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1]);
            }

            const snippet = snippetMatch
                ? snippetMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
                : "";

            results.push({
                title: titleMatch[1].trim(),
                url,
                snippet: snippet.slice(0, 300),
            });
        }
    }

    return results;
}

// ── Tools ──

export const webTools = {
    fetchUrl: tool({
        description: "Fetch the content of a web page and return it as readable text. Use this when the user provides a URL or you need to read a specific web page.",
        inputSchema: z.object({
            url: z.string().url().describe("The URL to fetch"),
        }),
        execute: async ({ url }) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);

                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: {
                        "User-Agent": BROWSER_UA,
                        "Accept": "text/html,application/xhtml+xml,application/json,text/plain",
                        "Accept-Language": "en-US,en;q=0.9",
                    },
                });
                clearTimeout(timeout);

                if (!response.ok) {
                    return { error: `HTTP ${response.status}: ${response.statusText}`, url };
                }

                const contentType = response.headers.get("content-type") || "";
                const raw = await response.text();

                // If JSON, return as-is (truncated)
                if (contentType.includes("application/json")) {
                    return {
                        url,
                        contentType: "json",
                        content: raw.slice(0, 8000),
                        truncated: raw.length > 8000,
                    };
                }

                // For HTML, extract readable content
                if (contentType.includes("text/html")) {
                    try {
                        const dom = new JSDOM(raw, { url });
                        const reader = new Readability(dom.window.document);
                        const article = reader.parse();

                        if (article && article.textContent) {
                            const text = article.textContent.replace(/\s+/g, " ").trim();
                            return {
                                url,
                                title: article.title,
                                contentType: "html",
                                content: text.slice(0, 8000),
                                truncated: text.length > 8000,
                            };
                        }
                    } catch {
                        // Fall through to raw text extraction
                    }

                    // Fallback: strip HTML tags
                    const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                    return {
                        url,
                        contentType: "html",
                        content: text.slice(0, 8000),
                        truncated: text.length > 8000,
                    };
                }

                // Plain text
                return {
                    url,
                    contentType: "text",
                    content: raw.slice(0, 8000),
                    truncated: raw.length > 8000,
                };
            } catch (err: any) {
                if (err.name === "AbortError") {
                    return { error: "Request timed out (15s)", url };
                }
                return { error: err.message, url };
            }
        },
    }),

    webSearch: tool({
        description: "Search the web for information. Returns a list of relevant results with titles, URLs, and snippets. Use this when the user wants to look up current information, research a topic, or find resources online.",
        inputSchema: z.object({
            query: z.string().min(1).describe("The search query — must not be empty"),
            maxResults: z.number().min(1).max(10).optional().describe("Number of results (default 5)"),
        }),
        execute: async ({ query, maxResults }) => {
            const limit = maxResults || 5;

            // Guard: reject empty/whitespace queries
            if (!query.trim()) {
                return {
                    query,
                    error: "Empty search query. Provide a specific search query.",
                    results: [],
                };
            }

            // Rate limit: wait for cooldown between searches
            await waitForSearchCooldown();

            // Try providers in order: Brave (if configured), then DuckDuckGo
            const config = loadConfig();
            const providers: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = [];

            if (config.search.provider === "brave" && config.search.api_key) {
                providers.push({
                    name: "brave",
                    fn: () => searchBrave(query, limit, config.search.api_key),
                });
            }

            // DuckDuckGo as default/fallback (no API key needed)
            providers.push({
                name: "duckduckgo",
                fn: () => searchDuckDuckGo(query, limit),
            });

            for (const provider of providers) {
                try {
                    const results = await provider.fn();
                    if (results.length > 0) {
                        return { query, results, provider: provider.name };
                    }
                    console.log(`[search] ${provider.name}: 0 results for "${query.slice(0, 40)}"`);
                } catch (err: any) {
                    console.warn(`[search] ${provider.name} failed:`, err.message);
                }
            }

            return {
                query,
                message: "No results found. Try rephrasing the query or using fetchUrl with a specific URL.",
                results: [],
            };
        },
    }),
};
