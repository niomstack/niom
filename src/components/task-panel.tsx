/**
 * Task Panel — Drawer-based panel for viewing task progress and interacting with checkpoints.
 *
 * Uses shadcn Drawer (vaul) for the slide-out panel, and shadcn components
 * for all internal UI. No custom components — Style Guide compliant.
 *
 * Design: NIOM HUD theme — full-strength text, token-based colors, no opacity on text.
 *
 * Now uses activity-based UI instead of step-based. Shows a live feed of
 * tool calls as they happen, replacing the old StepTimeline.
 */

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  Play,
  X,
  Zap,
  AlertTriangle,
  Copy,
  Download,
  Check,
} from "lucide-react";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import type {
  Task,
  TaskToolCall,
  TaskStatus,
  TaskMeta,
  CheckpointData,
  CheckpointResponse,
  TaskCheckpointPayload,
} from "@/shared/task-types";

// ─── Status Badge ────────────────────────────────────────────────────

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const config: Record<TaskStatus, { label: string; variant: "default" | "outline" | "secondary" | "destructive"; icon?: React.ReactNode }> = {
    running: {
      label: "Running",
      variant: "default",
      icon: <Loader2 className="size-3 animate-spin" />,
    },
    checkpoint: {
      label: "Needs Input",
      variant: "default",
      icon: <AlertTriangle className="size-3" />,
    },
    completed: {
      label: "Completed",
      variant: "outline",
      icon: <CheckCircle2 className="size-3" />,
    },
    failed: {
      label: "Failed",
      variant: "destructive",
      icon: <XCircle className="size-3" />,
    },
    cancelled: {
      label: "Cancelled",
      variant: "secondary",
      icon: <X className="size-3" />,
    },
    paused: {
      label: "Paused",
      variant: "secondary",
      icon: <Pause className="size-3" />,
    },
  };

  const c = config[status] || config.running;

  return (
    <Badge variant={c.variant} className="gap-1 font-mono text-[0.65rem]">
      {c.icon}
      {c.label}
    </Badge>
  );
}

// ─── Activity Feed ───────────────────────────────────────────────────

