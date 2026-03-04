/**
 * Research Tools — multi-step web research with synthesis.
 *
 * deepResearch: orchestrates search → read → synthesize into a single tool call.
 * This gives the agent a "compound tool" that does what would normally take
 * 5-10 individual tool calls, saving steps and improving quality.
 */

import { tool } from "ai";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Helpers ──

async function fetchPageContent(url: string, timeout = 12000): Promise<{ title?: string; content: string; url: string } | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": BROWSER_UA,
                "Accept": "text/html,application/xhtml+xml,application/json,text/plain",
                "Accept-Language": "en-US,en;q=0.9",
            },
        });
        clearTimeout(timer);

        if (!response.ok) return null;

        const raw = await response.text();
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("text/html")) {
            try {
                const dom = new JSDOM(raw, { url });
                const reader = new Readability(dom.window.document);
                const article = reader.parse();

                if (article?.textContent) {
                    return {
                        title: article.title || undefined,
                        content: article.textContent.replace(/\s+/g, " ").trim().slice(0, 6000),
                        url,
                    };
                }
            } catch {
                // Fallback to tag stripping
            }
            const stripped = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            return { content: stripped.slice(0, 6000), url };
        }

        return { content: raw.slice(0, 6000), url };
    } catch {
        return null;
    }
}

async function searchWeb(query: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
    // Try configured search provider first, fall back to DuckDuckGo
    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    // Tavily — most reliable for AI agents
    if (config.search.provider === "tavily" && config.search.api_key) {
        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: config.search.api_key,
                    query,
                    max_results: limit,
                    search_depth: "basic",
                    include_answer: false,
                }),
            });

            if (response.ok) {
                const data = await response.json() as any;
                const results = (data.results || []).slice(0, limit).map((r: any) => ({
                    title: r.title || "",
                    url: r.url || "",
                    snippet: (r.content || "").slice(0, 200),
                }));
                if (results.length > 0) return results;
            }
        } catch { /* fall through */ }
    }

    // DuckDuckGo Lite fallback (no API key needed, simpler HTML)
    try {
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

        if (!response.ok) return [];
        const html = await response.text();
        const results: Array<{ title: string; url: string; snippet: string }> = [];

        const linkRegex = /class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]*)</gi;
        const snippetRegex = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

        const links: Array<{ url: string; title: string }> = [];
        let match: RegExpExecArray | null;

        while ((match = linkRegex.exec(html)) !== null) {
            if (links.length >= limit * 2) break;
            const url = match[1].trim();
            const title = match[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
            if (url && title && !url.includes("duckduckgo.com")) {
                links.push({ url, title });
            }
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(
                match[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
            );
        }

        const seenUrls = new Set<string>();
        for (let i = 0; i < links.length && results.length < limit; i++) {
            if (seenUrls.has(links[i].url)) continue;
            seenUrls.add(links[i].url);
            results.push({
                title: links[i].title,
                url: links[i].url,
                snippet: (snippets[i] || "").slice(0, 200),
            });
        }
        return results;
    } catch {
        return [];
    }
}

// ── Deep Research Tool ──

export const researchTools = {
    deepResearch: tool({
        description: "Conduct multi-step web research on a topic. Searches for the topic, reads the top sources, and synthesizes findings into a structured report with citations. Use this for thorough research instead of making many individual webSearch + fetchUrl calls. Returns structured findings with sources.",
        inputSchema: z.object({
            topic: z.string().describe("The research topic or question to investigate"),
            depth: z.enum(["quick", "thorough", "comprehensive"]).optional().describe(
                "Research depth. quick = 3 sources, thorough = 5 sources (default), comprehensive = 8 sources"
            ),
            focusAreas: z.array(z.string()).optional().describe(
                "Optional specific areas to focus on within the topic. E.g., ['pricing', 'features', 'user reviews']"
            ),
        }),
        execute: async ({ topic, depth, focusAreas }) => {
            const sourceCount = depth === "quick" ? 3 : depth === "comprehensive" ? 8 : 5;

            console.log(`[deepResearch] Starting: "${topic}" (${depth || "thorough"}, ${sourceCount} sources)`);

            // Phase 1: Search
            const queries = [topic];
            if (focusAreas?.length) {
                // Add focused sub-queries for each area
                for (const area of focusAreas.slice(0, 3)) {
                    queries.push(`${topic} ${area}`);
                }
            }

            const allResults: Array<{ title: string; url: string; snippet: string }> = [];
            const seenUrls = new Set<string>();

            for (const query of queries) {
                const results = await searchWeb(query, sourceCount);
                for (const r of results) {
                    if (!seenUrls.has(r.url) && allResults.length < sourceCount * 2) {
                        seenUrls.add(r.url);
                        allResults.push(r);
                    }
                }
                // Small delay between searches
                await new Promise(r => setTimeout(r, 1500));
            }

            console.log(`[deepResearch] Found ${allResults.length} unique results, reading top ${sourceCount}`);

            // Phase 2: Read top sources in parallel
            const toRead = allResults.slice(0, sourceCount);
            const readPromises = toRead.map(r => fetchPageContent(r.url));
            const pageResults = await Promise.allSettled(readPromises);

            const sources: Array<{
                title: string;
                url: string;
                snippet: string;
                content?: string;
                readSuccess: boolean;
            }> = [];

            for (let i = 0; i < toRead.length; i++) {
                const result = pageResults[i];
                const searchResult = toRead[i];

                if (result.status === "fulfilled" && result.value) {
                    sources.push({
                        title: result.value.title || searchResult.title,
                        url: searchResult.url,
                        snippet: searchResult.snippet,
                        content: result.value.content,
                        readSuccess: true,
                    });
                } else {
                    sources.push({
                        title: searchResult.title,
                        url: searchResult.url,
                        snippet: searchResult.snippet,
                        readSuccess: false,
                    });
                }
            }

            const successCount = sources.filter(s => s.readSuccess).length;
            console.log(`[deepResearch] Read ${successCount}/${sources.length} sources successfully`);

            // Phase 3: Return structured data for the LLM to synthesize
            return {
                topic,
                depth: depth || "thorough",
                focusAreas: focusAreas || [],
                sourcesSearched: allResults.length,
                sourcesRead: successCount,
                sources,
                instruction: "Synthesize these sources into a well-structured report. Cite sources by number [1], [2], etc. Note any contradictions between sources. If a focus area has limited coverage, say so.",
            };
        },
    }),
};
