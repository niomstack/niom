/**
 * Built-in Skill Packs — Embedded Pack Data
 *
 * Since webpack bundles TypeScript and won't include SKILL.md files,
 * built-in packs are embedded directly here. The SKILL.md files in the
 * packs/ directory serve as the canonical source-of-truth and documentation;
 * this file is the runtime representation.
 *
 * User-installed packs (from ~/.niom/skills/) are still loaded from disk
 * via the loader at runtime.
 */

import type { SkillPack } from "@/shared/skill-types";

// ─── Primitive Packs ─────────────────────────────────────────────────

const osPack: SkillPack = {
  name: "os",
  domain: "os",
  tier: "primitive",
  description: "File system and shell operations — reading, writing, searching, and executing commands on the user's local machine.",
  exemplars: [
    "read this file",
    "what's in my package.json",
    "show me the directory contents",
    "list all files in this folder",
    "find where that function is defined",
    "create a new file with this content",
    "save this to a file",
    "delete that old log file",
    "run the build command",
    "execute npm install",
    "what OS am I running",
    "check my disk space",
    "search for files matching this pattern",
  ],
  negativeExemplars: [
    "tell me a joke",
    "explain quantum physics",
    "write me a poem",
  ],
  tools: [
    {
      name: "readFile",
      description: "Read the contents of a file at the specified path. Returns the file contents as text.",
      exemplars: [
        "read this file",
        "show me what's in this file",
        "open and display the contents",
        "what does this config file say",
      ],
      negativeExemplars: ["read me a story", "read about this topic"],
      approval: "auto",
    },
    {
      name: "listDirectory",
      description: "List all files and subdirectories in a directory. Returns names, sizes, and types.",
      exemplars: [
        "list the files here",
        "show me what's in this folder",
        "what files are in the project",
        "show directory contents",
      ],
      negativeExemplars: ["list the top 5 companies", "list some ideas"],
      approval: "auto",
    },
    {
      name: "systemInfo",
      description: "Get system information including OS, platform, architecture, hostname, and shell.",
      exemplars: [
        "what system am I on",
        "show system info",
        "what OS is this",
      ],
      approval: "auto",
    },
    {
      name: "writeFile",
      description: "Create or overwrite a file at the specified path with the given content. Generates a diff preview when overwriting.",
      exemplars: [
        "create a new file with this content",
        "save this to a file",
        "write this code to a file",
        "update the config file",
        "create a README",
      ],
      negativeExemplars: ["write me a poem", "write an email"],
      approval: "confirm",
    },
    {
      name: "runCommand",
      description: "Execute a shell command. Returns stdout, stderr, and exit code. Has a 30-second timeout.",
      exemplars: [
        "run this command",
        "execute npm install",
        "run the build script",
        "check the git status",
        "install the dependencies",
        "run the tests",
      ],
      negativeExemplars: ["run through the explanation", "run me through the steps"],
      approval: "confirm",
    },
    {
      name: "proposeArtifact",
      description: "Stage a file for user review before writing to disk. Creates a rich preview card where the user can review, edit, then apply.",
      exemplars: [
        "create a project with these files",
        "set up a new application",
        "generate the boilerplate",
        "create a config file",
        "write a comprehensive README",
        "create multiple files",
        "scaffold a new module",
      ],
      negativeExemplars: ["fix this typo", "add a single import line"],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "File operations should return actual content, not summaries. Paths should be resolved and validated. Errors should include the attempted path and reason for failure. Write operations must generate diffs for review. Commands must not be destructive.",
  },
  systemPrompt: `You have direct access to the user's file system and operating system.
When reading files, return the actual content. When listing directories, provide a clear organized view.
Always validate paths before operations. Use absolute paths when possible.
If a path doesn't exist, say so clearly — never fabricate file contents.
For creating new files or significant changes, use proposeArtifact to stage a preview — the user can review and apply.
For small, targeted edits (typos, single-line changes), use writeFile directly.
When running commands, use common tools (npm, git, etc.) and explain what the command does before executing.`,
  source: "builtin:os",
};

const webPack: SkillPack = {
  name: "web",
  domain: "web",
  tier: "primitive",
  description: "Internet access — searching the web and fetching content from URLs.",
  exemplars: [
    "search the web for this",
    "look this up online",
    "find information about",
    "google this for me",
    "what does the internet say about",
    "fetch this URL",
    "get the contents of this webpage",
    "check the latest news on",
    "find the documentation for",
  ],
  negativeExemplars: [
    "search my files",
    "find in this document",
    "look through the codebase",
  ],
  tools: [
    {
      name: "webSearch",
      description: "Search the web for information. Returns structured search results with titles, snippets, and URLs.",
      exemplars: [
        "search for this online",
        "look this up on the web",
        "find information about this topic",
        "what are the latest results for",
      ],
      negativeExemplars: ["search through my code", "find this in the project files"],
      approval: "auto",
    },
    {
      name: "fetchUrl",
      description: "Fetch and extract the text content from a URL. Returns the page content as readable text.",
      exemplars: [
        "fetch this URL for me",
        "get the content of this page",
        "read this webpage",
        "what does this link say",
      ],
      negativeExemplars: ["fetch my local file"],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "Web searches should return relevant, recent results. URL fetches should extract readable content, not raw HTML. Always cite sources with URLs.",
  },
  systemPrompt: `You can search the web and fetch content from URLs.
When searching, provide relevant and recent results. Always cite your sources.
When fetching URLs, extract the meaningful content — not raw HTML or scripts.
Summarize long pages unless the user asks for the full content.`,
  source: "builtin:web",
};

const computerUsePack: SkillPack = {
  name: "computer-use",
  domain: "computer-use",
  tier: "primitive",
  description: "GUI automation — taking screenshots, clicking, typing, scrolling, and interacting with the desktop visually.",
  exemplars: [
    "take a screenshot",
    "click on that button",
    "type this text",
    "scroll down",
    "move the mouse to",
    "press enter",
    "what's on my screen",
    "show me what I'm looking at",
    "interact with this UI element",
  ],
  negativeExemplars: [
    "write some code",
    "search for files",
    "look this up online",
  ],
  tools: [
    {
      name: "screenshot",
      description: "Capture a screenshot of the current screen or a specific region.",
      exemplars: ["take a screenshot", "capture my screen", "show me what's on screen"],
      approval: "auto",
    },
    {
      name: "mouseClick",
      description: "Click at specific screen coordinates. Supports left, right, and double click.",
      exemplars: ["click on that", "click the button", "right-click there"],
      approval: "confirm",
    },
    {
      name: "mouseMove",
      description: "Move the mouse cursor to specific screen coordinates.",
      exemplars: ["move the mouse to", "hover over that"],
      approval: "confirm",
    },
    {
      name: "typeText",
      description: "Type text at the current cursor position.",
      exemplars: ["type this text", "enter this value", "fill in the field"],
      approval: "confirm",
    },
    {
      name: "pressKey",
      description: "Press a keyboard key or key combination (e.g. Enter, Cmd+C, Alt+Tab).",
      exemplars: ["press enter", "hit escape", "use the keyboard shortcut"],
      approval: "confirm",
    },
    {
      name: "scroll",
      description: "Scroll up or down by a specified amount at the current position.",
      exemplars: ["scroll down", "scroll to the top", "scroll up a bit"],
      approval: "auto",
    },
    {
      name: "getActiveWindow",
      description: "Get information about the currently focused window — title, app name, bounds.",
      exemplars: ["what window is active", "which app am I in", "what's the current window"],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "GUI operations must verify success visually. Screenshots should confirm the expected state was reached. Mouse/keyboard actions should target the correct coordinates.",
  },
  systemPrompt: `You can interact with the user's desktop GUI — taking screenshots, clicking, typing, and scrolling.
Always take a screenshot first to understand the current state before performing actions.
Be precise with coordinates. Confirm actions succeeded by taking a follow-up screenshot.
Computer Use tools that modify state (click, type, key press) require user approval.`,
  source: "builtin:computer-use",
};

// ─── Intent Packs ────────────────────────────────────────────────────

const codePack: SkillPack = {
  name: "code",
  domain: "code",
  tier: "intent",
  description: "Software development — writing, reading, debugging, refactoring, and understanding code.",
  exemplars: [
    "fix this bug",
    "write a function that",
    "refactor this code",
    "debug this error",
    "add TypeScript types",
    "explain what this code does",
    "find where this function is defined",
    "run the tests",
    "install the dependencies",
    "set up the project",
    "deploy this application",
    "optimize this query",
    "review this pull request",
  ],
  negativeExemplars: [
    "write an email",
    "plan my day",
    "research the market",
    "create a presentation",
  ],
  tools: [
    {
      name: "searchFiles",
      description: "Search for files by name pattern or content within a directory tree.",
      exemplars: [
        "find files matching this pattern",
        "search the codebase for this string",
        "where is this function used",
        "grep for this text",
      ],
      negativeExemplars: ["search the web", "find information online"],
      approval: "auto",
    },
    {
      name: "editFile",
      description: "Apply targeted edits to an existing file — find and replace specific content.",
      exemplars: [
        "change this line to",
        "replace this function with",
        "update the import statement",
        "fix the typo on line 42",
      ],
      approval: "confirm",
    },
    {
      name: "readFileRange",
      description: "Read specific line ranges from a file — useful for viewing functions or sections.",
      exemplars: [
        "show me lines 10-50",
        "read the function starting at line 30",
        "show the imports section",
      ],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "Code should be syntactically valid, well-documented, and follow the project's existing conventions. Edits should be minimal and targeted — never rewrite entire files.",
  },
  systemPrompt: `You are a senior software engineer. Write clean, well-documented code.
Follow the project's existing conventions and style. Prefer targeted edits over full rewrites.
When debugging, explain the root cause and the fix. When refactoring, preserve behavior.
Run tests after changes when possible. Use TypeScript over JavaScript when appropriate.
Always read the relevant code before making changes — never edit blind.`,
  source: "builtin:code",
};

const researchPack: SkillPack = {
  name: "research",
  domain: "research",
  tier: "intent",
  description: "Information synthesis — deep research, fact-finding, analysis, and report generation.",
  exemplars: [
    "research this topic",
    "find the latest information on",
    "summarize the key findings",
    "compare these approaches",
    "what are the pros and cons",
    "write a comprehensive analysis",
    "investigate this claim",
    "gather data about",
    "literature review on",
  ],
  negativeExemplars: [
    "fix this bug",
    "write some code",
    "take a screenshot",
  ],
  tools: [
    {
      name: "deepResearch",
      description: "Conduct in-depth research on a topic — multiple web searches, source synthesis, and structured output.",
      exemplars: [
        "do a deep dive on this topic",
        "research this thoroughly",
        "investigate and report back",
        "comprehensive analysis of",
      ],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "Research should cite sources with URLs. Claims should be verifiable. Reports should be structured with clear sections. Multiple perspectives should be represented.",
  },
  systemPrompt: `You are a research analyst. Conduct thorough, well-sourced research.
Always cite your sources with URLs. Present multiple perspectives on contested topics.
Structure reports with clear headings, key findings, and conclusions.
Distinguish between established facts, expert opinions, and speculation.
When asked to compare, use structured tables or side-by-side analysis.`,
  source: "builtin:research",
};

const businessPack: SkillPack = {
  name: "business",
  domain: "business",
  tier: "intent",
  description: "Business analysis, strategy, operations — market research, competitive analysis, planning, and professional communication.",
  exemplars: [
    "analyze the competition",
    "write a business proposal",
    "create a project plan",
    "summarize the quarterly results",
    "draft a professional email",
    "prepare the meeting agenda",
    "estimate the market size",
    "develop a go-to-market strategy",
    "review the financial projections",
  ],
  negativeExemplars: [
    "write a poem",
    "debug this code",
    "take a screenshot",
  ],
  tools: [
    {
      name: "deepResearch",
      description: "Conduct market research, competitive analysis, or business intelligence gathering.",
      exemplars: [
        "research our competitors",
        "find market data on",
        "analyze the industry trends",
        "benchmark against competitors",
      ],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "Business analysis should be data-driven with cited sources. Plans should include timelines, risks, and metrics. Communications should be professional and concise.",
  },
  systemPrompt: `You are a business analyst and strategist. Think data-first.
Ground recommendations in evidence — cite sources, include numbers, reference benchmarks.
Structure deliverables professionally: executive summary, analysis, recommendations, next steps.
For financial content, clearly state assumptions. For strategy, identify risks and mitigations.
Write communications in a professional but not overly formal tone.`,
  source: "builtin:business",
};

const creativePack: SkillPack = {
  name: "creative",
  domain: "creative",
  tier: "intent",
  description: "Creative content — writing, storytelling, copywriting, social media, design briefs, and artistic expression.",
  exemplars: [
    "write a blog post about",
    "create social media content",
    "draft a newsletter",
    "write a story",
    "come up with a tagline",
    "design a landing page concept",
    "write marketing copy",
    "brainstorm ideas for",
    "write a creative brief",
  ],
  negativeExemplars: [
    "write code",
    "run a command",
    "analyze the data",
  ],
  tools: [
    {
      name: "deepResearch",
      description: "Research creative trends, content strategies, or gather inspiration and reference material.",
      exemplars: [
        "research content trends",
        "find inspiration for",
        "analyze successful campaigns",
        "look at what competitors are posting",
      ],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "Creative content should be original, engaging, and audience-appropriate. Tone should match the brand or context. Copy should be concise and impactful.",
  },
  systemPrompt: `You are a creative writer and content strategist. Write engaging, original content.
Match the tone to the audience — formal for B2B, conversational for social media, inspirational for storytelling.
When brainstorming, provide multiple distinct options rather than variations of one idea.
For copy, less is more. For long-form content, structure with compelling hooks and clear sections.
Always consider the target audience and distribution channel.`,
  source: "builtin:creative",
};

const personalPack: SkillPack = {
  name: "personal",
  domain: "personal",
  tier: "intent",
  description: "Personal productivity — reminders, scheduling, task management, personal notes, and daily planning.",
  exemplars: [
    "remind me to",
    "plan my day",
    "add this to my to-do list",
    "set a reminder for",
    "what's on my schedule",
    "help me organize my tasks",
    "keep track of this",
    "create a checklist",
    "summarize my notes",
  ],
  negativeExemplars: [
    "write production code",
    "search the web deeply",
    "analyze market data",
  ],
  tools: [
    {
      name: "notifyUser",
      description: "Send the user a native desktop notification with a title and message.",
      exemplars: [
        "notify me when",
        "send me a reminder",
        "alert me about",
        "let me know when",
      ],
      approval: "auto",
    },
  ],
  evaluation: {
    rubric: "Personal tasks should be actionable and time-bound. Reminders should include clear descriptions. Checklists should be organized by priority.",
  },
  systemPrompt: `You are a thoughtful personal assistant. Help the user stay organized and productive.
When planning, ask about priorities and deadlines. Break large tasks into actionable steps.
For reminders, confirm the time and what exactly should be reminded.
Be proactive about suggesting better organization when you notice patterns.
Keep a warm, supportive tone — this is personal, not corporate.`,
  source: "builtin:personal",
};

// ─── Fallback Pack ───────────────────────────────────────────────────

const generalPack: SkillPack = {
  name: "general",
  domain: "general",
  tier: "fallback",
  description: "General-purpose fallback — handles ambiguous queries, greetings, and conversations that don't clearly map to any specific domain.",
  exemplars: [
    "hello",
    "how are you",
    "thanks",
    "yes",
    "no",
    "continue",
    "tell me more",
    "help me with something",
    "what can you do",
  ],
  tools: [],
  evaluation: {
    rubric: "General responses should be helpful and conversational. When a query is ambiguous, ask clarifying questions rather than guessing the domain.",
  },
  systemPrompt: `You are NIOM, a helpful, knowledgeable, and direct AI assistant.
You run locally on the user's desktop. You are thoughtful, concise, and friendly.
When you don't know something, say so honestly.
If the user's request is ambiguous, ask a clarifying question to better understand what they need.
You have access to all available tools when no specific domain is detected.`,
  source: "builtin:general",
};

// ─── Exports ─────────────────────────────────────────────────────────

/**
 * All built-in Skill Packs, sorted: primitive → intent → fallback.
 * This is the runtime source for the Skill Tree graph builder.
 */
export const BUILTIN_PACKS: SkillPack[] = [
  // Primitive (system-level)
  osPack,
  webPack,
  computerUsePack,
  // Intent (domain reasoning)
  codePack,
  researchPack,
  businessPack,
  creativePack,
  personalPack,
  // Fallback
  generalPack,
];

/** Quick lookup: domain name → pack */
export const PACK_BY_DOMAIN: Record<string, SkillPack> = Object.fromEntries(
  BUILTIN_PACKS.map((p) => [p.domain, p]),
);

/** Primitive domain names — used for relaxed cutoff in traversal */
export const PRIMITIVE_DOMAINS = new Set(
  BUILTIN_PACKS.filter((p) => p.tier === "primitive").map((p) => p.domain),
);

/** All unique tool names across all packs */
export const ALL_TOOL_NAMES = [
  ...new Set(BUILTIN_PACKS.flatMap((p) => p.tools.map((t) => t.name))),
];
