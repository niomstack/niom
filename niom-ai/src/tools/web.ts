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
 * Tavily Search API (free tier: 1000 queries/month).
 * Built for AI agents — returns structured results with relevance scoring.
 * Requires TAVILY_API_KEY in config.search.api_key with provider "tavily".
 */
async function searchTavily(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: limit,
            search_depth: "basic",
            include_answer: false,
        }),
    });

    if (!response.ok) {
        throw new Error(`Tavily Search API error: HTTP ${response.status}`);
    }

    const data = await response.json() as any;
    const results: SearchResult[] = [];

    for (const item of (data.results || [])) {
        if (results.length >= limit) break;
        results.push({
            title: item.title || "",
            url: item.url || "",
            snippet: (item.content || "").slice(0, 300),
        });
    }

    return results;
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
 * DuckDuckGo search (no API key needed).
 * 
 * Strategy: try DDG Lite first (simplest HTML, most reliable parsing),
 * then fall back to standard HTML endpoint. Includes retry logic for
 * rate limiting or transient failures.
 */
async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    // Try Lite endpoint first — simpler HTML, easier to parse
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const results = await searchDDGLite(query, limit);
            if (results.length > 0) return results;
        } catch (err: any) {
            console.log(`[search] DDG Lite attempt ${attempt + 1} failed: ${err.message}`);
        }
        // Wait before retry
        if (attempt < 1) await new Promise(r => setTimeout(r, 2000));
    }

    // Fallback — standard HTML endpoint
    try {
        return await searchDDGHtml(query, limit);
    } catch {
        return [];
    }
}

/**
 * DuckDuckGo Lite — minimal HTML, table-based layout.
 * Much simpler to parse than the standard endpoint.
 */
async function searchDDGLite(query: string, limit: number): Promise<SearchResult[]> {
    const response = await fetch("https://lite.duckduckgo.com/lite/", {
        method: "POST",
        headers: {
            "User-Agent": BROWSER_UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        },
        body: `q=${encodeURIComponent(query)}`,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const results: SearchResult[] = [];

    // DDG Lite uses a table layout. Each result is in rows:
    //   Row 1: link/title   Row 2: snippet   Row 3: URL display
    // We extract links that have class="result-link"
    const linkRegex = /class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]*)</gi;
    const snippetRegex = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
        if (links.length >= limit * 2) break; // collect extra in case of dupes
        const url = match[1].trim();
        const title = match[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
        if (url && title && !url.includes("duckduckgo.com")) {
            links.push({ url, title });
        }
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
        snippets.push(
            match[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim()
        );
    }

    const seenUrls = new Set<string>();
    for (let i = 0; i < links.length && results.length < limit; i++) {
        const { url, title } = links[i];
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        results.push({
            title,
            url,
            snippet: (snippets[i] || "").slice(0, 300),
        });
    }

    return results;
}

/**
 * DuckDuckGo standard HTML endpoint — fallback if Lite fails.
 */
async function searchDDGHtml(query: string, limit: number): Promise<SearchResult[]> {
    const response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
            "User-Agent": BROWSER_UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://duckduckgo.com/",
            "Origin": "https://duckduckgo.com",
        },
        body: `q=${encodeURIComponent(query)}&b=`,
    });

    const html = await response.text();
    const results: SearchResult[] = [];
    const resultBlocks = html.split(/class="result[\s"]/g).slice(1);

    for (const block of resultBlocks) {
        if (results.length >= limit) break;

        const urlMatch = block.match(/href="([^"]*uddg=[^"]+)"/);
        const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:td|a|span)>/);

        if (urlMatch) {
            let url = urlMatch[1];
            const uddgMatch = url.match(/uddg=([^&]+)/);
            if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

            const title = titleMatch
                ? titleMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
                : "";

            const snippet = snippetMatch
                ? snippetMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
                : "";

            if (url && !url.includes("duckduckgo.com")) {
                results.push({ title, url, snippet: snippet.slice(0, 300) });
            }
        }
    }

    return results;
}

// ── Tools ──

export const webTools = {
    fetchUrl: tool({
        description: "Fetch and extract content from a web page. Returns readable text with metadata (title, description, word count, headings). Supports extracting page links for follow-up navigation. Use this to read a specific URL.",
        inputSchema: z.object({
            url: z.string().url().describe("The URL to fetch"),
            maxLength: z.number().int().min(1000).max(20000).optional().describe("Max content length to return (default: 8000 chars)"),
            extractLinks: z.boolean().optional().describe("If true, also extract links from the page (default: false)"),
        }),
        execute: async ({ url, maxLength, extractLinks }) => {
            const limit = maxLength ?? 8000;

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
                        content: raw.slice(0, limit),
                        truncated: raw.length > limit,
                        byteSize: raw.length,
                    };
                }

                // For HTML, extract readable content + metadata
                if (contentType.includes("text/html")) {
                    try {
                        const dom = new JSDOM(raw, { url });
                        const doc = dom.window.document;

                        // Extract metadata
                        const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content") || undefined;
                        const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || undefined;
                        const lang = doc.documentElement?.getAttribute("lang") || undefined;

                        // Extract headings for structure
                        const headings: string[] = [];
                        doc.querySelectorAll("h1, h2, h3").forEach((h: Element) => {
                            const text = h.textContent?.trim();
                            if (text) headings.push(`${h.tagName}: ${text}`);
                        });

                        // Extract links if requested
                        let links: Array<{ text: string; href: string }> | undefined;
                        if (extractLinks) {
                            links = [];
                            doc.querySelectorAll("a[href]").forEach((a: Element) => {
                                const href = a.getAttribute("href");
                                const text = a.textContent?.trim();
                                if (href && text && !href.startsWith("#") && !href.startsWith("javascript:")) {
                                    try {
                                        const resolved = new URL(href, url).href;
                                        links!.push({ text: text.slice(0, 100), href: resolved });
                                    } catch { /* skip malformed URLs */ }
                                }
                            });
                            // Deduplicate and limit
                            const seen = new Set<string>();
                            links = links.filter(l => {
                                if (seen.has(l.href)) return false;
                                seen.add(l.href);
                                return true;
                            }).slice(0, 50);
                        }

                        // Extract readable content
                        const reader = new Readability(doc);
                        const article = reader.parse();

                        if (article?.textContent) {
                            const text = article.textContent.replace(/\s+/g, " ").trim();
                            const wordCount = text.split(/\s+/).length;

                            return {
                                url,
                                title: article.title || undefined,
                                description: metaDesc,
                                language: lang,
                                canonical,
                                contentType: "html",
                                wordCount,
                                headings: headings.slice(0, 20),
                                content: text.slice(0, limit),
                                truncated: text.length > limit,
                                ...(links ? { links } : {}),
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
                        content: text.slice(0, limit),
                        truncated: text.length > limit,
                    };
                }

                // Plain text
                return {
                    url,
                    contentType: "text",
                    content: raw.slice(0, limit),
                    truncated: raw.length > limit,
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

            // Provider chain: API providers (optional upgrade) → DuckDuckGo (zero-config default)
            // DDG always works out of the box. Users can upgrade by setting an API key.
            const config = loadConfig();
            const providers: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = [];

            if (config.search.provider === "tavily" && config.search.api_key) {
                providers.push({
                    name: "tavily",
                    fn: () => searchTavily(query, limit, config.search.api_key),
                });
            }

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
