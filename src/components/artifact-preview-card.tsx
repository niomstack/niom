/**
 * ArtifactPreviewCard — Rich file preview card rendered inline in chat.
 *
 * Shows a staged artifact with:
 * - Syntax-highlighted code preview (collapsed or expanded)
 * - Inline Monaco editor for editing before applying
 * - Monaco DiffEditor for modifications (original vs proposed)
 * - Apply/Skip/Edit actions
 */

import { useState, useCallback, useRef, lazy, Suspense } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  FilePlus,
  FilePen,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  GitCompare,
  Save,
} from "lucide-react";

// Lazy-load Monaco — it's large (~4MB), don't block initial render
const MonacoEditor = lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.Editor })));
const MonacoDiffEditor = lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })));

// ─── Types ───────────────────────────────────────────────────────────

interface ArtifactPreviewProps {
  /** Artifact data from the tool result */
  artifact: {
    artifactId: string;
    targetPath: string;
    content: string;
    language: string;
    description: string;
    isModification: boolean;
    originalContent?: string;
    threadId: string;
  };
  /** Called when the user applies this artifact */
  onApply?: (artifactId: string, threadId: string) => void;
  /** Called when the user skips/dismisses this artifact */
  onSkip?: (artifactId: string, threadId: string) => void;
}

// ─── Language Mapping ────────────────────────────────────────────────

/** Map our language names to Monaco language IDs */
const MONACO_LANG: Record<string, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  rust: "rust",
  go: "go",
  json: "json",
  yaml: "yaml",
  markdown: "markdown",
  html: "html",
  css: "css",
  shell: "shell",
  bash: "shell",
  tsx: "typescript",
  jsx: "javascript",
  scss: "scss",
  less: "less",
  sql: "sql",
  graphql: "graphql",
  dockerfile: "dockerfile",
  toml: "ini",
};

const LANG_COLORS: Record<string, string> = {
  typescript: "text-blue-400",
  javascript: "text-yellow-400",
  python: "text-green-400",
  rust: "text-orange-400",
  go: "text-cyan-400",
  json: "text-emerald-400",
  yaml: "text-rose-400",
  markdown: "text-purple-400",
  html: "text-red-400",
  css: "text-sky-400",
  shell: "text-lime-400",
};

// ─── Component ───────────────────────────────────────────────────────

type CardMode = "preview" | "edit" | "diff";

