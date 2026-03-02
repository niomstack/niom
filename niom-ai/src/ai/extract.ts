/**
 * Fact extraction — automatically extract learnings from conversations.
 *
 * After a meaningful conversation finishes, we use a fast model to extract
 * key facts about the user that should persist in long-term memory (brain).
 *
 * This runs asynchronously and doesn't block the response.
 */

import { generateText } from "ai";
import { getModelForRole } from "./providers.js";
import { MemoryStore } from "../memory/store.js";
import { loadConfig } from "../config.js";

/**
 * Extract facts from a completed conversation and store in brain.
 *
 * @param messages - The conversation messages
 * @param threadTitle - The thread title for context
 */
export async function extractFactsFromConversation(
    messages: Array<{ role: string; content: string }>,
    threadTitle: string,
): Promise<void> {
    // Skip short conversations (< 4 messages — likely just a quick question)
    if (messages.length < 4) return;

    // Skip if no gateway key configured
    const config = loadConfig();
    if (!config.gateway_key) return;

    const store = MemoryStore.getInstance();
    const existingFacts = store.getBrain().facts;

    // Build a concise conversation summary for fact extraction
    const conversationSummary = messages
        .slice(-20) // Last 20 messages max
        .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
        .join("\n\n");

    try {
        const model = getModelForRole("fast", config);

        const result = await generateText({
            model,
            temperature: 0.1,
            system: `You are a memory extraction system. Your job is to extract factual information about the USER from conversations they have with an AI assistant called NIOM.

Extract ONLY concrete facts about the user — NOT about the task they were doing. Focus on:
- Their name, location, timezone
- Technology preferences (languages, frameworks, tools)
- Work projects and their nature
- Communication style preferences
- Recurring patterns or habits

RULES:
- Return one fact per line, no bullets or numbering
- Each fact should be a complete, standalone sentence
- Be specific — "User prefers TypeScript" not "User likes programming"
- Do NOT extract facts about the conversation itself
- Do NOT extract facts about what NIOM did
- Return EMPTY RESPONSE if no user facts are present
- Do NOT duplicate these existing facts: ${existingFacts.length > 0 ? existingFacts.join("; ") : "(none yet)"}`,
            messages: [
                {
                    role: "user",
                    content: `Extract key facts about the USER from this conversation titled "${threadTitle}":\n\n${conversationSummary.slice(0, 4000)}`,
                },
            ],
        });

        const text = result.text?.trim();
        if (!text) return;

        // Parse facts (one per line)
        const facts = text
            .split("\n")
            .map(f => f.trim())
            .filter(f => f.length > 5 && f.length < 200)
            .filter(f => !f.startsWith("-") || (f = f.slice(1).trim(), true)); // strip optional bullet

        for (const fact of facts.slice(0, 5)) { // Max 5 facts per conversation
            store.learnFact(fact);
        }

        if (facts.length > 0) {
            console.log(`[brain] Extracted ${facts.length} fact(s) from "${threadTitle}"`);
        }
    } catch (err: any) {
        // Non-critical — don't crash if extraction fails
        console.warn(`[brain] Fact extraction failed:`, err.message);
    }
}
