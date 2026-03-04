/**
 * useTasks — Hook for task state management + SSE real-time updates + OS notifications.
 *
 * Task Streams model: steering replaces approval.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { getSidecarUrl } from "../lib/useConfig";
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";
import {
    type TaskEntry,
    type TaskDetail,
    type TaskRun,
    fetchTasks,
    fetchTaskDetail,
    fetchTaskRuns,
    taskAction,
    deleteTaskApi,
    updateTaskApi,
} from "../components/tasks/task-types";

// ── Notifications ──

let notificationsAllowed: boolean | null = null;

async function ensureNotifications(): Promise<boolean> {
    if (notificationsAllowed !== null) return notificationsAllowed;
    try {
        let granted = await isPermissionGranted();
        if (!granted) {
            const perm = await requestPermission();
            granted = perm === "granted";
        }
        notificationsAllowed = granted;
        return granted;
    } catch {
        notificationsAllowed = false;
        return false;
    }
}

async function notify(title: string, body: string): Promise<void> {
    const allowed = await ensureNotifications();
    if (!allowed) return;
    try {
        sendNotification({ title, body });
    } catch { /* ignore — Tauri might not be available in dev */ }
}

// ── Helper: steer a task ──

async function steerTask(taskId: string, comment: string, runNow?: boolean): Promise<any> {
    const res = await fetch(`${getSidecarUrl()}/tasks/${taskId}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, runNow }),
    });
    return res.json();
}

// ── Hook ──

export function useTasks(initialTaskId?: string) {
    const [tasks, setTasks] = useState<TaskEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId || null);
    const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
    const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    /** Live tool status from SSE — maps taskId → current tool name */
    const [liveToolStatus, setLiveToolStatus] = useState<Record<string, string>>({});

    // Notification init
    const notifInitRef = useRef(false);
    useEffect(() => {
        if (!notifInitRef.current) {
            notifInitRef.current = true;
            ensureNotifications();
        }
    }, []);

    // ── Refresh ──

    const refresh = useCallback(async () => {
        const list = await fetchTasks();
        setTasks(list);
        setLoading(false);
    }, []);

    // Initial load
    useEffect(() => { refresh(); }, [refresh]);

    // ── Detail ──

    const refreshDetail = useCallback(async (taskId: string) => {
        const [detail, runs] = await Promise.all([
            fetchTaskDetail(taskId),
            fetchTaskRuns(taskId),
        ]);
        setTaskDetail(detail);
        setTaskRuns(runs);
    }, []);

    useEffect(() => {
        if (!selectedTaskId) { setTaskDetail(null); setTaskRuns([]); return; }
        refreshDetail(selectedTaskId);
    }, [selectedTaskId, refreshDetail]);

    // ── SSE — primary live update channel ──
    // State is built directly from SSE events. No REST polling during execution.

    const tasksRef = useRef(tasks);
    tasksRef.current = tasks;
    const selectedTaskIdRef = useRef(selectedTaskId);
    selectedTaskIdRef.current = selectedTaskId;

    useEffect(() => {
        let eventSource: EventSource | null = null;
        let fallbackInterval: ReturnType<typeof setInterval> | null = null;

        function startSSE() {
            try {
                eventSource = new EventSource(`${getSidecarUrl()}/tasks/events`);

                eventSource.onopen = () => {
                    if (fallbackInterval) {
                        clearInterval(fallbackInterval);
                        fallbackInterval = null;
                    }
                };

                eventSource.onerror = () => {
                    if (!fallbackInterval) {
                        fallbackInterval = setInterval(refresh, 15_000);
                    }
                };

                // ── Run started — create a live run entry from event data ──
                eventSource.addEventListener("task:start", (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        const { taskId, runId, runNumber, startedAt, phases } = data;

                        // Update task status in the list
                        setTasks(prev => prev.map(t =>
                            t.id === taskId ? { ...t, status: "running" as any, updatedAt: Date.now() } : t
                        ));

                        // If we're viewing this task, create a live run
                        if (selectedTaskIdRef.current === taskId) {
                            const liveRun: TaskRun = {
                                id: runId,
                                taskId,
                                runNumber,
                                status: "running",
                                startedAt,
                                phases: phases || [],
                                toolCalls: [],
                            };
                            setTaskRuns(prev => [...prev, liveRun]);
                        }
                    } catch { /* ignore */ }
                });

                // ── Tool call completed — append to live run ──
                eventSource.addEventListener("task:tool", (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        const { taskId, runId, tool, input, output } = data;

                        // Update live tool status label
                        const friendly = tool
                            .replace(/([A-Z])/g, " $1")
                            .replace(/^./, (s: string) => s.toUpperCase())
                            .trim();
                        setLiveToolStatus(prev => ({ ...prev, [taskId]: friendly }));

                        // If we're viewing this task, append tool call to the live run
                        if (selectedTaskIdRef.current === taskId) {
                            setTaskRuns(prev => prev.map(r => {
                                if (r.id !== runId || r.status !== "running") return r;
                                return {
                                    ...r,
                                    toolCalls: [
                                        ...(r.toolCalls || []),
                                        { tool, input, output },
                                    ],
                                };
                            }));
                        }
                    } catch { /* ignore */ }
                });

                // ── Phase changed ──
                eventSource.addEventListener("task:phase", (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        if (selectedTaskIdRef.current === data.taskId) {
                            setTaskRuns(prev => prev.map(r => {
                                if (r.taskId !== data.taskId || r.status !== "running") return r;
                                return {
                                    ...r,
                                    phases: (r.phases || []).map(p =>
                                        p.description === data.phase ? { ...p, status: data.status } : p
                                    ),
                                };
                            }));
                        }
                    } catch { /* ignore */ }
                });

                // ── Run completed — finalize the live run with output ──
                eventSource.addEventListener("task:complete", (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        const { taskId, runId, status, output, durationMs, qualityScore } = data;

                        // Clear live tool status
                        setLiveToolStatus(prev => {
                            const next = { ...prev };
                            delete next[taskId];
                            return next;
                        });

                        // Update task list (re-fetch to get nextRunAt, etc.)
                        refresh();

                        // Finalize the live run
                        if (selectedTaskIdRef.current === taskId) {
                            setTaskRuns(prev => prev.map(r => {
                                if (r.id !== runId) return r;
                                return {
                                    ...r,
                                    status,
                                    output,
                                    durationMs,
                                    completedAt: Date.now(),
                                    evaluation: qualityScore != null
                                        ? { satisfied: qualityScore >= 0.5, qualityScore, issues: [] }
                                        : r.evaluation,
                                };
                            }));
                        }

                        // Notify
                        const task = tasksRef.current.find(t => t.id === taskId);
                        const goalShort = task?.goal?.slice(0, 60) || "Background task";
                        notify("✅ Task Complete", `${goalShort}\nStatus: ${status}`);
                    } catch { /* ignore */ }
                });

                // ── Run errored — mark the live run as failed ──
                eventSource.addEventListener("task:error", (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        const { taskId, runId, error } = data;

                        setLiveToolStatus(prev => {
                            const next = { ...prev };
                            delete next[taskId];
                            return next;
                        });

                        refresh();

                        if (selectedTaskIdRef.current === taskId && runId) {
                            setTaskRuns(prev => prev.map(r => {
                                if (r.id !== runId) return r;
                                return { ...r, status: "failed", error, completedAt: Date.now() };
                            }));
                        }

                        const task = tasksRef.current.find(t => t.id === taskId);
                        const goalShort = task?.goal?.slice(0, 60) || "Background task";
                        notify("❌ Task Failed", `${goalShort}\n${error?.slice(0, 80) || "An error occurred"}`);
                    } catch { /* ignore */ }
                });

                // ── Steering — just refresh task list ──
                eventSource.addEventListener("task:steer", () => {
                    refresh();
                });
            } catch {
                if (!fallbackInterval) {
                    fallbackInterval = setInterval(refresh, 15_000);
                }
            }
        }

        startSSE();

        return () => {
            eventSource?.close();
            if (fallbackInterval) clearInterval(fallbackInterval);
        };
    }, [refresh]);

    // ── Actions ──

    const handleAction = useCallback(async (taskId: string, action: string) => {
        setActionLoading(`${taskId}:${action}`);
        await taskAction(taskId, action);
        await refresh();
        if (selectedTaskId === taskId) await refreshDetail(taskId);
        setActionLoading(null);
    }, [refresh, refreshDetail, selectedTaskId]);

    const handleDelete = useCallback(async (taskId: string) => {
        setActionLoading(`${taskId}:delete`);
        await deleteTaskApi(taskId);
        if (selectedTaskId === taskId) setSelectedTaskId(null);
        await refresh();
        setActionLoading(null);
    }, [refresh, selectedTaskId]);

    /**
     * Steer a task — post a comment that flows into the next run.
     * Optionally trigger an immediate re-run with the comment as context.
     */
    const handleSteer = useCallback(async (taskId: string, comment: string, runNow?: boolean) => {
        setActionLoading(`${taskId}:steer`);
        await steerTask(taskId, comment, runNow);
        await refresh();
        if (selectedTaskId === taskId) await refreshDetail(taskId);
        setActionLoading(null);
    }, [refresh, refreshDetail, selectedTaskId]);

    const handleUpdate = useCallback(async (taskId: string, updates: any) => {
        setActionLoading(`${taskId}:edit`);
        await updateTaskApi(taskId, updates);
        if (selectedTaskId === taskId) await refreshDetail(taskId);
        await refresh();
        setActionLoading(null);
    }, [refresh, refreshDetail, selectedTaskId]);

    // ── Derived ──

    const activeTasks = tasks.filter(t => !["done"].includes(t.status));
    const doneTasks = tasks.filter(t => t.status === "done");

    return {
        tasks,
        activeTasks,
        doneTasks,
        loading,
        selectedTaskId,
        setSelectedTaskId,
        taskDetail,
        taskRuns,
        actionLoading,
        liveToolStatus,
        refresh,
        refreshDetail,
        handleAction,
        handleDelete,
        handleSteer,
        handleUpdate,
    };
}