export function ArtifactPreviewCard({
  artifact,
  onApply,
  onSkip,
}: ArtifactPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"pending" | "applying" | "applied" | "skipped">("pending");
  const [mode, setMode] = useState<CardMode>("preview");
  const [editedContent, setEditedContent] = useState(artifact.content);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<any>(null);

  const fileName = artifact.targetPath.split("/").pop() || "file";
  const dirPath = artifact.targetPath.split("/").slice(0, -1).join("/");
  const langColor = LANG_COLORS[artifact.language] || "text-muted-foreground";
  const monacoLang = MONACO_LANG[artifact.language] || artifact.language;
  const previewLines = editedContent.split("\n");
  const totalLines = previewLines.length;
  const PREVIEW_LIMIT = 20;
  const isDirty = editedContent !== artifact.content;

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    setStatus("applying");
    try {
      // If user edited, save first
      if (isDirty) {
        await window.niom.drafts.update(artifact.threadId, artifact.artifactId, editedContent);
      }
      const result = await window.niom.drafts.apply(artifact.threadId, artifact.artifactId);
      if (result.success) {
        setStatus("applied");
        onApply?.(artifact.artifactId, artifact.threadId);
      } else {
        setStatus("pending");
      }
    } catch {
      setStatus("pending");
    }
  }, [artifact.artifactId, artifact.threadId, editedContent, isDirty, onApply]);

  const handleSkip = useCallback(() => {
    setStatus("skipped");
    window.niom.drafts.discard(artifact.threadId, artifact.artifactId);
    onSkip?.(artifact.artifactId, artifact.threadId);
  }, [artifact.artifactId, artifact.threadId, onSkip]);

  const handleSaveEdit = useCallback(async () => {
    setSaving(true);
    try {
      await window.niom.drafts.update(artifact.threadId, artifact.artifactId, editedContent);
      setSaving(false);
      setMode("preview");
    } catch {
      setSaving(false);
    }
  }, [artifact.threadId, artifact.artifactId, editedContent]);

  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor;
  }, []);

  // ─── Applied / Skipped State ─────────────────────────────────────

  if (status === "applied") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs font-mono">
        <Check className="size-3.5 text-green-500" />
        <span className="text-green-400">{fileName}</span>
        <span className="text-muted-foreground">— Applied</span>
        {isDirty && (
          <Badge variant="outline" className="text-[0.55rem] px-1 py-0 text-blue-400 border-blue-400/30">
            Edited
          </Badge>
        )}
        <Badge variant="outline" className="ml-auto text-[0.55rem] border-green-500/30 text-green-500">
          {artifact.isModification ? "Updated" : "Created"}
        </Badge>
      </div>
    );
  }

  if (status === "skipped") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-muted/30 bg-muted/5 px-3 py-2 text-xs font-mono opacity-60">
        <X className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground line-through">{fileName}</span>
        <span className="text-muted-foreground">&mdash; Skipped</span>
      </div>
    );
  }

  // ─── Preview / Edit / Diff ─────────────────────────────────────────

  const visibleLines = expanded || mode !== "preview"
    ? previewLines
    : previewLines.slice(0, PREVIEW_LIMIT);

  return (
    <Card className="border-primary/15 bg-primary/[0.02] overflow-hidden">
      {/* Header */}
      <CardHeader className="px-3 py-2 flex flex-row items-center gap-2">
        {/* File icon */}
        {artifact.isModification ? (
          <FilePen className="size-4 text-amber-400 shrink-0" />
        ) : (
          <FilePlus className="size-4 text-green-400 shrink-0" />
        )}

        {/* File name + path */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-medium truncate">{fileName}</span>
            <Badge variant="outline" className={`text-[0.55rem] px-1 py-0 ${langColor} border-current/30`}>
              {artifact.language}
            </Badge>
            {artifact.isModification && (
              <Badge variant="outline" className="text-[0.55rem] px-1 py-0 text-amber-400 border-amber-400/30">
                Modified
              </Badge>
            )}
            {isDirty && (
              <Badge variant="outline" className="text-[0.55rem] px-1 py-0 text-blue-400 border-blue-400/30 animate-pulse">
                Edited
              </Badge>
            )}
          </div>
          {dirPath && (
            <span className="text-[0.65rem] text-muted-foreground font-mono truncate block">
              {dirPath}
            </span>
          )}
        </div>

        {/* Mode toggles */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Diff toggle — only for modifications with original content */}
          {artifact.isModification && artifact.originalContent && (
            <Button
              variant={mode === "diff" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setMode(mode === "diff" ? "preview" : "diff")}
              className="size-6"
              title="Toggle diff view"
            >
              <GitCompare className="size-3.5" />
            </Button>
          )}

          {/* Edit toggle */}
          <Button
            variant={mode === "edit" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
            className="size-6"
            title="Edit before applying"
          >
            <Pencil className="size-3.5" />
          </Button>

          {/* Expand toggle (only in preview mode) */}
          {mode === "preview" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpanded(!expanded)}
              className="size-6"
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      {/* Description */}
      <div className="px-3 pb-1.5">
        <p className="text-xs text-muted-foreground">{artifact.description}</p>
      </div>

      {/* Content area — switches between preview, editor, and diff */}
      <CardContent className="px-0 pb-0">
        <div className="border-t border-border/50 bg-black/20">
          {mode === "preview" && (
            /* Static code preview */
            <pre className="overflow-x-auto p-3 text-xs font-mono leading-relaxed">
              <code>
                {visibleLines.map((line, i) => (
                  <div key={i} className="flex">
                    <span className="inline-block w-8 shrink-0 text-right pr-3 text-muted-foreground/50 select-none">
                      {i + 1}
                    </span>
                    <span className="text-foreground/80">{line || "\n"}</span>
                  </div>
                ))}
                {!expanded && totalLines > PREVIEW_LIMIT && (
                  <div
                    className="flex items-center gap-1 pt-1 text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors"
                    onClick={() => setExpanded(true)}
                  >
                    <span className="inline-block w-8 shrink-0" />
                    <FileText className="size-3" />
                    <span className="text-[0.65rem]">
                      +{totalLines - PREVIEW_LIMIT} more lines
                    </span>
                  </div>
                )}
              </code>
            </pre>
          )}

          {mode === "edit" && (
            /* Monaco Editor */
            <Suspense fallback={
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="size-4 animate-spin mr-2" />
                Loading editor…
              </div>
            }>
              <MonacoEditor
                height={Math.min(Math.max(totalLines * 19, 200), 500)}
                language={monacoLang}
                value={editedContent}
                onChange={(val) => setEditedContent(val || "")}
                onMount={handleEditorMount}
                theme="vs-dark"
                options={{
                  fontSize: 12,
                  lineHeight: 19,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  lineNumbers: "on",
                  renderLineHighlight: "gutter",
                  overviewRulerBorder: false,
                  hideCursorInOverviewRuler: true,
                  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                  wordWrap: "on",
                  tabSize: 2,
                  automaticLayout: true,
                }}
              />
            </Suspense>
          )}

          {mode === "diff" && artifact.originalContent != null && (
            /* Monaco Diff Editor */
            <Suspense fallback={
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="size-4 animate-spin mr-2" />
                Loading diff view…
              </div>
            }>
              <MonacoDiffEditor
                height={Math.min(Math.max(totalLines * 19, 200), 500)}
                language={monacoLang}
                original={artifact.originalContent}
                modified={editedContent}
                theme="vs-dark"
                options={{
                  fontSize: 12,
                  lineHeight: 19,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  renderSideBySide: true,
                  readOnly: true,
                  overviewRulerBorder: false,
                  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                  automaticLayout: true,
                }}
              />
            </Suspense>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
          <span className="flex-1 text-[0.65rem] text-muted-foreground font-mono">
            {totalLines} lines
            {mode === "edit" && isDirty && (
              <span className="text-blue-400 ml-2">• unsaved changes</span>
            )}
          </span>

          {/* Save button (edit mode with changes) */}
          {mode === "edit" && isDirty && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveEdit}
              disabled={saving}
              className="h-7 px-2 text-xs text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
            >
              {saving ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <Save className="size-3 mr-1" />
              )}
              Save
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            <X className="size-3 mr-1" />
            Skip
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={status === "applying"}
            className="h-7 px-3 text-xs bg-green-600 hover:bg-green-500 text-white"
          >
            {status === "applying" ? (
              <>
                <Loader2 className="size-3 mr-1 animate-spin" />
                Applying…
              </>
            ) : (
              <>
                <Check className="size-3 mr-1" />
                Apply
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Batch Action Bar ────────────────────────────────────────────────

interface BatchActionsProps {
  threadId: string;
  artifactCount: number;
  onApplyAll?: () => void;
  onDismissAll?: () => void;
}

export function ArtifactBatchActions({
  threadId,
  artifactCount,
  onApplyAll,
  onDismissAll,
}: BatchActionsProps) {
  const [applying, setApplying] = useState(false);

  const handleApplyAll = useCallback(async () => {
    setApplying(true);
    try {
      await window.niom.drafts.applyAll(threadId);
      onApplyAll?.();
    } finally {
      setApplying(false);
    }
  }, [threadId, onApplyAll]);

  const handleDismissAll = useCallback(async () => {
    await window.niom.drafts.discardAll(threadId);
    onDismissAll?.();
  }, [threadId, onDismissAll]);

  if (artifactCount < 2) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <Button
        size="sm"
        onClick={handleApplyAll}
        disabled={applying}
        className="h-7 px-4 text-xs bg-green-600 hover:bg-green-500 text-white"
      >
        {applying ? (
          <>
            <Loader2 className="size-3 mr-1 animate-spin" />
            Applying all…
          </>
        ) : (
          <>
            <Check className="size-3 mr-1" />
            Apply All ({artifactCount})
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDismissAll}
        className="h-7 px-3 text-xs text-muted-foreground hover:text-destructive"
      >
        Dismiss All
      </Button>
    </div>
  );
}
