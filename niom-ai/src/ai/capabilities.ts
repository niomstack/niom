/**
 * Capability Registry — dynamic system prompt composition.
 *
 * Instead of hardcoding every NIOM capability into a massive system prompt,
 * each module registers its capabilities here. The system prompt is then
 * assembled dynamically at runtime, so new features are automatically
 * surfaced to the AI without manual prompt editing.
 *
 * This follows the AI SDK v6 pattern of keeping tool-level descriptions
 * on the tools themselves, while the system prompt provides higher-level
 * capability awareness and behavioral instructions.
 */

// ── Types ──

export interface Capability {
    /** Unique ID for deduplication */
    id: string;
    /** Human-readable name shown in the prompt */
    name: string;
    /** Category for grouping in the prompt */
    category: "core" | "tools" | "background" | "context" | "integration";
    /** Description of what this capability does — injected into the system prompt */
    description: string;
    /** Whether this capability is currently active/available */
    enabled: () => boolean;
    /** Optional behavioral instructions for the AI */
    instructions?: string;
    /** Optional examples of when to use this capability */
    examples?: string[];
}

// ── Registry ──

const capabilities: Map<string, Capability> = new Map();

/**
 * Register a capability. Idempotent — re-registering overwrites.
 */
export function registerCapability(cap: Capability): void {
    capabilities.set(cap.id, cap);
}

/**
 * Get all registered, enabled capabilities grouped by category.
 */
export function getActiveCapabilities(): Map<string, Capability[]> {
    const grouped = new Map<string, Capability[]>();
    for (const cap of capabilities.values()) {
        if (!cap.enabled()) continue;
        const list = grouped.get(cap.category) || [];
        list.push(cap);
        grouped.set(cap.category, list);
    }
    return grouped;
}

/**
 * Build the dynamic capabilities section of the system prompt.
 * Generates markdown that describes all active capabilities.
 */
export function buildCapabilitiesPrompt(): string {
    const grouped = getActiveCapabilities();
    if (grouped.size === 0) return "";

    const sections: string[] = [];

    // Category display order and labels
    const categoryMeta: Record<string, { label: string; preamble?: string }> = {
        core: { label: "Core Capabilities" },
        tools: { label: "Tools", preamble: "You have access to the following tool categories. Use them proactively — don't ask the user to do things you can do yourself." },
        background: { label: "Background Tasks & Scheduling", preamble: "These capabilities run autonomously. **Never tell the user you can't do these things.**" },
        context: { label: "Context Awareness" },
        integration: { label: "Integrations" },
    };

    for (const category of ["core", "tools", "background", "context", "integration"]) {
        const caps = grouped.get(category);
        if (!caps || caps.length === 0) continue;

        const meta = categoryMeta[category] || { label: category };
        const lines: string[] = [`## ${meta.label}`];
        if (meta.preamble) lines.push(meta.preamble);
        lines.push("");

        for (const cap of caps) {
            lines.push(`### ${cap.name}`);
            lines.push(cap.description);

            if (cap.instructions) {
                lines.push("");
                lines.push(cap.instructions);
            }

            if (cap.examples && cap.examples.length > 0) {
                lines.push("");
                lines.push("Examples:");
                for (const ex of cap.examples) {
                    lines.push(`- ${ex}`);
                }
            }

            lines.push("");
        }

        sections.push(lines.join("\n"));
    }

    return sections.join("\n");
}

// ── Built-in Capability Registrations ──
// Each module should call registerCapability() at import time.
// These are the core ones that live here; others are registered by their own modules.

registerCapability({
    id: "file-operations",
    name: "File Operations",
    category: "tools",
    description: "Read, write, list, and delete files and directories.",
    enabled: () => true,
    instructions: `- Prefer absolute paths derived from the workspace to avoid ambiguity
- When the user says "the fragments project", search for it first
- Show relevant context before asking for confirmation on destructive ops`,
});

registerCapability({
    id: "shell-commands",
    name: "Shell Commands",
    category: "tools",
    description: "Execute shell commands in the user's workspace.",
    enabled: () => true,
    instructions: `- Always set the \`cwd\` to the workspace unless the command needs a different directory
- For read-only commands (ls, cat, git status), just run them
- For write commands, explain what the command will do`,
});

registerCapability({
    id: "web-access",
    name: "Web Search & Browsing",
    category: "tools",
    description: "Search the web and fetch/read web pages.",
    enabled: () => true,
});

registerCapability({
    id: "system-info",
    name: "System Information",
    category: "tools",
    description: "Query CPU, memory, disk, platform, and uptime.",
    enabled: () => true,
});

registerCapability({
    id: "task-scheduling",
    name: "Background Tasks & Scheduling",
    category: "background",
    description: "You CAN schedule recurring tasks and run autonomously in the background. NIOM has a built-in task scheduler — no cron jobs or external tools needed.",
    enabled: () => true,
    instructions: "When a user asks you to do something regularly, on a schedule, or as a long-running background job, confidently set it up. Just acknowledge what the user wants and it will be created automatically.",
    examples: [
        '"Every 2 days, research AI topics and suggest articles" → recurring background task',
        '"Monitor my project for security issues weekly" → recurring background task',
        '"Research this topic thoroughly and give me a report" → one-shot background task',
        '"Generate content ideas every Monday" → recurring background task',
    ],
});
