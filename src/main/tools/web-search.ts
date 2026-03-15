/**
 * webSearch Tool
 *
 * Searches the web using DuckDuckGo's HTML search (no API key required).
 * Parses search results from the response HTML. Falls back to a lite
 * version if the full parser fails.
 *
 * Pack: Web (primitive)
 * Approval: auto
 */

import { tool } from "ai";
import { z } from "zod";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, timed } from "./helpers";

/** Maximum number of results to return. */
const MAX_RESULTS = 8;

/** Data returned per search result. */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Data returned by webSearch on success. */
interface WebSearchData {
  query: string;
  results: SearchResult[];
  resultCount: number;
}

export const webSearchTool = tool({
  description:
    "Search the web for information using DuckDuckGo. " +
    "Returns structured results with titles, URLs, and snippets. " +
    "Use this when the user asks to look something up, find current information, " +
    "or needs data that may not be in your training data.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
    maxResults: z.number().optional().describe(
      `Maximum number of results to return. Defaults to ${MAX_RESULTS}.`,
    ),
  }),
  execute: async (input): Promise<SkillResult<WebSearchData | null>> => {
    return timed(async () => {
      const query = input.query.trim();
      if (!query) {
        return error("Search query cannot be empty.", { domain: "web" });
      }

      const maxResults = Math.min(input.maxResults || MAX_RESULTS, MAX_RESULTS);

      try {
        const results = await searchDuckDuckGo(query, maxResults);

        if (results.length === 0) {
          return success<WebSearchData>(
            { query, results: [], resultCount: 0 },
            `No results found for "${query}".`,
            { domain: "web" },
            { confidence: 0.3 },
          );
        }

        return success<WebSearchData>(
          {
            query,
            results,
            resultCount: results.length,
          },
          `Found ${results.length} results for "${query}".`,
          { domain: "web" },
          {
            suggestions: ["fetchUrl"],
          },
        );
      } catch (e) {
        return error(
          `Web search failed: ${e instanceof Error ? e.message : String(e)}`,
          { domain: "web" },
        );
      }
    });
  },
});

// ─── DuckDuckGo Search ───────────────────────────────────────────────

/**
 * Search DuckDuckGo via the HTML endpoint (no API key needed).
 * Parses result titles, URLs, and snippets from the response.
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "NIOM Desktop Agent/1.0",
      "Accept": "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseResults(html, maxResults);
}

/**
 * Parse search results from DuckDuckGo HTML response.
 * DuckDuckGo's HTML endpoint returns results in .result class divs.
 */
function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks: each result has a title link and snippet
  const resultBlocks = html.match(/<div class="links_main links_deep result__body">[\s\S]*?<\/div>/g)
    || html.match(/<div class="result__body">[\s\S]*?<\/div>/g)
    || [];

  for (const block of resultBlocks) {
    if (results.length >= maxResults) break;

    // Extract title and URL
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    let url = titleMatch[1];
    const titleHtml = titleMatch[2];

    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    // Clean title: strip HTML tags
    const title = titleHtml.replace(/<[^>]+>/g, "").trim();

    // Extract snippet
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
      || block.match(/<span[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/span>/);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  // Fallback: try a more generic pattern if the specific one failed
  if (results.length === 0) {
    const linkMatches = html.matchAll(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g);
    const seen = new Set<string>();

    for (const match of linkMatches) {
      if (results.length >= maxResults) break;

      let url = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();

      // Skip DuckDuckGo internal links
      if (url.includes("duckduckgo.com") || url.includes("duck.co")) continue;

      // Extract actual URL from redirect
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      if (text && url && text.length > 5 && !seen.has(url)) {
        seen.add(url);
        results.push({ title: text, url, snippet: "" });
      }
    }
  }

  return results;
}