function ActivityFeed({ activity, isRunning }: { activity: TaskToolCall[]; isRunning: boolean }) {
  if (activity.length === 0 && !isRunning) return null;

  // Show most recent first, limit to last 30 for performance
  const recentActivity = [...activity].reverse().slice(0, 30);

  return (
    <div className="space-y-0.5">
      <div className="text-[0.6rem] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        Activity — {activity.length} tool call{activity.length !== 1 ? "s" : ""}
      </div>
      <div className="relative pl-3 border-l border-border/50 space-y-1">
        {/* Pulsing dot at top if still running */}
        {isRunning && (
          <div className="flex items-center gap-1.5 py-0.5">
            <div className="size-1.5 rounded-full bg-primary/50 animate-pulse" />
            <span className="text-[0.6rem] text-muted-foreground italic">Working...</span>
          </div>
        )}

        {recentActivity.map((tc) => {
          const isActive = tc.status === "running";
          const isDone = tc.status === "completed";
          const isError = tc.status === "error";
          const durationMs = tc.completedAt ? tc.completedAt - tc.startedAt : null;

          return (
            <div
              key={tc.id}
              className={`flex items-start gap-1.5 py-0.5 text-[0.65rem] ${
                isActive ? "animate-pulse" : ""
              }`}
            >
              {/* Status dot */}
              <div className="shrink-0 mt-0.5">
                {isActive ? (
                  <Loader2 className="size-2.5 animate-spin text-primary" />
                ) : isDone ? (
                  <CheckCircle2 className="size-2.5 text-primary/70" />
                ) : isError ? (
                  <XCircle className="size-2.5 text-destructive/70" />
                ) : null}
              </div>

              {/* Tool name */}
              <span className="font-mono text-foreground/80 shrink-0">
                {tc.toolName}
              </span>

              {/* Summary */}
              {tc.summary && (
                <span className="text-muted-foreground truncate">
                  — {tc.summary}
                </span>
              )}

              {/* Duration */}
              {durationMs != null && (
                <span className="ml-auto text-muted-foreground/60 shrink-0 font-mono">
                  {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          );
        })}

        {/* Show count if there are more than 30 */}
        {activity.length > 30 && (
          <div className="text-[0.6rem] text-muted-foreground/60 font-mono py-0.5">
            ... and {activity.length - 30} earlier tool calls
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Checkpoint Card ─────────────────────────────────────────────────

function CheckpointCard({
  checkpoint,
  taskId,
  onRespond,
}: {
  checkpoint: CheckpointData;
  taskId: string;
  onRespond: (response: CheckpointResponse) => void;
}) {
  const [guidance, setGuidance] = useState("");
  const showGuidanceInput = checkpoint.actions.some((a) => a.type === "modify");
  const isError = checkpoint.type === "error";

  return (
    <Card className="animate-in slide-in-from-bottom-2 duration-300 border-primary overflow-hidden">
      {/* Header bar */}
      <div className={`flex items-center gap-2 px-3 py-2 ${
        isError ? "bg-destructive/10" : "bg-primary/5"
      }`}>
        <AlertTriangle className={`size-3.5 shrink-0 ${isError ? "text-destructive" : "text-primary"}`} />
        <span className="font-mono text-[0.65rem] font-medium uppercase tracking-wider text-foreground">
          {isError ? "Error" : "Checkpoint"}
        </span>
        <span className="ml-auto text-[0.6rem] text-muted-foreground font-mono">
          {checkpoint.summary}
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* Findings */}
        {checkpoint.findings && checkpoint.findings.length > 0 && (
          <div className="space-y-1.5">
            {checkpoint.findings.map((finding, i) => (
              <div
                key={i}
                className="text-xs text-muted-foreground leading-relaxed pl-2"
                dangerouslySetInnerHTML={{
                  __html: finding
                    .replace(/\*\*(.*?)\*\*/g, '<span class="text-foreground font-medium">$1</span>')
                }}
              />
            ))}
          </div>
        )}

        {/* Error detail */}
        {checkpoint.error && (
          <div className="rounded-md bg-destructive/5 border border-destructive/20 p-2 text-xs text-destructive font-mono">
            {checkpoint.error}
          </div>
        )}

        {/* Guidance input (for modify action) */}
        {showGuidanceInput && (
          <Textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Optional: Add guidance to adjust the approach..."
            className="min-h-[48px] font-mono text-xs"
            rows={2}
          />
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {checkpoint.actions.map((action) => {
            const isDestructive = action.type === "stop";
            const isPrimary = action.type === "continue" || action.type === "retry";

            return (
              <Button
                key={action.type}
                variant={isDestructive ? "destructive" : isPrimary ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs font-mono gap-1"
                onClick={() => onRespond({
                  taskId,
                  checkpointId: checkpoint.id,
                  action: action.type,
                  guidance: action.type === "modify" ? guidance : undefined,
                })}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── Deliverable View ────────────────────────────────────────────────

function DeliverableView({ text, taskGoal }: { text: string; taskGoal?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = (taskGoal || "deliverable")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50)
      + ".md";

    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <CheckCircle2 className="size-3.5" />
          Task Complete — Deliverable
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[0.65rem] gap-1 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[0.65rem] gap-1 text-muted-foreground hover:text-foreground"
            onClick={handleDownload}
          >
            <Download className="size-3" />
            Save .md
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-3 max-h-[400px] overflow-y-auto">
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs [&_pre]:rounded-md [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:text-[0.65rem] [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:mt-2.5 [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:mt-2 [&_h3]:mb-1 [&_h4]:text-xs [&_table]:text-[0.65rem] [&_strong]:text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ─── Token Usage Display ─────────────────────────────────────────────

function TokenUsage({ usage }: { usage: Task["totalUsage"] }) {
  if (!usage || usage.totalTokens === 0) return null;

  return (
    <div className="flex items-center gap-3 text-[0.6rem] text-muted-foreground font-mono">
      <span>↓ {(usage.inputTokens || 0).toLocaleString()}</span>
      <span>↑ {(usage.outputTokens || 0).toLocaleString()}</span>
      <span>Σ {(usage.totalTokens || 0).toLocaleString()}</span>
    </div>
  );
}

// ─── Task Panel (Drawer) ─────────────────────────────────────────────

interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  checkpoint: TaskCheckpointPayload | null;
  onRespond: (response: CheckpointResponse) => void;
  onPause: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onResume?: (taskId: string) => void;
}

export function TaskPanel({
  isOpen,
  onClose,
  task,
  checkpoint,
  onRespond,
  onPause,
  onCancel,
  onResume,
}: TaskPanelProps) {
  // Live elapsed timer for running tasks
  const [now, setNow] = useState(Date.now());
  const isActive = task ? task.status === "running" : false;
  const isCheckpoint = task?.status === "checkpoint";

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!task) return null;

  const isPaused = task.status === "paused";
  const isCompleted = task.status === "completed";
  const isFailed = task.status === "failed";

  const elapsed = task.completedAt
    ? Math.round((task.completedAt - task.createdAt) / 1000)
    : Math.round((now - task.createdAt) / 1000);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `${m}m ${rem}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()} direction="right">
      <DrawerContent className="w-[520px] sm:w-[560px] !max-w-[560px] overflow-hidden flex flex-col">
        <DrawerHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-sm font-medium truncate max-w-[280px]">
              Task
            </DrawerTitle>
            <TaskStatusBadge status={task.status} />
          </div>
          <DrawerDescription className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {task.goal}
          </DrawerDescription>

          {/* Stats bar */}
          <div className="flex items-center gap-3 mt-1.5">
            <Badge variant="secondary" className="font-mono text-[0.6rem] gap-1">
              <Zap className="size-2.5" />
              {task.toolCallCount} tool calls
            </Badge>
            <Badge variant="secondary" className="font-mono text-[0.6rem] gap-1">
              <Clock className="size-2.5" />
              {formatElapsed(elapsed)}
            </Badge>
            <TokenUsage usage={task.totalUsage} />
          </div>
        </DrawerHeader>

        <Separator />

        {/* Controls */}
        {(isActive || isPaused) && (
          <div className="flex items-center gap-2 px-4 py-2 shrink-0">
            {isActive && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 font-mono"
                onClick={() => onPause(task.id)}
              >
                <Pause className="size-3" />
                Pause
              </Button>
            )}
            {isPaused && onResume && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 font-mono"
                onClick={() => onResume(task.id)}
              >
                <Play className="size-3" />
                Resume
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 font-mono text-destructive border-destructive hover:bg-destructive/10"
              onClick={() => onCancel(task.id)}
            >
              <X className="size-3" />
              Cancel
            </Button>
          </div>
        )}

        {/* Resume/Retry prompt for failed tasks */}
        {isFailed && onResume && (
          <div className="flex items-center gap-2 px-4 py-2 shrink-0">
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1 font-mono"
              onClick={() => onResume(task.id)}
            >
              <Play className="size-3" />
              Retry Task
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 font-mono text-destructive border-destructive hover:bg-destructive/10"
              onClick={() => onCancel(task.id)}
            >
              <X className="size-3" />
              Cancel
            </Button>
          </div>
        )}

        {/* Scrollable content */}
        <ScrollArea className="flex-1 min-h-0 px-4">
          <div className="space-y-4 py-4">
            {/* Active checkpoint */}
            {isCheckpoint && checkpoint?.checkpoint && (
              <CheckpointCard
                checkpoint={checkpoint.checkpoint}
                taskId={task.id}
                onRespond={onRespond}
              />
            )}

            {/* Deliverable */}
            {isCompleted && task.deliverable && (
              <DeliverableView text={task.deliverable} taskGoal={task.goal} />
            )}

            {/* Activity feed */}
            {task.activity.length > 0 && (
              <ActivityFeed activity={task.activity} isRunning={isActive} />
            )}
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}

// ─── Task Indicator (for chat header) ────────────────────────────────

interface TaskIndicatorProps {
  runningCount: number;
  hasCheckpoint: boolean;
  totalCount: number;
  onClick: () => void;
}

export function TaskIndicator({ runningCount, hasCheckpoint, totalCount, onClick }: TaskIndicatorProps) {
  if (totalCount === 0) return null;

  const isActive = runningCount > 0;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 gap-1.5 font-mono text-xs px-2 relative ${
        hasCheckpoint
          ? "text-primary"
          : isActive
          ? "text-primary"
          : "text-muted-foreground"
      }`}
      onClick={onClick}
    >
      {isActive && (
        <span className="absolute -top-0.5 -right-0.5 flex size-2">
          <span className="absolute inline-flex size-full rounded-full opacity-75 animate-ping bg-primary" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      )}

      <Zap className="size-3" />
      {runningCount > 0 ? (
        <span>{runningCount} running</span>
      ) : (
        <span>{totalCount} task{totalCount !== 1 ? "s" : ""}</span>
      )}
    </Button>
  );
}

// ─── Task List (for home view) ───────────────────────────────────────

interface TaskListProps {
  tasks: TaskMeta[];
  onSelect: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

export function TaskList({ tasks, onSelect, onDelete }: TaskListProps) {
  if (tasks.length === 0) return null;

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getStatusIcon = (status: TaskStatus) => {
    if (status === "running") {
      return <Loader2 className="size-4 animate-spin text-primary" />;
    }
    if (status === "completed") return <CheckCircle2 className="size-4 text-primary" />;
    if (status === "failed") return <XCircle className="size-4 text-destructive" />;
    if (status === "checkpoint") {
      return <AlertTriangle className="size-4 text-primary" />;
    }
    return <Pause className="size-4 text-muted-foreground" />;
  };

  return (
    <div className="w-full max-w-xl">
      <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground mb-2">
        Background Tasks
      </p>
      <ScrollArea className="max-h-80 -mx-4 -my-6">
        <ItemGroup className="px-4 py-6">
        {tasks.map((task) => (
          <div key={task.id} className="group/task relative">
            <Item
              variant="outline"
              size="sm"
              className="cursor-pointer bg-card transition-all hover:bg-muted/50 hover:shadow-[0_4px_16px_oklch(0_0_0/0.12)] dark:hover:shadow-[0_0_15px_oklch(0.74_0.14_290/0.1)] pr-10"
              onClick={() => onSelect(task.id)}
            >
              <ItemMedia variant="icon">
                {getStatusIcon(task.status)}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {task.goal.slice(0, 60)}{task.goal.length > 60 ? "…" : ""}
                </ItemTitle>
                <ItemDescription>
                  {task.toolCallCount} tool calls · {formatTime(task.updatedAt)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <TaskStatusBadge status={task.status} />
              </ItemActions>
            </Item>

            <ConfirmDeleteButton
              onDelete={() => onDelete(task.id)}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/task:opacity-100 transition-opacity"
            />
          </div>
        ))}
        </ItemGroup>
      </ScrollArea>
    </div>
  );
}
