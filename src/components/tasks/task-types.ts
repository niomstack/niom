/**
 * task-types.ts — Shared types, API helpers, and status config for task management.
 */

export const SIDECAR_URL = "http://localhost:3001";

// ── Types (mirrored from backend) ──

export interface TaskEntry {
    id: string;
    goal: string;
    taskType: "one_shot" | "recurring" | "continuous" | "triggered";
    status: TaskStatus;
    nextRunAt?: number;
    lastRunAt?: number;
    totalRuns: number;
    createdAt: number;
    updatedAt: number;
}

export type TaskStatus = "draft" | "planned" | "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface TaskDetail {
    id: string;
    goal: string;
    taskType: string;
    status: TaskStatus;
    plan: { phases: TaskPhase[]; qualityCriteria: string };
    schedule?: { interval: string; nextRunAt: number; runCount: number; maxRuns?: number; intervalMs: number };
    approval: { mode: string; firstN: number; approvedRuns: number };
    memory: {
        findings: string[];
        sources: string[];
        filesCreated: string[];
        decisions: string[];
        feedback: Array<{ runId: string; approved: boolean; notes?: string }>;
    };
    totalRuns: number;
    successfulRuns: number;
    createdAt: number;
    updatedAt: number;
    lastRunAt?: number;
}

export interface TaskPhase {
    id: string;
    description: string;
    status: string;
    startedAt?: number;
    completedAt?: number;
}

export interface TaskRunToolCall {
    tool: string;
    input?: any;
    output?: any;
    durationMs?: number;
}

export interface TaskRun {
    id: string;
    taskId?: string;
    runNumber: number;
    status: string;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    summary?: string;
    output?: string;
    error?: string;
    phases?: TaskPhase[];
    toolCalls?: TaskRunToolCall[];
    evaluation?: { satisfied: boolean; qualityScore: number; issues: string[] };
}

// ── Status Config ──

export interface StatusConfig {
    icon: string;
    color: string;
    label: string;
}

export const STATUS_CONFIG: Record<string, StatusConfig> = {
    draft: { icon: "📝", color: "text-text-muted", label: "Draft" },
    planned: { icon: "📋", color: "text-text-secondary", label: "Planned" },
    scheduled: { icon: "🕐", color: "text-accent", label: "Scheduled" },
    running: { icon: "⚡", color: "text-blue-600", label: "Running" },
    paused: { icon: "⏸", color: "text-amber-600", label: "Paused" },
    completed: { icon: "✅", color: "text-emerald-600", label: "Completed" },
    failed: { icon: "❌", color: "text-red-600", label: "Failed" },
    cancelled: { icon: "🚫", color: "text-text-muted", label: "Cancelled" },
    pending_approval: { icon: "⏳", color: "text-amber-600", label: "Awaiting Approval" },
    rejected: { icon: "✗", color: "text-red-600", label: "Rejected" },
};

export const TYPE_LABELS: Record<string, string> = {
    one_shot: "One-shot",
    recurring: "Recurring",
    continuous: "Continuous",
    triggered: "Triggered",
};

// ── Formatters ──

export function formatRelativeTime(timestamp: number): string {
    const d = Date.now() - timestamp;
    const m = Math.floor(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export function formatFutureTime(timestamp: number): string {
    const d = timestamp - Date.now();
    if (d <= 0) return "now";
    const m = Math.floor(d / 60000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h`;
    return `in ${Math.floor(h / 24)}d`;
}

export function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── API Helpers ──

export async function fetchTasks(): Promise<TaskEntry[]> {
    try {
        const res = await fetch(`${SIDECAR_URL}/tasks`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.tasks || [];
    } catch { return []; }
}

export async function fetchTaskDetail(id: string): Promise<TaskDetail | null> {
    try {
        const res = await fetch(`${SIDECAR_URL}/tasks/${id}`);
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

export async function fetchTaskRuns(id: string): Promise<TaskRun[]> {
    try {
        const res = await fetch(`${SIDECAR_URL}/tasks/${id}/runs?limit=20`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.runs || [];
    } catch { return []; }
}

export async function taskAction(id: string, action: string, body?: any): Promise<boolean> {
    try {
        const res = await fetch(`${SIDECAR_URL}/tasks/${id}/${action}`, {
            method: "POST",
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        return res.ok;
    } catch { return false; }
}

export async function updateTaskApi(id: string, updates: any): Promise<boolean> {
    try {
        const res = await fetch(`${SIDECAR_URL}/tasks/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        return res.ok;
    } catch { return false; }
}

export async function deleteTaskApi(id: string): Promise<boolean> {
    try {
        const res = await fetch(`${SIDECAR_URL}/tasks/${id}`, { method: "DELETE" });
        return res.ok;
    } catch { return false; }
}
