/**
 * NIOM Agent — AI SDK v6 ToolLoopAgent
 *
 * Wraps model + tools into an Agent that:
 *   - Uses `prepareCall` for per-query Skill Tree routing
 *   - Handles multi-step tool loops natively (no manual approval loop)
 *   - Outputs `StreamTextResult` which can be piped to `toUIMessageStream()`
 *
 * This replaces the custom `streamChat()` function entirely.
 */

import { ToolLoopAgent, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { getImplementedTools, getToolsByNames } from "./tools/registry";
import { resolveSkillPath, getRoutingLabel } from "./skills/traversal";
import { buildSystemPrompt } from "./services/chat.service";
import { buildTaskContextPrompt, buildRecallContextPrompt, buildActiveTaskContext } from "./context/injection";
import { detectTaskComplexity } from "./tasks/task-detector";
import type { TaskDetectionResult } from "./tasks/task-detector";

// ─── Agent Factory ───────────────────────────────────────────────────

/**
 * Create a NIOM agent for a given model.
 *
 * The agent uses `prepareCall` to resolve the Skill Path per-query,
 * dynamically selecting which tools and system prompt fragments to
 * inject. This replaces our manual routing in `streamChat()`.
 *
 * @param model - Resolved AI SDK LanguageModel instance
 * @param onRoute - Optional callback when skill routing resolves (for UI labels)
 */
export function createNiomAgent(
  model: LanguageModel,
  options?: {
    threadId?: string;
    /** When true, inject task context from ALL threads, not just the current one */
    recallEnabled?: boolean;
    /** When true, inject live context about running background tasks */
    taskAwarenessEnabled?: boolean;
    /** Override the step budget from Skill Tree routing (used by task agents for longer runs) */
    maxSteps?: number;
    onRoute?: (label: string, tools: string[], confidence: number, primaryDomain: string) => void;
    onTaskSuggestion?: (query: string, detection: TaskDetectionResult) => void;
  },
) {
  const allTools = getImplementedTools();

  return new ToolLoopAgent({
    id: "niom",
    model,
    tools: allTools,
    // Base instructions — always overridden by prepareCall which builds
    // the full prompt with routing, context, and domain fragments.
    instructions: "NIOM Agent",
    stopWhen: stepCountIs(20),

    /**
     * prepareCall — AI SDK v6's hook for per-request customization.
     *
     * Called before each agent invocation. We use it to:
     * 1. Extract the user's last query from messages
     * 2. Resolve the Skill Path (domain + tool routing)
     * 3. Return the routed tools + domain-specific system prompt
     *
     * This replaces ~40 lines of manual routing in the old streamChat().
     */
    prepareCall: async (callOptions) => {
      // Extract last user query for routing.
      // Callers can use either `prompt` (task runner) or `messages` (chat transport).
      let query = "";

      if (callOptions.prompt) {
        // prompt can be a string or Array<ModelMessage>
        if (typeof callOptions.prompt === "string") {
          query = callOptions.prompt;
        }
      } else {
        const msgs = callOptions.messages ?? [];
        const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          if (typeof lastUserMsg.content === "string") {
            query = lastUserMsg.content;
          } else if (Array.isArray(lastUserMsg.content)) {
            const textPart = lastUserMsg.content.find(
              (p: { type: string }) => p.type === "text",
            ) as { type: "text"; text: string } | undefined;
            query = textPart?.text || "";
          }
        }
      }

      // Pass through whichever input format was provided
      const inputFields = callOptions.prompt
        ? { prompt: callOptions.prompt as string }
        : { messages: callOptions.messages };

      // threadId comes from the constructor options (closure), not prepareCall args
      const threadId = options?.threadId;
      const recallEnabled = options?.recallEnabled ?? false;

      const threadContext = threadId
        ? `\n\n<session_context>\nCurrent thread ID: ${threadId}\nAlways pass the threadId when calling proposeArtifact.\n</session_context>`
        : "";

      // Inject context awareness (M5a same-thread / M5d cross-thread recall)
      let contextPrompt = "";
      if (recallEnabled) {
        // Recall ON: inject ALL task digests + ALL thread conversation digests
        contextPrompt = buildRecallContextPrompt(threadId, query);
      } else if (threadId) {
        // Recall OFF: same-thread task context only (default)
        contextPrompt = buildTaskContextPrompt(threadId, query);
      }

      // Inject live task awareness (running "minions")
      let taskAwarenessPrompt = "";
      if (options?.taskAwarenessEnabled) {
        taskAwarenessPrompt = buildActiveTaskContext(threadId);
      }

      try {
        const skillPath = await resolveSkillPath(query);

        // Notify UI about routing (via closure-captured callback)
        if (options?.onRoute) {
          const label = getRoutingLabel(skillPath);
          options.onRoute(label, skillPath.tools, skillPath.confidence, skillPath.primaryDomain);
        }

        // Run task complexity detection (pure heuristic, zero cost)
        if (options?.onTaskSuggestion && query.length > 0) {
          const detection = detectTaskComplexity(query, skillPath);
          if (detection.shouldSuggest) {
            options.onTaskSuggestion(query, detection);
          }
        }

        // Build routed tools
        let routedTools = allTools;
        if (skillPath.tools.length > 0) {
          const focused = getToolsByNames(skillPath.tools);
          if (Object.keys(focused).length > 0) {
            routedTools = focused;
          }
        }

        // Build domain-specific instructions
        const domainPrompt = skillPath.systemPromptFragments.length > 0
          ? "\n\n" + skillPath.systemPromptFragments.join("\n\n")
          : "";

        return {
          model,
          ...inputFields,
          tools: routedTools,
          instructions: buildSystemPrompt() + domainPrompt + threadContext + contextPrompt + taskAwarenessPrompt,
          stopWhen: stepCountIs(options?.maxSteps ?? skillPath.stepBudget ?? 10),
        };
      } catch (routeError) {
        console.warn("[agent] Skill routing failed, using all tools:", routeError);

        return {
          model,
          ...inputFields,
          instructions: buildSystemPrompt() + threadContext + contextPrompt + taskAwarenessPrompt,
        };
      }
    },
  });
}
