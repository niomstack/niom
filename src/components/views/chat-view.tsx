/**
 * ChatView — AI SDK v6 native rendering.
 *
 * Renders UIMessage.parts directly from useChat:
 *   - text parts → markdown rendering
 *   - tool parts → ToolResultCard / ArtifactPreviewCard based on state
 *   - step-start parts → step dividers
 *
 * Tool invocation states (v6):
 *   input-streaming → input-available → output-available / output-error / output-denied
 *   With HITL: input-available → approval-requested → approval-responded → output-available
 */

import { useEffect, useRef, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert";
import {
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  User,
  Sparkles,
  Brain,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { PromptBox } from "@/components/prompt-box";
import { ArtifactPreviewCard } from "@/components/artifact-preview-card";
import { TaskIndicator, TaskPanel } from "@/components/task-panel";
import type { Thread } from "@/shared/types";
import type { RouteInfo } from "@/hooks/use-niom-chat";
import type { UseTaskManagerReturn } from "@/hooks/use-task-manager";

// ─── Domain Icons ────────────────────────────────────────────────────

const DOMAIN_EMOJI: Record<string, string> = {
  os: "💻",
  web: "🌐",
  code: "🧑‍💻",
  research: "🔬",
  business: "📊",
  creative: "🎨",
  personal: "🧠",
  "computer-use": "🖱️",
  general: "💬",
};

// ─── Tool Display Names ──────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, { label: string; icon: string }> = {
  // Consolidated primitives
  read: { label: "Read", icon: "📄" },
  write: { label: "Write", icon: "✍️" },
  run: { label: "Terminal", icon: "⚡" },
  search: { label: "Search", icon: "🔍" },
  crawl: { label: "Crawl", icon: "🌐" },
  system: { label: "System Info", icon: "💻" },
  propose: { label: "Propose Artifact", icon: "📋" },
  // Legacy names (for existing thread history)
  readFile: { label: "Read File", icon: "📄" },
  writeFile: { label: "Write File", icon: "✍️" },
  listDirectory: { label: "List Directory", icon: "📁" },
  runCommand: { label: "Terminal", icon: "⚡" },
  webSearch: { label: "Search", icon: "🔍" },
  fetchUrl: { label: "Crawl", icon: "🌐" },
  systemInfo: { label: "System Info", icon: "💻" },
  proposeArtifact: { label: "Propose Artifact", icon: "📋" },
};

// ─── Code Block with Copy Button ─────────────────────────────────────

function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const isInline = !className;

  if (isInline) {
    return (
      <code
        className="rounded bg-muted/80 px-1.5 py-0.5 text-[0.8em] font-mono text-primary"
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    const text = codeRef.current?.textContent || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group/code relative">
      <code ref={codeRef} className={className} {...props}>
        {children}
      </code>
      <Button
        variant="outline"
        size="icon-xs"
        onClick={handleCopy}
        className="absolute right-2 top-2 opacity-0 backdrop-blur-sm transition-opacity group-hover/code:opacity-100"
      >
        {copied ? (
          <Check className="size-3 text-green-500" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}

// ─── Tool Invocation Card (v6 states) ────────────────────────────────

/**
 * Renders a tool invocation based on its v6 state.
 * Expandable — click to see input args and output details.
 * Handles: input-streaming, input-available, output-available, output-error, output-denied,
 *          approval-requested, approval-responded
 */
function ToolCard({ part, onApproval }: { part: any; onApproval?: (opts: { id: string; approved: boolean; reason?: string }) => void }) {
  // Extract fields from the tool part
  const toolPart = part as {
    type: string;
    toolCallId: string;
    state: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
    approval?: { id: string; approved?: boolean; reason?: string };
    preliminary?: boolean;
  };

  // Extract tool name from the type (e.g., "tool-readFile" → "readFile")
  const toolName = toolPart.toolName || toolPart.type.replace(/^tool-/, "");
  const display = TOOL_DISPLAY[toolName] || { label: toolName, icon: "🔧" };

  const stateStr = String(toolPart.state);
  const isActive = stateStr === "input-streaming" || stateStr === "input-available" || stateStr === "approval-requested";
  const isDone = stateStr === "output-available" || stateStr === "output-error" || stateStr === "output-denied";

  // Collapsed by default — only auto-expand when user approval is needed
  const needsAttention = stateStr === "approval-requested";
  const [expanded, setExpanded] = useState(needsAttention);

  // Artifact preview for propose/proposeArtifact
  if ((toolName === "propose" || toolName === "proposeArtifact") && toolPart.state === "output-available" && toolPart.output) {
    const output = toolPart.output as { data?: { artifactId: string; targetPath: string; content: string; language: string; description: string; isModification: boolean; originalContent?: string; threadId: string } };
    if (output.data) {
      return <ArtifactPreviewCard artifact={output.data} />;
    }
  }

  const hasInput = toolPart.input != null;
  const hasOutput = toolPart.output != null;
  const hasDetails = hasInput || hasOutput || toolPart.errorText;
  const isExpandable = isDone && hasDetails;

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 text-xs font-mono animate-in slide-in-from-left-2 duration-200 overflow-hidden">
      {/* Header — clickable when expandable */}
      <div
        className={`flex items-center gap-2 px-3 py-2 ${isExpandable ? "cursor-pointer hover:bg-muted/30 transition-colors" : ""}`}
        onClick={() => isExpandable && setExpanded((e) => !e)}
      >
        <span className="shrink-0">{display.icon}</span>
        <span className="font-medium text-foreground">{display.label}</span>
        <ToolStateBadge state={toolPart.state} />

        {/* Inline summary: input context + output result */}
        {toolPart.input != null && (
          <span className="text-muted-foreground/70 truncate max-w-[180px] text-[0.6rem]">
            {getToolInputSummary(toolPart.input, toolName)}
          </span>
        )}
        {isDone && !expanded && toolPart.output != null && (
          <span className="text-muted-foreground/50 truncate max-w-[120px] text-[0.55rem] ml-auto mr-1">
            {getToolOutputSummary(toolPart.output, toolName)}
          </span>
        )}

        {/* Expand/collapse chevron */}
        {isExpandable && (
          <ChevronDown className={`size-3 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-0" : "-rotate-90"}`} />
        )}
      </div>

      {/* Active state content (always visible when active) */}
      {stateStr === "input-streaming" && (
        <div className="px-3 pb-2 text-muted-foreground truncate">
          <Loader2 className="inline size-3 animate-spin mr-1" />
          Building arguments…
        </div>
      )}

      {stateStr === "input-available" && (
        <div className="px-3 pb-2 text-muted-foreground truncate">
          <Clock className="inline size-3 mr-1" />
          Executing…
        </div>
      )}

      {stateStr === "approval-requested" && (
        <div className="px-3 pb-2 space-y-2">
          <div className="flex items-center gap-2 text-amber-500">
            <ShieldCheck className="size-3" />
            <span>This tool requires your approval to run</span>
          </div>
          {toolPart.input != null && (
            <div className="rounded bg-muted/30 p-1.5 text-[0.65rem] text-muted-foreground whitespace-pre-wrap font-mono max-h-20 overflow-y-auto">
              {String(JSON.stringify(toolPart.input, null, 2)).slice(0, 300)}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-6 text-[0.65rem] gap-1"
              onClick={(e) => { e.stopPropagation(); onApproval?.({ id: String(toolPart.approval?.id || toolPart.toolCallId), approved: true }); }}
            >
              <CheckCircle2 className="size-3" />
              Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[0.65rem] gap-1 text-red-400 border-red-400/30 hover:bg-red-400/10"
              onClick={(e) => { e.stopPropagation(); onApproval?.({ id: String(toolPart.approval?.id || toolPart.toolCallId), approved: false, reason: "Denied by user" }); }}
            >
              <XCircle className="size-3" />
              Deny
            </Button>
          </div>
        </div>
      )}

      {stateStr === "output-denied" && (
        <div className="px-3 pb-2 text-muted-foreground">
          Execution denied by user
        </div>
      )}

      {/* Expandable detail panel — polished contextual rendering */}
      {expanded && isDone && (
        <div className="border-t border-border/30 px-3 py-2 animate-in slide-in-from-top-1 duration-150 bg-muted/10">
          <ToolOutputDetail output={toolPart.output} input={toolPart.input} toolName={toolName} />

          {/* Error */}
          {stateStr === "output-error" && toolPart.errorText && (
            <div className="mt-2">
              <div className="rounded bg-red-500/10 p-1.5 text-[0.65rem] text-red-400 whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">
                {String(toolPart.errorText)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Get a polished inline summary for collapsed tool cards */
function getToolOutputSummary(output: unknown, toolName: string): string {
  const r = output as any;
  
  // read tool (unified file/dir)
  if ((toolName === "read" || toolName === "readFile" || toolName === "listDirectory") && r?.data) {
    const d = r.data;
    if (d.kind === "directory") return d.summary || `${d.totalEntries} entries`;
    if (d.kind === "file") return `${d.lines} lines · ${d.extension}`;
    // Legacy readFile
    if (d.content != null) return `${d.content?.split?.("\n")?.length || 0} lines`;
    if (d.entries != null) return `${d.totalEntries || d.entries?.length} entries`;
  }

  // run/runCommand
  if ((toolName === "run" || toolName === "runCommand") && r?.data) {
    const d = r.data;
    if (d.exitCode === 0) return "✓ success";
    return `exit ${d.exitCode}`;
  }

  // write/writeFile
  if ((toolName === "write" || toolName === "writeFile") && r?.data) {
    return r.data.created ? "created" : "updated";
  }

  // search/webSearch
  if ((toolName === "search" || toolName === "webSearch") && r?.data) {
    return `${r.data.resultCount || 0} results`;
  }

  // crawl/fetchUrl
  if ((toolName === "crawl" || toolName === "fetchUrl") && r?.data) {
    return r.data.title || "fetched";
  }

  // Generic fallback
  if (r?.message) return r.message.slice(0, 60);
  return "completed";
}

/** Render the polished collapsed input summary (replaces the raw path display) */
function getToolInputSummary(input: unknown, toolName: string): string | null {
  const i = input as any;
  if (!i) return null;

  if (toolName === "read" || toolName === "readFile" || toolName === "listDirectory") {
    return i.path ? shortenPath(i.path) : null;
  }
  if (toolName === "run" || toolName === "runCommand") {
    return i.command ? `$ ${i.command.slice(0, 60)}${i.command.length > 60 ? "…" : ""}` : null;
  }
  if (toolName === "write" || toolName === "writeFile") {
    return i.path ? shortenPath(i.path) : null;
  }
  if (toolName === "search" || toolName === "webSearch") {
    return i.query ? `"${i.query}"` : null;
  }
  if (toolName === "crawl" || toolName === "fetchUrl") {
    return i.url ? shortenUrl(i.url) : null;
  }
  return null;
}

/** Shorten a file path for display (keep last 2-3 segments) */
function shortenPath(p: string): string {
  const parts = p.replace(/^\/Users\/[^/]+\//, "~/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

/** Shorten URL for display */
function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 27) + "…" : u.pathname;
    return u.hostname + path;
  } catch {
    return url.slice(0, 40);
  }
}

/** Polished detail panel for expanded tool cards */
function ToolOutputDetail({ output, input, toolName }: { output: unknown; input: unknown; toolName: string }) {
  const r = output as any;
  const i = input as any;

  // ── read (file) ─────────────────────────────────────────────────
  if ((toolName === "read" || toolName === "readFile") && r?.data?.kind === "file") {
    const d = r.data;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
          <span
            className="text-foreground font-medium cursor-pointer hover:text-primary transition-colors"
            title="Reveal in Finder"
            onClick={() => window.niom.shell.openPath(d.path)}
          >
            {shortenPath(d.path)}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>{d.lines} lines</span>
          <span className="text-muted-foreground/60">·</span>
          <span>{d.extension}</span>
          {d.truncated && <Badge variant="outline" className="text-[0.5rem] px-1 py-0 text-amber-500 border-amber-500/30">truncated</Badge>}
        </div>
        <div className="rounded bg-muted/30 p-2 text-[0.65rem] text-muted-foreground whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-relaxed">
          {(d.content || "").slice(0, 3000)}
        </div>
      </div>
    );
  }

  // ── read (directory) / listDirectory ────────────────────────────
  if ((toolName === "read" || toolName === "listDirectory") && r?.data && (r.data.kind === "directory" || r.data.entries)) {
    const d = r.data;
    const entries = d.entries || [];
    return (
      <div className="space-y-1.5">
        <div
          className="text-[0.65rem] text-foreground font-medium cursor-pointer hover:text-primary transition-colors"
          title="Reveal in Finder"
          onClick={() => window.niom.shell.openPath(d.path)}
        >
          {shortenPath(d.path)}/
        </div>
        <div className="rounded bg-muted/30 p-2 text-[0.65rem] font-mono max-h-48 overflow-y-auto space-y-0.5">
          {entries.map((e: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center gap-2 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => {
                const fullPath = d.path.endsWith("/") ? d.path + e.name : d.path + "/" + e.name;
                window.niom.shell.openPath(fullPath);
              }}
              title={`Reveal ${e.name} in Finder`}
            >
              <span className="shrink-0 w-3 text-center">
                {e.type === "dir" || e.type === "directory" ? "📁" : "📄"}
              </span>
              <span className={e.type === "dir" || e.type === "directory" ? "text-primary/80" : ""}>
                {e.name}{(e.type === "dir" || e.type === "directory") ? "/" : ""}
              </span>
              {e.type === "file" && e.size > 0 && (
                <span className="text-muted-foreground/40 text-[0.55rem] ml-auto">{fmtFileSize(e.size)}</span>
              )}
            </div>
          ))}
          {d.truncated && (
            <div className="text-muted-foreground/50 italic mt-1">… and {d.totalEntries - entries.length} more</div>
          )}
        </div>
      </div>
    );
  }

  // ── run / runCommand ────────────────────────────────────────────
  if ((toolName === "run" || toolName === "runCommand") && r?.data) {
    const d = r.data;
    return (
      <div className="space-y-1">
        <div className="rounded bg-black/40 p-2 text-[0.65rem] font-mono">
          <div className="text-green-400/80 mb-1">$ {d.command}</div>
          <div className="text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {(d.stdout?.trim() || d.stderr?.trim() || "(no output)").slice(0, 3000)}
          </div>
        </div>
        <div className="flex gap-2 text-[0.55rem] text-muted-foreground/50">
          <span>exit: {d.exitCode ?? "?"}</span>
          {d.cwd && (
            <span
              className="cursor-pointer hover:text-muted-foreground transition-colors"
              onClick={() => window.niom.shell.openPath(d.cwd)}
              title="Reveal in Finder"
            >
              cwd: {shortenPath(d.cwd)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── search / webSearch ──────────────────────────────────────────
  if ((toolName === "search" || toolName === "webSearch") && r?.data?.results) {
    const results = r.data.results || [];
    return (
      <div className="space-y-1.5">
        <div className="text-[0.65rem] text-muted-foreground">
          {results.length} results for "<span className="text-foreground">{r.data.query}</span>"
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {results.map((res: any, idx: number) => (
            <div
              key={idx}
              className="rounded bg-muted/30 p-1.5 text-[0.65rem] cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => window.niom.shell.openUrl(res.url)}
              title={res.url}
            >
              <div className="text-primary/80 font-medium truncate">{res.title}</div>
              <div className="text-muted-foreground/50 truncate text-[0.55rem] hover:text-primary/60">{shortenUrl(res.url)}</div>
              {res.snippet && <div className="text-muted-foreground mt-0.5 line-clamp-2">{res.snippet}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── crawl / fetchUrl ────────────────────────────────────────────
  if ((toolName === "crawl" || toolName === "fetchUrl") && r?.data) {
    const d = r.data;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[0.65rem]">
          {d.title && <span className="text-foreground font-medium truncate">{d.title}</span>}
          <span className="text-muted-foreground/50 text-[0.55rem] shrink-0">{shortenUrl(d.url)}</span>
        </div>
        <div className="rounded bg-muted/30 p-2 text-[0.65rem] text-muted-foreground whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-relaxed">
          {(d.content || "").slice(0, 3000)}
        </div>
      </div>
    );
  }

  // ── write / writeFile ───────────────────────────────────────────
  if ((toolName === "write" || toolName === "writeFile") && r?.data) {
    const d = r.data;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[0.65rem]">
          <span className={d.created ? "text-green-400" : "text-blue-400"}>
            {d.created ? "✦ Created" : "↻ Updated"}
          </span>
          <span className="text-foreground font-medium">{shortenPath(d.path)}</span>
          <span className="text-muted-foreground/50">{fmtFileSize(d.bytesWritten)}</span>
        </div>
        {d.diff && (
          <div className="rounded bg-muted/30 p-2 text-[0.6rem] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
            {d.diff.split("\n").map((line: string, idx: number) => (
              <div
                key={idx}
                className={
                  line.startsWith("+") ? "text-green-400/80" :
                  line.startsWith("-") ? "text-red-400/80" :
                  line.startsWith("@@") ? "text-blue-400/60" :
                  "text-muted-foreground/60"
                }
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Generic fallback ────────────────────────────────────────────
  return (
    <div className="space-y-1.5">
      {i && (
        <div>
          <div className="text-[0.55rem] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Input</div>
          <div className="rounded bg-muted/30 p-1.5 text-[0.6rem] text-muted-foreground whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">
            {formatToolData(i)}
          </div>
        </div>
      )}
      <div>
        <div className="text-[0.55rem] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Output</div>
        <div className="rounded bg-muted/30 p-1.5 text-[0.6rem] text-muted-foreground whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">
          {formatToolData(output)}
        </div>
      </div>
    </div>
  );
}

/** Format tool data for fallback display */
function formatToolData(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return data.slice(0, 2000);
  try {
    return JSON.stringify(data, null, 2).slice(0, 2000);
  } catch {
    return String(data);
  }
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function ToolStateBadge({ state }: { state: string }) {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return (
        <Badge variant="outline" className="text-[0.55rem] px-1 py-0 gap-0.5 text-muted-foreground border-border/50">
          <Loader2 className="size-2.5 animate-spin" />
          Running
        </Badge>
      );
    case "output-available":
      return (
        <Badge variant="outline" className="text-[0.55rem] px-1 py-0 gap-0.5 text-green-500 border-green-500/30">
          <CheckCircle2 className="size-2.5" />
          Done
        </Badge>
      );
    case "output-error":
      return (
        <Badge variant="outline" className="text-[0.55rem] px-1 py-0 gap-0.5 text-red-400 border-red-400/30">
          <XCircle className="size-2.5" />
          Error
        </Badge>
      );
    case "approval-requested":
      return (
        <Badge variant="outline" className="text-[0.55rem] px-1 py-0 gap-0.5 text-amber-500 border-amber-500/30">
          <ShieldCheck className="size-2.5" />
          Approval
        </Badge>
      );
    case "output-denied":
      return (
        <Badge variant="outline" className="text-[0.55rem] px-1 py-0 gap-0.5 text-muted-foreground border-border/50">
          Denied
        </Badge>
      );
    default:
      return null;
  }
}

// ─── Thinking Indicator ──────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2 text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin text-primary" />
      <span className="text-xs font-mono">Thinking…</span>
    </div>
  );
}

// ─── Routing Indicator ───────────────────────────────────────────────

function RoutingIndicator({ route }: { route: RouteInfo }) {
  const emoji = DOMAIN_EMOJI[route.primaryDomain] ?? "🧠";
  const confidencePercent = Math.round(route.confidence * 100);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="shrink-0 gap-1 font-mono text-[0.6rem] bg-primary/5 border-primary/20 text-primary animate-in fade-in slide-in-from-left-2 duration-300"
          >
            <span>{emoji}</span>
            <span className="capitalize">{route.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <Brain className="size-3 text-primary" />
              Skill Tree Route
            </div>
            <div className="flex items-center justify-between font-mono text-muted-foreground">
              <span>Domain</span>
              <span className="text-foreground capitalize">{route.primaryDomain}</span>
            </div>
            <div className="flex items-center justify-between font-mono text-muted-foreground">
              <span>Confidence</span>
              <span className="text-foreground">{confidencePercent}%</span>
            </div>
            {route.tools.length > 0 && (
              <div className="font-mono text-muted-foreground">
                <span>Tools: </span>
                <span className="text-foreground">
                  {route.tools.slice(0, 4).join(", ")}
                  {route.tools.length > 4 && ` +${route.tools.length - 4}`}
                </span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Message Renderer (v6 parts-based) ───────────────────────────────

/**
 * Renders a single UIMessage by iterating its parts array.
 * User messages show text directly; assistant messages render text + tools inline.
 */
function MessageRenderer({
  message,
  isStreaming,
  onToolApprovalResponse,
}: {
  message: UIMessage;
  isStreaming?: boolean;
  onToolApprovalResponse?: (opts: { id: string; approved: boolean; reason?: string }) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    // User messages — extract text from parts
    const text = message.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("") || "";

    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="max-w-[80%] rounded-xl px-3 py-2 bg-primary/10 text-foreground">
          <p className="text-sm whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    );
  }

  // Assistant messages — render parts in order
  const parts = message.parts || [];
  const hasContent = parts.length > 0;

  return (
    <div className="flex gap-3 flex-row">
      {/* Avatar */}
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Sparkles className="size-3.5" />
      </div>

      {/* Content — parts rendered in order */}
      <div className="min-w-0 flex-1 max-w-[80%] space-y-2">
        {!hasContent && isStreaming && <ThinkingIndicator />}

        {parts.map((part, i) => {
          // Text parts
          if (part.type === "text") {
            const textPart = part as { type: "text"; text: string };
            if (!textPart.text?.trim()) return null;

            const isLastText = i === parts.length - 1 || !parts.slice(i + 1).some((p) => p.type === "text");

            return (
              <div key={`text-${i}`} className="rounded-xl px-3 py-2 text-foreground">
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&_pre]:rounded-lg [&_pre]:bg-muted/50 [&_pre]:p-3 [&_pre]:text-xs [&_p]:leading-relaxed [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={{
                      code: CodeBlock as any,
                    }}
                  >
                    {textPart.text}
                  </ReactMarkdown>
                </div>
                {/* Streaming cursor */}
                {isStreaming && isLastText && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary animate-pulse rounded-sm" />
                )}
              </div>
            );
          }

          // Tool parts — type starts with "tool-" for static tools
          if (isToolUIPart(part)) {
            return (
              <div key={`tool-${i}`} className="ml-0">
                <ToolCard part={part} onApproval={onToolApprovalResponse} />
              </div>
            );
          }

          // Step start — subtle divider
          if (part.type === "step-start") {
            return (
              <div key={`step-${i}`} className="border-t border-border/20 my-1" />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

// ─── Error Banner ────────────────────────────────────────────────────

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-4 mb-2">
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
        <AlertAction>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="h-auto px-1 py-0 text-xs text-destructive underline opacity-70 hover:opacity-100"
          >
            Dismiss
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}

// ─── ChatView ────────────────────────────────────────────────────────

interface ChatViewProps {
  thread: Thread;
  /** UIMessages from useChat — the live message state */
  messages: UIMessage[];
  isStreaming: boolean;
  error: string | null;
  routeInfo?: RouteInfo | null;
  status: string;
  onBack: () => void;
  onSubmit: (text: string, model: string) => void;
  onCancel: () => void;
  onDismissError: () => void;
  /** AI SDK v6 native tool approval response */
  onToolApprovalResponse?: (opts: { id: string; approved: boolean; reason?: string }) => void;
  /** Task manager (from useTaskManager hook) */
  taskManager?: UseTaskManagerReturn;
  /** Whether cross-thread recall is active */
  recallEnabled?: boolean;
  /** Toggle cross-thread recall */
  onRecallChange?: (enabled: boolean) => void;
  /** Whether task awareness is active */
  taskAwarenessEnabled?: boolean;
  /** Toggle task awareness */
  onTaskAwarenessChange?: (enabled: boolean) => void;
  /** Active window context from global hotkey */
  windowContext?: { appName: string; windowTitle: string } | null;
  /** Clear window context */
  onClearWindowContext?: () => void;
}

function ChatView({
  thread,
  messages,
  isStreaming,
  error,
  routeInfo,
  onBack,
  onSubmit,
  onCancel,
  onDismissError,
  onToolApprovalResponse,
  taskManager,
  recallEnabled,
  onRecallChange,
  taskAwarenessEnabled,
  onTaskAwarenessChange,
  windowContext,
  onClearWindowContext,
}: ChatViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on message changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(
    (text: string, model: string) => {
      onSubmit(text, model);
    },
    [onSubmit],
  );

  // Determine which messages to render:
  // - If useChat has messages (streaming active), use those (live v6 UIMessages with parts)
  // - Otherwise, use thread.messages converted to UIMessage format (persisted data)
  const displayMessages: UIMessage[] = messages.length > 0
    ? messages
    : thread.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        parts: [{ type: "text" as const, text: msg.content }],
      }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Chat Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur-md">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-sm font-medium">
            {thread.title || "New Chat"}
          </h2>
        </div>

        {/* Routing indicator */}
        {routeInfo && <RoutingIndicator route={routeInfo} />}

        {/* Task indicator */}
        {taskManager && taskManager.threadTasks.length > 0 && (
          <TaskIndicator
            runningCount={taskManager.runningCount}
            hasCheckpoint={taskManager.hasCheckpoint}
            totalCount={taskManager.threadTasks.length}
            onClick={() => taskManager.openPanel(taskManager.threadTasks[0]?.id)}
          />
        )}

        <Badge
          variant="outline"
          className="shrink-0 font-mono text-[0.6rem]"
        >
          {thread.defaultModel.split(":").pop()}
        </Badge>
      </div>

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1 px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {displayMessages.map((msg, i) => {
            const isLastMsg = i === displayMessages.length - 1;
            const isStreamingThis = isStreaming && isLastMsg && msg.role === "assistant";

            return (
              <MessageRenderer
                key={msg.id}
                message={msg}
                isStreaming={isStreamingThis}
                onToolApprovalResponse={onToolApprovalResponse}
              />
            );
          })}

          {/* If streaming but no assistant message yet, show thinking */}
          {isStreaming && displayMessages[displayMessages.length - 1]?.role === "user" && (
            <div className="flex gap-3 flex-row">
              <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Sparkles className="size-3.5" />
              </div>
              <ThinkingIndicator />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Error */}
      {error && <ErrorBanner message={error} onDismiss={onDismissError} />}

      {/* Input */}
      <div className="shrink-0 bg-background/80 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto max-w-3xl">
          <PromptBox
            onSubmit={handleSubmit}
            onSubmitAsTask={taskManager ? (goal) => taskManager.startTask(goal, { recallEnabled }) : undefined}
            onStop={onCancel}
            isStreaming={isStreaming}
            compact
            pendingApproval={taskManager?.hasCheckpoint}
            onOpenTaskPanel={taskManager?.hasCheckpoint ? () => taskManager.openPanel(taskManager.threadTasks[0]?.id) : undefined}
            recallEnabled={recallEnabled}
            onRecallChange={onRecallChange}
            taskAwarenessEnabled={taskAwarenessEnabled}
            onTaskAwarenessChange={onTaskAwarenessChange}
            windowContext={windowContext}
            onClearWindowContext={onClearWindowContext}
          />
        </div>
      </div>

      {/* Task Panel (slide-out sheet) */}
      {taskManager && (
        <TaskPanel
          isOpen={taskManager.isPanelOpen}
          onClose={taskManager.closePanel}
          task={taskManager.activeTask}
          checkpoint={taskManager.latestCheckpoint}
          onRespond={taskManager.respondToCheckpoint}
          onPause={taskManager.pauseTask}
          onCancel={taskManager.cancelTask}
          onResume={taskManager.resumeTask}
        />
      )}
    </div>
  );
}

export { ChatView };
