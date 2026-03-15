/**
 * ToolResultCard — Rich rendering for tool invocations in the chat.
 *
 * Renders different card layouts based on tool name:
 *   - readFile:       Syntax-highlighted code with file path header
 *   - listDirectory:  Tree-style directory listing
 *   - systemInfo:     Key-value system info display
 *   - (default):      Generic JSON result display
 *
 * All cards show:
 *   - Tool name + status badge
 *   - Collapsible detail view (args → result)
 *   - Duration and metadata from SkillResult envelope
 */

import { useState } from "react";
import {
  File,
  Folder,
  FolderOpen,
  Terminal,
  ChevronDown,
  ChevronRight,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  FileCode,
  FileText,
  FileJson,
  FileImage,
  Cpu,
  FilePen,
  Play,
  Search,
  Globe,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
// Type is now defined inline in ToolResultCardProps (accepts both live and persisted invocations)

// ─── File Extension → Icon Mapping ───────────────────────────────────

function FileIcon({ extension }: { extension: string }) {
  const ext = extension.toLowerCase();
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "rb", "swift", "kt"].includes(ext)) {
    return <FileCode className="size-3.5 text-primary/70" />;
  }
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) {
    return <FileJson className="size-3.5 text-accent/70" />;
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) {
    return <FileImage className="size-3.5 text-chart-5" />;
  }
  return <FileText className="size-3.5 text-muted-foreground" />;
}

// ─── File Extension → Language (for syntax hints) ────────────────────

function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", rb: "ruby", swift: "swift",
    kt: "kotlin", json: "json", yaml: "yaml", yml: "yaml",
    toml: "toml", xml: "xml", html: "html", css: "css",
    scss: "scss", md: "markdown", sh: "bash", zsh: "bash",
    sql: "sql", graphql: "graphql",
  };
  return map[ext.toLowerCase()] || "";
}

// ─── Format File Size ────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Status Badge ────────────────────────────────────────────────────

function StatusBadge({ state }: { state: "pending" | "complete" | "error" }) {
  switch (state) {
    case "complete":
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[0.55rem] text-green-500 border-green-500/30 bg-green-500/5">
          <Check className="size-2.5" /> Done
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[0.55rem] text-destructive border-destructive/30 bg-destructive/5">
          <AlertCircle className="size-2.5" /> Error
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[0.55rem] text-muted-foreground animate-pulse">
          <Loader2 className="size-2.5 animate-spin" /> Running
        </Badge>
      );
  }
}

// ─── Tool Display Names ──────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, { icon: typeof File; label: string }> = {
  readFile: { icon: File, label: "Read File" },
  listDirectory: { icon: FolderOpen, label: "List Directory" },
  systemInfo: { icon: Cpu, label: "System Info" },
  writeFile: { icon: FilePen, label: "Write File" },
  runCommand: { icon: Play, label: "Run Command" },
  webSearch: { icon: Search, label: "Web Search" },
  fetchUrl: { icon: Globe, label: "Fetch URL" },
};

// ─── ReadFile Result ─────────────────────────────────────────────────

function ReadFileResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data) return null;

  const fileName = data.path?.split("/").pop() || "file";
  const extension = data.extension || "";
  const lineCount = data.content?.split("\n").length || 0;
  const lang = extensionToLanguage(extension);

  return (
    <div className="mt-2 space-y-1">
      {/* File header */}
      <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground font-mono">
        <FileIcon extension={extension} />
        <span className="text-foreground font-medium">{fileName}</span>
        <span>·</span>
        <span>{formatSize(data.size || 0)}</span>
        <span>·</span>
        <span>{lineCount} lines</span>
        {result.status === "partial" && (
          <>
            <span>·</span>
            <Badge variant="outline" className="text-[0.5rem] text-amber-500 border-amber-500/30">truncated</Badge>
          </>
        )}
      </div>

      {/* Code content */}
      <div className="relative max-h-64 overflow-auto rounded-md bg-muted/30 ring-1 ring-border/50">
        <pre className="p-3 text-[0.7rem] leading-relaxed font-mono overflow-x-auto">
          <code className={lang ? `language-${lang}` : ""}>
            {data.content || ""}
          </code>
        </pre>
      </div>
    </div>
  );
}

// ─── ListDirectory Result ────────────────────────────────────────────

function ListDirectoryResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data?.entries) return null;

  const dirName = data.path?.split("/").pop() || "directory";

  return (
    <div className="mt-2 space-y-1">
      {/* Directory header */}
      <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground font-mono">
        <FolderOpen className="size-3.5 text-primary/70" />
        <span className="text-foreground font-medium">{dirName}/</span>
        <span>·</span>
        <span>{data.totalEntries} entries</span>
        {data.truncated && (
          <>
            <span>·</span>
            <Badge variant="outline" className="text-[0.5rem] text-amber-500 border-amber-500/30">truncated</Badge>
          </>
        )}
      </div>

      {/* Tree listing */}
      <div className="max-h-48 overflow-auto rounded-md bg-muted/30 p-2 ring-1 ring-border/50">
        <div className="space-y-0.5 font-mono text-[0.65rem]">
          {(data.entries as Array<{ name: string; type: string; size: number }>).map(
            (entry: { name: string; type: string; size: number }, i: number) => (
              <div key={i} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/50 transition-colors">
                {entry.type === "directory" ? (
                  <Folder className="size-3 text-primary/60 shrink-0" />
                ) : (
                  <File className="size-3 text-muted-foreground/60 shrink-0" />
                )}
                <span className={entry.type === "directory" ? "text-primary" : "text-foreground"}>
                  {entry.name}{entry.type === "directory" ? "/" : ""}
                </span>
                {entry.type === "file" && entry.size > 0 && (
                  <span className="ml-auto text-[0.55rem] text-muted-foreground/50">
                    {formatSize(entry.size)}
                  </span>
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SystemInfo Result ───────────────────────────────────────────────

function SystemInfoResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data) return null;

  return (
    <div className="mt-2 rounded-md bg-muted/30 p-3 ring-1 ring-border/50">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[0.65rem]">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 py-0.5">
            <span className="text-muted-foreground min-w-[5rem] shrink-0">{key}</span>
            <span className="text-foreground break-all">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WriteFile Result ────────────────────────────────────────────────

function WriteFileResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data) return null;

  const fileName = data.path?.split("/").pop() || "file";

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground font-mono">
        <FilePen className="size-3.5 text-primary/70" />
        <span className="text-foreground font-medium">{fileName}</span>
        <span>·</span>
        <span>{formatSize(data.bytesWritten || 0)}</span>
        <span>·</span>
        <Badge variant="outline" className={`text-[0.5rem] ${data.created ? 'text-green-500 border-green-500/30' : 'text-amber-500 border-amber-500/30'}`}>
          {data.created ? 'created' : 'updated'}
        </Badge>
      </div>

      {/* Diff preview */}
      {data.diff && data.diff !== "(no changes)" && (
        <div className="max-h-48 overflow-auto rounded-md bg-muted/30 ring-1 ring-border/50">
          <pre className="p-3 text-[0.65rem] leading-relaxed font-mono overflow-x-auto">
            {data.diff.split("\n").map((line: string, i: number) => (
              <div
                key={i}
                className={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? "text-green-500 bg-green-500/5"
                    : line.startsWith("-") && !line.startsWith("---")
                    ? "text-red-500 bg-red-500/5"
                    : line.startsWith("@@")
                    ? "text-blue-400"
                    : "text-muted-foreground"
                }
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── RunCommand Result ───────────────────────────────────────────────

function RunCommandResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data) return null;

  return (
    <div className="mt-2 space-y-1">
      {/* Command header */}
      <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground font-mono">
        <Terminal className="size-3.5 text-primary/70" />
        <code className="text-foreground font-medium truncate">{data.command}</code>
        <span className="ml-auto shrink-0">
          <Badge
            variant="outline"
            className={`text-[0.5rem] ${
              data.exitCode === 0
                ? 'text-green-500 border-green-500/30'
                : data.exitCode === -1
                ? 'text-amber-500 border-amber-500/30'
                : 'text-red-500 border-red-500/30'
            }`}
          >
            {data.exitCode === -1 ? 'timeout' : `exit ${data.exitCode}`}
          </Badge>
        </span>
      </div>

      {/* Output */}
      {(data.stdout || data.stderr) && (
        <div className="max-h-48 overflow-auto rounded-md bg-zinc-950/80 ring-1 ring-border/50">
          <pre className="p-3 text-[0.65rem] leading-relaxed font-mono overflow-x-auto">
            {data.stdout && <span className="text-foreground/90">{data.stdout}</span>}
            {data.stderr && <span className="text-red-400">{data.stderr}</span>}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── WebSearch Result ────────────────────────────────────────────────

function WebSearchResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data?.results) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="text-[0.6rem] text-muted-foreground font-mono">
        {data.resultCount} results for "{data.query}"
      </div>
      <div className="max-h-64 overflow-auto rounded-md bg-muted/30 p-2 ring-1 ring-border/50 space-y-1.5">
        {(data.results as Array<{ title: string; url: string; snippet: string }>).map(
          (r, i) => (
            <div key={i} className="px-2 py-1.5 rounded hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-1.5">
                <span className="text-[0.55rem] text-muted-foreground/50 font-mono w-3 shrink-0">{i + 1}</span>
                <span className="text-[0.7rem] font-medium text-primary truncate">{r.title}</span>
                <ExternalLink className="size-2.5 text-muted-foreground/40 shrink-0" />
              </div>
              <div className="ml-[1.125rem] text-[0.55rem] text-muted-foreground/60 truncate font-mono">{r.url}</div>
              {r.snippet && (
                <div className="ml-[1.125rem] mt-0.5 text-[0.6rem] text-muted-foreground leading-relaxed line-clamp-2">
                  {r.snippet}
                </div>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// ─── FetchUrl Result ─────────────────────────────────────────────────

function FetchUrlResult({ result }: { result: any }) {
  const data = result?.data;
  if (!data) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground font-mono">
        <Globe className="size-3.5 text-primary/70" />
        <span className="text-foreground font-medium truncate">{data.title || data.url}</span>
        <span>·</span>
        <span>{formatSize(data.contentLength || 0)}</span>
        {result.status === "partial" && (
          <>
            <span>·</span>
            <Badge variant="outline" className="text-[0.5rem] text-amber-500 border-amber-500/30">truncated</Badge>
          </>
        )}
      </div>
      <div className="max-h-48 overflow-auto rounded-md bg-muted/30 p-3 ring-1 ring-border/50">
        <div className="text-[0.65rem] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {data.content?.slice(0, 2000) || ""}
          {data.content?.length > 2000 && "\n... (content truncated in preview)"}
        </div>
      </div>
    </div>
  );
}

// ─── Generic Result ──────────────────────────────────────────────────

function GenericResult({ result }: { result: any }) {
  if (!result) return null;

  return (
    <div className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/30 p-3 ring-1 ring-border/50">
      <pre className="text-[0.6rem] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

/** Accepts both live ToolInvocation (from hook) and PersistedToolInvocation (from saved messages) */
interface ToolResultCardProps {
  invocation: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown | null;
    state: "pending" | "complete" | "error";
  };
}

export function ToolResultCard({ invocation }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { toolName, args, result, state } = invocation;

  const display = TOOL_DISPLAY[toolName] || { icon: Terminal, label: toolName };
  const Icon = display.icon;

  // Extract metadata from SkillResult envelope
  const skillResult = result as { data?: unknown; summary?: string; metadata?: { duration?: number }; status?: string } | null;
  const duration = skillResult?.metadata?.duration;
  const summary = skillResult?.summary;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-200 animate-in fade-in slide-in-from-bottom-2">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {/* Expand/collapse chevron */}
        {expanded ? (
          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        )}

        {/* Tool icon + name */}
        <Icon className="size-3.5 text-primary/70 shrink-0" />
        <span className="font-mono text-xs font-medium text-foreground">
          {display.label}
        </span>

        {/* Tool args summary (e.g. file path, command, query) */}
        <span className="truncate text-[0.6rem] text-muted-foreground font-mono flex-1">
          {(toolName === "readFile" || toolName === "writeFile" || toolName === "listDirectory") && args.path ? String(args.path) : ""}
          {toolName === "runCommand" && args.command ? String(args.command) : ""}
          {toolName === "webSearch" && args.query ? String(args.query) : ""}
          {toolName === "fetchUrl" && args.url ? String(args.url) : ""}
        </span>

        {/* Duration */}
        {duration !== undefined && duration > 0 && (
          <span className="flex items-center gap-0.5 text-[0.55rem] text-muted-foreground/60 font-mono shrink-0">
            <Clock className="size-2.5" />
            {duration}ms
          </span>
        )}

        {/* Status badge */}
        <StatusBadge state={state} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/40 px-3 pb-3">
          {/* Summary line */}
          {typeof summary === "string" && summary.length > 0 && (
            <p className="mt-2 text-[0.65rem] text-muted-foreground leading-relaxed">
              {summary}
            </p>
          )}

          {/* Tool-specific rich rendering */}
          {toolName === "readFile" && !!result && <ReadFileResult result={skillResult} />}
          {toolName === "listDirectory" && !!result && <ListDirectoryResult result={skillResult} />}
          {toolName === "systemInfo" && !!result && <SystemInfoResult result={skillResult} />}
          {toolName === "writeFile" && !!result && <WriteFileResult result={skillResult} />}
          {toolName === "runCommand" && !!result && <RunCommandResult result={skillResult} />}
          {toolName === "webSearch" && !!result && <WebSearchResult result={skillResult} />}
          {toolName === "fetchUrl" && !!result && <FetchUrlResult result={skillResult} />}
          {!["readFile", "listDirectory", "systemInfo", "writeFile", "runCommand", "webSearch", "fetchUrl"].includes(toolName) && !!result && (
            <GenericResult result={skillResult} />
          )}

          {/* Arguments detail (collapsed further) */}
          {Object.keys(args).length > 0 && (
            <details className="mt-2">
              <summary className="text-[0.55rem] font-mono text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors">
                Arguments
              </summary>
              <pre className="mt-1 text-[0.55rem] font-mono text-muted-foreground/70 whitespace-pre-wrap">
                {JSON.stringify(args, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
