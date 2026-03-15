/**
 * Task Templates — Built-in blueprints for common task patterns.
 *
 * Each template provides:
 *   - A specialized system prompt for the task agent
 *   - Fill-in fields the user provides (e.g., topic, scope)
 *   - Configurable checkpoint interval and max steps
 *
 * Templates are TypeScript const for type safety and zero parsing overhead.
 * When the plugin system (M8c) ships, community templates will load as YAML
 * into the same TaskTemplate interface.
 */

import type { TaskTemplate } from "@/shared/task-types";

// ─── Built-in Templates ──────────────────────────────────────────────

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "deep-research",
    name: "Deep Research",
    icon: "🔬",
    category: "research",
    description: "Comprehensive research on any topic with source citations",
    systemPrompt: `You are an expert research analyst. Your task is to conduct thorough, comprehensive research on the given topic.

Research methodology:
1. Start with broad searches to understand the landscape
2. Identify key subtopics and drill into each one
3. Search for recent data, statistics, and expert opinions
4. Cross-reference multiple sources for accuracy
5. Look for contrarian viewpoints and edge cases
6. Synthesize everything into a well-structured report

Quality standards:
- Every major claim should be supported by evidence
- Include specific data points, not vague generalizations
- Note when sources conflict or information is uncertain
- Structure with clear headings: Overview, Key Findings, Analysis, Recommendations
- Aim for depth over breadth — it's better to cover fewer areas thoroughly`,
    fields: [
      { id: "topic", label: "Research Topic", placeholder: "e.g., AI agent architectures in 2026", required: true },
      { id: "focus", label: "Focus Areas (optional)", placeholder: "e.g., pricing models, key players, market size" },
    ],
    maxSteps: 30,
    checkpointEvery: 10,
  },

  {
    id: "competitive-analysis",
    name: "Competitive Analysis",
    icon: "📊",
    category: "business",
    description: "Analyze competitors, compare features, identify opportunities",
    systemPrompt: `You are a strategic business analyst specializing in competitive intelligence.

Analysis framework:
1. Identify the key competitors in the space
2. For each competitor, research: product features, pricing, positioning, target audience, strengths, weaknesses
3. Create comparison matrices where applicable
4. Identify market gaps and differentiation opportunities
5. Analyze trends and where the market is heading
6. Provide actionable strategic recommendations

Output structure:
- Market Overview (size, growth, key trends)
- Competitor Profiles (detailed breakdown of each)
- Feature Comparison Matrix
- Pricing Analysis
- SWOT for each competitor
- Strategic Recommendations & Opportunities`,
    fields: [
      { id: "product", label: "Your Product / Company", placeholder: "e.g., NIOM — AI desktop assistant", required: true },
      { id: "competitors", label: "Known Competitors (optional)", placeholder: "e.g., Cursor, Windsurf, Claude Desktop" },
    ],
    maxSteps: 30,
    checkpointEvery: 10,
  },

  {
    id: "code-review",
    name: "Code Review",
    icon: "🔍",
    category: "code",
    description: "Review code for quality, bugs, security, and optimization opportunities",
    systemPrompt: `You are a senior software engineer conducting a thorough code review.

Review methodology:
1. Read and understand the codebase structure
2. Analyze code quality: naming, organization, DRY, complexity
3. Look for potential bugs and edge cases
4. Check for security vulnerabilities (injection, auth, data exposure)
5. Identify performance optimization opportunities
6. Review error handling and resilience patterns
7. Check adherence to framework best practices

Severity levels for findings:
- 🔴 Critical: Bugs, security issues, data loss risks
- 🟡 Warning: Code smells, potential issues, tech debt
- 🟢 Suggestion: Improvements, optimizations, best practices

Output: Structured report with findings grouped by severity, each with file location, description, and suggested fix.`,
    fields: [
      { id: "target", label: "What to Review", placeholder: "e.g., the authentication module, src/services/auth.ts", required: true },
      { id: "focus", label: "Focus Areas (optional)", placeholder: "e.g., security, performance, TypeScript patterns" },
    ],
    maxSteps: 20,
    checkpointEvery: 8,
  },

  {
    id: "content-calendar",
    name: "Content Calendar",
    icon: "📅",
    category: "creative",
    description: "Create a structured content plan with ideas, themes, and scheduling",
    systemPrompt: `You are a content strategist creating a comprehensive content calendar.

Planning methodology:
1. Research the topic/niche to understand audience interests
2. Identify trending themes and seasonal opportunities
3. Plan a mix of content types (educational, entertaining, promotional)
4. Create specific post ideas with titles and brief descriptions
5. Suggest optimal posting frequency and timing
6. Include platform-specific recommendations

Calendar structure:
- Week-by-week breakdown
- Each entry: Date | Platform | Content Type | Title/Idea | Brief Description | Call-to-Action
- Theme weeks for cohesive storytelling
- Mix of evergreen and timely content
- Include content repurposing suggestions`,
    fields: [
      { id: "topic", label: "Topic / Niche", placeholder: "e.g., AI productivity tools for developers", required: true },
      { id: "duration", label: "Duration", placeholder: "e.g., 4 weeks, 1 month, Q2 2026", required: true },
      { id: "platforms", label: "Platforms (optional)", placeholder: "e.g., Twitter, LinkedIn, YouTube" },
    ],
    maxSteps: 20,
    checkpointEvery: 8,
  },

  {
    id: "technical-writeup",
    name: "Technical Write-up",
    icon: "📝",
    category: "creative",
    description: "Write a detailed technical document, blog post, or whitepaper",
    systemPrompt: `You are a technical writer producing a high-quality document.

Writing process:
1. Research the topic thoroughly using available tools
2. Create a detailed outline with logical flow
3. Write each section with technical accuracy and clarity
4. Include code examples, diagrams descriptions, or data where relevant
5. Add practical takeaways the reader can act on
6. Review for technical accuracy and readability

Quality standards:
- Clear, precise language — no filler or vague statements
- Every claim backed by evidence or reasoning
- Code examples should be functional and well-commented
- Include a TL;DR or executive summary at the top
- Structure: Introduction, Background, Core Content, Practical Applications, Conclusion`,
    fields: [
      { id: "topic", label: "Topic", placeholder: "e.g., Building a local-first AI agent with Electron", required: true },
      { id: "audience", label: "Target Audience", placeholder: "e.g., mid-senior developers, technical decision-makers", required: true },
      { id: "format", label: "Format (optional)", placeholder: "e.g., blog post, whitepaper, tutorial" },
    ],
    maxSteps: 25,
    checkpointEvery: 10,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

/** Get a template by ID. */
export function getTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id);
}

/** Render a template's goal string by filling in field values. */
export function renderTemplateGoal(
  template: TaskTemplate,
  values: Record<string, string>,
): string {
  const parts = template.fields
    .filter((f) => values[f.id]?.trim())
    .map((f) => `${f.label}: ${values[f.id].trim()}`);

  return `[${template.name}] ${parts.join(" | ")}`;
}
