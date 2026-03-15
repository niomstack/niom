/**
 * fetchUrl Tool
 *
 * Fetches a URL and extracts readable text content.
 * Strips HTML tags, scripts, styles, and returns clean text.
 *
 * Pack: Web (primitive)
 * Approval: auto
 */

import { tool } from "ai";
import { z } from "zod";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, partial, timed } from "./helpers";

/** Maximum content size to return (50KB of text). */
const MAX_CONTENT_SIZE = 50 * 1024;

/** Request timeout (15 seconds). */
const FETCH_TIMEOUT_MS = 15_000;

/** Data returned by fetchUrl on success. */
interface FetchUrlData {
  url: string;
  title: string;
  content: string;
  contentLength: number;
}

export const fetchUrlTool = tool({
  description:
    "Fetch and extract readable text content from a URL. " +
    "Strips HTML and returns clean, readable text. " +
    "Use this to read articles, documentation, or any web page content.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch content from."),
  }),
  execute: async (input): Promise<SkillResult<FetchUrlData | null>> => {
    return timed(async () => {
      const url = input.url.trim();

      // Block local/private network requests
      if (isPrivateUrl(url)) {
        return error(
          "Cannot fetch private or local network URLs for security reasons.",
          { domain: "web" },
        );
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
          headers: {
            "User-Agent": "NIOM Desktop Agent/1.0",
            "Accept": "text/html,text/plain,application/json",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: controller.signal,
          redirect: "follow",
        });

        clearTimeout(timeout);

        if (!response.ok) {
          return error(
            `HTTP ${response.status}: ${response.statusText} for ${url}`,
            { domain: "web" },
          );
        }

        const contentType = response.headers.get("content-type") || "";
        const rawBody = await response.text();

        let content: string;
        let title = "";

        if (contentType.includes("application/json")) {
          // JSON: pretty print
          try {
            const parsed = JSON.parse(rawBody);
            content = JSON.stringify(parsed, null, 2);
          } catch {
            content = rawBody;
          }
        } else if (contentType.includes("text/plain")) {
          content = rawBody;
        } else {
          // HTML: extract title and readable text
          title = extractTitle(rawBody);
          content = htmlToText(rawBody);
        }

        // Truncate if needed
        if (content.length > MAX_CONTENT_SIZE) {
          const truncated = content.slice(0, MAX_CONTENT_SIZE);

          return partial<FetchUrlData>(
            {
              url,
              title,
              content: truncated,
              contentLength: content.length,
            },
            `Fetched "${title || url}" — showing first ${formatSize(MAX_CONTENT_SIZE)} of ${formatSize(content.length)}.`,
            {
              domain: "web",
              truncated: true,
              bytesProcessed: MAX_CONTENT_SIZE,
            },
            { confidence: 0.7 },
          );
        }

        return success<FetchUrlData>(
          {
            url,
            title,
            content,
            contentLength: content.length,
          },
          `Fetched "${title || url}" (${formatSize(content.length)}).`,
          {
            domain: "web",
            bytesProcessed: content.length,
          },
        );
      } catch (e) {
        const message = e instanceof Error
          ? (e.name === "AbortError" ? "Request timed out" : e.message)
          : String(e);

        return error(
          `Failed to fetch ${url}: ${message}`,
          { domain: "web" },
        );
      }
    });
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────

/** Extract <title> from HTML. */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

/** Convert HTML to readable plain text. */
function htmlToText(html: string): string {
  let text = html;

  // Remove scripts, styles, and head
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<head[\s\S]*?<\/head>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Convert structural elements to whitespace
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n\n");
  text = text.replace(/<li[^>]*>/gi, "• ");
  text = text.replace(/<hr[^>]*>/gi, "\n---\n");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n\s*\n/g, "\n\n");
  text = text.trim();

  return text;
}

/** Check if a URL points to a private/local network. */
function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return true; // If we can't parse it, block it
  }
}

/** Format bytes into human-readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
