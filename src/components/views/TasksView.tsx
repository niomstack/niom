/**
 * TasksView — Global task management panel.
 *
 * Uses Item components for consistent HUD styling and
 * Accordion for expandable task detail / run history.
 */

import { useState } from "react";
import { ArrowLeft, Play, Pause, Zap, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { ScrollArea } from "../ui/scroll-area";
import {
    Item,
    ItemContent,
    ItemTitle,
    ItemDescription,
    ItemMedia,
    ItemGroup,
} from "../ui/item";
import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
} from "../ui/accordion";
import { Markdown } from "../../Markdown";
import { ToolCallRow } from "../ToolCallDisplay";
import type { ToolCall } from "../ToolCallDisplay";
import { ThinkingDots } from "../Icons";
import { cn } from "../../lib/utils";
import { useTasks } from "../../hooks/useTasks";
import {
    STATUS_CONFIG,
    TYPE_LABELS,
    formatRelativeTime,
    formatFutureTime,
    formatDuration,
} from "../tasks/task-types";

// ── Component ──

interface TasksViewProps {
    onBack: () => void;
}

export function TasksView({ onBack }: TasksViewProps) {
    const {
        activeTasks,
        completedTasks,
        loading,
        selectedTaskId,
        setSelectedTaskId,
        taskDetail,
        taskRuns,
        actionLoading,
        handleAction,
        handleDelete,
        handleApprove,
        handleUpdate,
    } = useTasks();

    const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set());
    const [approvalNotes, setApprovalNotes] = useState("");

    // Editing state
    const [editing, setEditing] = useState<string | null>(null);
    const [editGoal, setEditGoal] = useState("");

    const toggleToolExpand = (id: string) => {
        setExpandedToolIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    // ── Loading state ──
    if (loading) {
        return (
            <div className="flex flex-col h-full">
                <TasksHeader onBack={onBack} count={0} />
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-text-tertiary">
                        <Zap className="w-6 h-6 opacity-40 animate-pulse" />
                        <span className="text-[11px] font-mono">Loading tasks…</span>
                    </div>
                </div>
            </div>
        );
    }

    // ── Detail View ──
    if (selectedTaskId && taskDetail) {
        const cfg = STATUS_CONFIG[taskDetail.status] || STATUS_CONFIG.draft;
        const isGraduated = taskDetail.approval.mode === "first_n" && taskDetail.approval.approvedRuns >= taskDetail.approval.firstN;

        return (
            <div className="flex flex-col h-full overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle/50 shrink-0">
                    <button
                        onClick={() => { setSelectedTaskId(null); setEditing(null); }}
                        className="w-7 h-7 flex items-center justify-center bg-transparent border border-border-subtle/30 cursor-pointer hover:bg-[rgba(91,63,230,0.06)] hover:border-accent/30 transition-all text-text-tertiary hover:text-accent"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className={cn("text-base", cfg.color)}>{cfg.icon}</span>
                    <span className="text-[11px] font-mono font-medium text-text-primary truncate flex-1">
                        {taskDetail.goal.slice(0, 60)}
                    </span>
                    <span className={cn("text-[9px] font-mono uppercase tracking-wider", cfg.color)}>
                        {cfg.label}
                    </span>
                </div>

                {/* Fixed meta section — Goal, Stats, Schedule, Controls */}
                <div className="px-5 py-4 space-y-3 border-b border-border-subtle/30 shrink-0">
                    {/* Goal — editable */}
                    <div className="space-y-2">
                        <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-tertiary">Goal</div>
                        {editing === "goal" ? (
                            <div className="flex gap-2">
                                <input
                                    className="flex-1 bg-surface-card border border-border-subtle px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent/40 transition-colors font-mono"
                                    value={editGoal}
                                    onChange={e => setEditGoal(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => {
                                        if (e.key === "Enter") { handleUpdate(taskDetail.id, { goal: editGoal.trim() }); setEditing(null); }
                                        if (e.key === "Escape") setEditing(null);
                                    }}
                                />
                                <Button variant="ghost" size="icon-sm" onClick={() => { handleUpdate(taskDetail.id, { goal: editGoal.trim() }); setEditing(null); }}>
                                    <Zap className="w-3 h-3" />
                                </Button>
                            </div>
                        ) : (
                            <div
                                className="text-[12px] text-text-secondary leading-relaxed cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => { setEditGoal(taskDetail.goal); setEditing("goal"); }}
                            >
                                {taskDetail.goal}
                            </div>
                        )}
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-[10px] font-mono text-text-muted">
                        <span>{TYPE_LABELS[taskDetail.taskType] || taskDetail.taskType}</span>
                        <span>·</span>
                        <span>{taskDetail.totalRuns} runs ({taskDetail.successfulRuns} ✓)</span>
                        {taskDetail.lastRunAt && (
                            <>
                                <span>·</span>
                                <span>Last: {formatRelativeTime(taskDetail.lastRunAt)}</span>
                            </>
                        )}
                        {isGraduated && (
                            <>
                                <span>·</span>
                                <span className="text-emerald-600">🎓 Auto-approved</span>
                            </>
                        )}
                    </div>

                    {/* Schedule info */}
                    {taskDetail.schedule && (
                        <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted">
                            <span>Every {taskDetail.schedule.interval}</span>
                            <span>·</span>
                            <span>Runs: {taskDetail.schedule.runCount}{taskDetail.schedule.maxRuns ? `/${taskDetail.schedule.maxRuns}` : "/∞"}</span>
                            {taskDetail.status === "scheduled" && (
                                <>
                                    <span>·</span>
                                    <span className="text-accent">Next: {formatFutureTime(taskDetail.schedule.nextRunAt)}</span>
                                </>
                            )}
                        </div>
                    )}

                    {/* Controls */}
                    <div className="flex items-center gap-2">
                        {(taskDetail.status === "running" || taskDetail.status === "scheduled") && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" onClick={() => handleAction(taskDetail.id, "pause")} disabled={actionLoading === `${taskDetail.id}:pause`} className="hover:bg-amber-600/10 hover:text-amber-600">
                                        <Pause className="w-3.5 h-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Pause</TooltipContent>
                            </Tooltip>
                        )}
                        {taskDetail.status === "paused" && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" onClick={() => handleAction(taskDetail.id, "resume")} disabled={actionLoading === `${taskDetail.id}:resume`} className="hover:bg-emerald-600/10 hover:text-emerald-600">
                                        <Play className="w-3.5 h-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Resume</TooltipContent>
                            </Tooltip>
                        )}
                        {(taskDetail.status === "draft" || taskDetail.status === "planned") && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" onClick={() => handleAction(taskDetail.id, "start")} disabled={actionLoading === `${taskDetail.id}:start`} className="hover:bg-emerald-400/10 hover:text-emerald-400">
                                        <Play className="w-3.5 h-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Start</TooltipContent>
                            </Tooltip>
                        )}
                        {!["running", "completed", "cancelled"].includes(taskDetail.status) && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" onClick={() => handleAction(taskDetail.id, "run")} disabled={actionLoading === `${taskDetail.id}:run`} className="hover:bg-accent/10 hover:text-accent">
                                        <Zap className="w-3.5 h-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Run Now</TooltipContent>
                            </Tooltip>
                        )}
                        {!["completed", "cancelled"].includes(taskDetail.status) && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" onClick={() => handleAction(taskDetail.id, "cancel")} disabled={actionLoading === `${taskDetail.id}:cancel`} className="hover:bg-red-600/10 hover:text-red-600">
                                        <X className="w-3.5 h-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Cancel</TooltipContent>
                            </Tooltip>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(taskDetail.id)} disabled={actionLoading === `${taskDetail.id}:delete`} className="hover:bg-red-600/10 hover:text-red-600">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Delete</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {/* Scrollable: Plan, Memory, Runs */}
                <ScrollArea className="flex-1 min-h-0">
                    <div className="px-5 py-4">
                        <Accordion type="multiple" defaultValue={["runs"]}>
                            {/* Plan Phases */}
                            {taskDetail.plan.phases.length > 0 && (
                                <AccordionItem value="plan">
                                    <AccordionTrigger>
                                        <span>Plan · {taskDetail.plan.phases.length} phases</span>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="flex flex-col gap-1.5">
                                            {taskDetail.plan.phases.map((phase, i) => {
                                                const phaseIcon = phase.status === "completed" ? "✓" : phase.status === "running" ? "⚡" : phase.status === "failed" ? "✗" : `${i + 1}`;
                                                const phaseColor = phase.status === "completed" ? "text-emerald-600" : phase.status === "running" ? "text-accent" : phase.status === "failed" ? "text-red-600" : "text-text-muted";
                                                return (
                                                    <div key={phase.id} className="flex items-center gap-2 text-[11px]">
                                                        <span className={cn("w-4 text-center font-mono text-[10px]", phaseColor)}>{phaseIcon}</span>
                                                        <span className="text-text-secondary">{phase.description}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="text-[10px] text-text-muted mt-2 font-mono">Quality: {taskDetail.plan.qualityCriteria}</div>
                                    </AccordionContent>
                                </AccordionItem>
                            )}

                            {/* Memory */}
                            {(taskDetail.memory.findings.length > 0 || taskDetail.memory.filesCreated.length > 0) && (
                                <AccordionItem value="memory">
                                    <AccordionTrigger>
                                        <span>Memory · {taskDetail.memory.findings.length} findings</span>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        {taskDetail.memory.findings.length > 0 && (
                                            <div className="mb-2">
                                                <div className="text-[10px] text-text-muted mb-1 font-mono">Findings</div>
                                                {taskDetail.memory.findings.slice(-5).map((f, i) => (
                                                    <div key={i} className="text-[10px] text-text-secondary truncate pl-2 border-l-2 border-border-subtle mb-0.5">{f}</div>
                                                ))}
                                            </div>
                                        )}
                                        {taskDetail.memory.filesCreated.length > 0 && (
                                            <div>
                                                <div className="text-[10px] text-text-muted mb-1 font-mono">Files created ({taskDetail.memory.filesCreated.length})</div>
                                                {taskDetail.memory.filesCreated.slice(-5).map((f, i) => (
                                                    <div key={i} className="text-[10px] text-text-secondary truncate pl-2 font-mono">{f}</div>
                                                ))}
                                            </div>
                                        )}
                                    </AccordionContent>
                                </AccordionItem>
                            )}

                            {/* Run History */}
                            <AccordionItem value="runs">
                                <AccordionTrigger>
                                    <span>Run History · {taskRuns.length} runs</span>
                                </AccordionTrigger>
                                <AccordionContent>
                                    {taskRuns.length === 0 ? (
                                        <div className="text-[11px] text-text-muted py-2 font-mono">No runs yet</div>
                                    ) : (
                                        <Accordion type="single" collapsible>
                                            {taskRuns.map(run => {
                                                const runCfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.draft;
                                                const needsApproval = run.status === "pending_approval";
                                                return (
                                                    <AccordionItem key={run.id} value={run.id}>
                                                        <AccordionTrigger className="py-2 text-[10px]">
                                                            <div className="flex items-center gap-2 flex-1">
                                                                <span className="text-[11px]">{needsApproval ? "⏳" : runCfg.icon}</span>
                                                                <span className="font-mono font-medium text-text-primary">Run #{run.runNumber}</span>
                                                                {run.durationMs != null && (
                                                                    <span className="text-text-muted font-normal">{formatDuration(run.durationMs)}</span>
                                                                )}
                                                                {run.toolCalls && run.toolCalls.length > 0 && (
                                                                    <span className="text-text-muted font-normal">{run.toolCalls.length} tools</span>
                                                                )}
                                                                <span className="flex-1" />
                                                                {run.evaluation && (
                                                                    <span className={cn("font-mono", run.evaluation.satisfied ? "text-emerald-600" : "text-amber-600")}>
                                                                        {(run.evaluation.qualityScore * 100).toFixed(0)}%
                                                                    </span>
                                                                )}
                                                                <span className={cn(needsApproval ? "text-amber-600" : runCfg.color, "font-normal")}>
                                                                    {needsApproval ? "Awaiting approval" : runCfg.label}
                                                                </span>
                                                            </div>
                                                        </AccordionTrigger>
                                                        <AccordionContent>
                                                            {/* Error */}
                                                            {run.error && (
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-red-600 bg-red-600/10 px-2 py-0.5">Error</span>
                                                                    <span className="text-[11px] text-red-600/80 font-mono">{run.error}</span>
                                                                </div>
                                                            )}

                                                            {/* Tool calls */}
                                                            {run.toolCalls && run.toolCalls.length > 0 && (
                                                                <div className="flex flex-col gap-0.5 mb-2">
                                                                    {run.toolCalls.map((tc, i) => {
                                                                        const tcId = `${run.id}-tc-${i}`;
                                                                        const toolCall: ToolCall = {
                                                                            id: tcId,
                                                                            toolName: tc.tool,
                                                                            input: tc.input,
                                                                            output: tc.output,
                                                                            status: "complete",
                                                                        };
                                                                        return (
                                                                            <ToolCallRow
                                                                                key={tcId}
                                                                                tc={toolCall}
                                                                                isExpanded={expandedToolIds.has(tcId)}
                                                                                onToggle={() => toggleToolExpand(tcId)}
                                                                            />
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            {/* Thinking */}
                                                            {run.status === "running" && !run.output && (
                                                                <div className="flex items-center gap-2 py-1">
                                                                    <ThinkingDots />
                                                                    <span className="text-[11px] text-text-muted animate-pulse font-mono">Working…</span>
                                                                </div>
                                                            )}

                                                            {/* Output */}
                                                            {run.output && (
                                                                <div className="text-text-secondary text-[12px]">
                                                                    <Markdown content={run.output} />
                                                                </div>
                                                            )}

                                                            {/* Evaluation */}
                                                            {run.evaluation && (
                                                                <div className="flex items-center gap-2 mt-2 text-[10px] font-mono">
                                                                    <span>{run.evaluation.satisfied ? "✅" : "⚠️"}</span>
                                                                    <span className={run.evaluation.qualityScore >= 0.8 ? "text-emerald-600" : run.evaluation.qualityScore >= 0.5 ? "text-amber-600" : "text-red-600"}>
                                                                        {(run.evaluation.qualityScore * 100).toFixed(0)}% quality
                                                                    </span>
                                                                    {run.evaluation.issues.length > 0 && (
                                                                        <span className="text-text-muted">· {run.evaluation.issues.length} issue{run.evaluation.issues.length > 1 ? "s" : ""}</span>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Approval — prominent buttons */}
                                                            {needsApproval && (
                                                                <div className="mt-4 pt-3 border-t border-border-subtle/50 space-y-3">
                                                                    <input
                                                                        className="w-full bg-surface-card border border-border-subtle px-3 py-2 text-[11px] text-text-primary outline-none focus:border-accent/40 font-mono"
                                                                        placeholder="Notes (optional) — informs future runs…"
                                                                        value={approvalNotes}
                                                                        onChange={e => setApprovalNotes(e.target.value)}
                                                                        onClick={e => e.stopPropagation()}
                                                                    />
                                                                    <div className="flex items-center gap-3">
                                                                        <Button
                                                                            variant="default"
                                                                            size="sm"
                                                                            onClick={() => { handleApprove(taskDetail.id, run.id, true, approvalNotes); setApprovalNotes(""); }}
                                                                            disabled={actionLoading === `${taskDetail.id}:approve`}
                                                                        >
                                                                            <Play className="w-3.5 h-3.5" />
                                                                            Approve
                                                                        </Button>
                                                                        <Button
                                                                            variant="destructive"
                                                                            size="sm"
                                                                            onClick={() => { handleApprove(taskDetail.id, run.id, false, approvalNotes); setApprovalNotes(""); }}
                                                                            disabled={actionLoading === `${taskDetail.id}:approve`}
                                                                        >
                                                                            <X className="w-3.5 h-3.5" />
                                                                            Reject
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </AccordionContent>
                                                    </AccordionItem>
                                                );
                                            })}
                                        </Accordion>
                                    )}
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                </ScrollArea>
            </div>
        );
    }

    // ── List View ──
    const totalTasks = activeTasks.length + completedTasks.length;

    return (
        <div className="flex flex-col h-full">
            <TasksHeader onBack={onBack} count={totalTasks} />

            <ScrollArea className="flex-1">
                {totalTasks === 0 ? (
                    /* Empty state */
                    <div className="h-full flex items-center justify-center py-16">
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="w-16 h-16 rounded-full bg-accent/[0.06] border border-accent/[0.12] flex items-center justify-center">
                                <Zap className="w-6 h-6 text-accent/30" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-[13px] font-mono text-text-primary">
                                    No background tasks
                                </p>
                                <p className="text-[11px] text-text-tertiary max-w-[260px]">
                                    Tasks are created automatically when NIOM detects long-running or recurring intent.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="px-5 py-3 space-y-4">
                        {/* Active tasks */}
                        {activeTasks.length > 0 && (
                            <div>
                                <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-tertiary mb-2 px-1">
                                    Active · {activeTasks.length}
                                </div>
                                <ItemGroup>
                                    {activeTasks.map(task => (
                                        <TaskItemRow
                                            key={task.id}
                                            task={task}
                                            onClick={() => setSelectedTaskId(task.id)}
                                            onAction={(action) => handleAction(task.id, action)}
                                            actionLoading={actionLoading}
                                        />
                                    ))}
                                </ItemGroup>
                            </div>
                        )}

                        {/* Completed tasks */}
                        {completedTasks.length > 0 && (
                            <div>
                                <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-muted mb-2 px-1">
                                    Completed · {completedTasks.length}
                                </div>
                                <ItemGroup>
                                    {completedTasks.slice(0, 10).map(task => (
                                        <TaskItemRow
                                            key={task.id}
                                            task={task}
                                            onClick={() => setSelectedTaskId(task.id)}
                                            onAction={(action) => handleAction(task.id, action)}
                                            actionLoading={actionLoading}
                                        />
                                    ))}
                                </ItemGroup>
                            </div>
                        )}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}

// ── Sub-components ──

function TasksHeader({ onBack, count }: { onBack: () => void; count: number }) {
    return (
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle/50 shrink-0">
            <button
                onClick={onBack}
                className="w-7 h-7 flex items-center justify-center bg-transparent border border-border-subtle/30 cursor-pointer hover:bg-[rgba(91,63,230,0.06)] hover:border-accent/30 transition-all text-text-tertiary hover:text-accent"
            >
                <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono font-medium text-text-primary truncate flex-1">
                Tasks
            </span>
            <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
                {count} total
            </span>
        </div>
    );
}

function TaskItemRow({ task, onClick, onAction, actionLoading }: {
    task: { id: string; goal: string; status: string; taskType: string; totalRuns: number; nextRunAt?: number; updatedAt: number };
    onClick: () => void;
    onAction: (action: string) => void;
    actionLoading: string | null;
}) {
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.draft;
    const isRunning = task.status === "running";

    return (
        <Item variant="default" size="sm" className="group" onClick={onClick}>
            <ItemMedia variant="icon" className="size-7 relative">
                <span className="text-[11px]">{cfg.icon}</span>
                {isRunning && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-600 animate-pulse" />}
            </ItemMedia>
            <ItemContent>
                <ItemTitle className="text-[11px]">{task.goal.slice(0, 60)}</ItemTitle>
                <ItemDescription className="text-[10px] text-text-tertiary flex items-center gap-1.5">
                    <span className={cfg.color}>{cfg.label}</span>
                    <span>·</span>
                    <span>{TYPE_LABELS[task.taskType] || task.taskType}</span>
                    {task.totalRuns > 0 && (
                        <>
                            <span>·</span>
                            <span>{task.totalRuns} runs</span>
                        </>
                    )}
                    {task.nextRunAt && task.status === "scheduled" && (
                        <>
                            <span>·</span>
                            <span className="text-accent">{formatFutureTime(task.nextRunAt)}</span>
                        </>
                    )}
                </ItemDescription>
            </ItemContent>

            {/* Quick actions — hover reveal */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                {(task.status === "running" || task.status === "scheduled") && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={() => onAction("pause")} disabled={actionLoading === `${task.id}:pause`} className="hover:bg-amber-600/10 hover:text-amber-600">
                                <Pause className="w-3 h-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Pause</TooltipContent>
                    </Tooltip>
                )}
                {task.status === "paused" && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={() => onAction("resume")} disabled={actionLoading === `${task.id}:resume`} className="hover:bg-emerald-600/10 hover:text-emerald-600">
                                <Play className="w-3 h-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Resume</TooltipContent>
                    </Tooltip>
                )}
                {task.status !== "running" && !["completed", "cancelled"].includes(task.status) && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={() => onAction("run")} disabled={actionLoading === `${task.id}:run`} className="hover:bg-accent/10 hover:text-accent">
                                <Zap className="w-3 h-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Run Now</TooltipContent>
                    </Tooltip>
                )}
            </div>

            <span className="text-[9px] font-mono text-text-muted shrink-0">
                {formatRelativeTime(task.updatedAt)}
            </span>
        </Item>
    );
}
