/**
 * useTasks — Hook for task state management + SSE real-time updates + OS notifications.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";
import {
    type TaskEntry,
    type TaskDetail,
    type TaskRun,
    SIDECAR_URL,
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

// ── Hook ──

export function useTasks() {
    const [tasks, setTasks] = useState<TaskEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
    const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

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
        const interval = setInterval(() => refreshDetail(selectedTaskId), 5_000);
        return () => clearInterval(interval);
    }, [selectedTaskId, refreshDetail]);

    // ── SSE (primary update) + fallback polling ──

    const tasksRef = useRef(tasks);
    tasksRef.current = tasks;

    useEffect(() => {
        let eventSource: EventSource | null = null;
        let fallbackInterval: ReturnType<typeof setInterval> | null = null;

        function startSSE() {
            try {
                eventSource = new EventSource(`${SIDECAR_URL}/tasks/events`);

                eventSource.onopen = () => {
                    // SSE connected — stop fallback polling
                    if (fallbackInterval) {
                        clearInterval(fallbackInterval);
                        fallbackInterval = null;
                    }
                };

                eventSource.onerror = () => {
                    // SSE disconnected — start fallback polling (every 15s)
                    if (!fallbackInterval) {
                        fallbackInterval = setInterval(refresh, 15_000);
                    }
                };

                eventSource.addEventListener("task:complete", (e) => {
                    refresh();
                    if (selectedTaskId) refreshDetail(selectedTaskId);
                    try {
                        const data = JSON.parse(e.data);
                        const task = tasksRef.current.find(t => t.id === data.taskId);
                        const goalShort = task?.goal?.slice(0, 60) || "Background task";
                        notify("✅ Task Complete", `${goalShort}\nStatus: ${data.status}`);
                    } catch { /* ignore */ }
                });

                eventSource.addEventListener("task:error", (e) => {
                    refresh();
                    if (selectedTaskId) refreshDetail(selectedTaskId);
                    try {
                        const data = JSON.parse(e.data);
                        const task = tasksRef.current.find(t => t.id === data.taskId);
                        const goalShort = task?.goal?.slice(0, 60) || "Background task";
                        notify("❌ Task Failed", `${goalShort}\n${data.error?.slice(0, 80) || "An error occurred"}`);
                    } catch { /* ignore */ }
                });

                eventSource.addEventListener("task:approval", (e) => {
                    refresh();
                    if (selectedTaskId) refreshDetail(selectedTaskId);
                    try {
                        const data = JSON.parse(e.data);
                        const task = tasksRef.current.find(t => t.id === data.taskId);
                        const goalShort = task?.goal?.slice(0, 60) || "Background task";
                        notify("⏳ Approval Needed", `${goalShort}\nReview required before continuing.`);
                    } catch { /* ignore */ }
                });

                eventSource.addEventListener("task:start", () => {
                    refresh();
                    if (selectedTaskId) refreshDetail(selectedTaskId);
                });

                eventSource.addEventListener("task:tool", () => {
                    if (selectedTaskId) refreshDetail(selectedTaskId);
                });
            } catch {
                // SSE not available — use polling as fallback
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
    }, [refresh, selectedTaskId, refreshDetail]);

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

    const handleApprove = useCallback(async (taskId: string, runId: string, approved: boolean, notes?: string) => {
        setActionLoading(`${taskId}:approve`);
        await taskAction(taskId, "approve", { runId, approved, notes: notes || undefined });
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

    const activeTasks = tasks.filter(t => !["completed", "cancelled"].includes(t.status));
    const completedTasks = tasks.filter(t => ["completed", "cancelled"].includes(t.status));

    return {
        tasks,
        activeTasks,
        completedTasks,
        loading,
        selectedTaskId,
        setSelectedTaskId,
        taskDetail,
        taskRuns,
        actionLoading,
        refresh,
        refreshDetail,
        handleAction,
        handleDelete,
        handleApprove,
        handleUpdate,
    };
}
