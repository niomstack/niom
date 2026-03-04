/**
 * WorkspaceView — HUD-style interaction workspace.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ HEADER: thread title, status, back       │
 *   ├──────────────────────────────────────────┤
 *   │              CENTER                      │
 *   │          Conversation Stream             │
 *   ├──────────────────────────────────────────┤
 *   │ FOOTER: model | prompt input | metrics   │
 *   └──────────────────────────────────────────┘
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowUp, Sparkles, Cpu, Clock, Activity, Zap, Terminal, ListChecks, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Markdown } from "../../Markdown";
import { ToolCallRow, type ToolCall } from "../ToolCallDisplay";
import { NiomLogo, ThinkingDots } from "../Icons";
import { parseDataStream } from "../../lib/parseDataStream";
import { cn } from "../../lib/utils";
import { ScrollArea } from "../ui/scroll-area";
import type { useThreads } from "../../hooks/useThreads";

import { getSidecarUrl } from "../../lib/useConfig";
import { type TaskEntry, STATUS_CONFIG } from "../tasks/task-types";
import { useArtifacts } from "../../hooks/useArtifacts";
import { ArtifactsList } from "../ArtifactsList";

// ── Types ──

interface SidecarInfo {
    model: string | null;
    workspace: string | null;
    version: string;
    uptime_ms: number;
    status: "online" | "offline";
}

interface ContentPart {
    type: "text" | "tool";
    start?: number;
    end?: number;
    toolCallId?: string;
}

// ── Helpers ──

function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return `${hours}h ${remainingMins}m`;
}

function formatModelName(model: string | null): string {
    if (!model) return "no model";
    const parts = model.split("/");
    return parts.length > 1 ? parts[1] : model;
}


// ── Component ──

interface PendingConfirmation {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    input: any;
    messageId: string;
    threadId: string;
}

interface WorkspaceViewProps {
    onBack: () => void;
    initialQuery?: string;
    threadState: ReturnType<typeof useThreads>;
    onViewTask?: (taskId: string) => void;
}

export function WorkspaceView({ onBack, initialQuery, threadState, onViewTask }: WorkspaceViewProps) {
    const [query, setQuery] = useState("");
    const [sidecar, setSidecar] = useState<SidecarInfo>({
        model: null,
        workspace: null,
        version: "0.1.0",
        uptime_ms: 0,
        status: "offline",
    });
    const inputRef = useRef<HTMLInputElement>(null);

    // ── Thread state from App.tsx (single instance) ──
    const {
        activeThread,
        createThread,
        addMessage,
        updateMessage,
        updateThread,
        requestTitleGeneration,
        shouldRegenerateTitle,
    } = threadState;

    // ── Streaming / UI state ──
    const [toolCalls, setToolCalls] = useState<Record<string, ToolCall[]>>({});
    const [contentParts, setContentParts] = useState<Record<string, ContentPart[]>>({});
    const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
    const [thinking, setThinking] = useState(false);
    const [thinkingStatus, setThinkingStatus] = useState("");
    const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([]);
    const conversationRef = useRef<any[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ── Related tasks panel ──
    const [relatedTasks, setRelatedTasks] = useState<TaskEntry[]>([]);
    const [tasksExpanded, setTasksExpanded] = useState(true);

    // ── Conversation artifacts ──
    const { artifacts: conversationArtifacts, refresh: refreshArtifacts } = useArtifacts(
        "conversation",
        activeThread?.id ?? undefined,
        sidecar.workspace ?? undefined,
    );

    // Fetch tasks linked to this thread
    useEffect(() => {
        if (!activeThread?.id) { setRelatedTasks([]); return; }
        let cancelled = false;

        async function fetchRelatedTasks() {
            try {
                const res = await fetch(`${getSidecarUrl()}/tasks?threadId=${activeThread!.id}`);
                if (res.ok && !cancelled) {
                    const data = await res.json();
                    setRelatedTasks(data.tasks || []);
                }
            } catch { /* ignore */ }
        }

        fetchRelatedTasks();
        const interval = setInterval(fetchRelatedTasks, 10_000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [activeThread?.id]);

    // ── Sidecar polling ──
    useEffect(() => {
        let cancelled = false;
        async function fetchInfo() {
            try {
                const [rootRes, healthRes] = await Promise.all([
                    fetch(`${getSidecarUrl()}/`),
                    fetch(`${getSidecarUrl()}/health`),
                ]);
                if (cancelled) return;
                const root = await rootRes.json();
                const health = await healthRes.json();
                setSidecar({
                    model: root.model || null,
                    workspace: root.workspace || null,
                    version: health.version || "0.1.0",
                    uptime_ms: health.uptime_ms || 0,
                    status: health.status === "ok" ? "online" : "offline",
                });
            } catch {
                if (!cancelled) setSidecar((prev) => ({ ...prev, status: "offline" }));
            }
        }
        fetchInfo();
        const interval = setInterval(fetchInfo, 15_000);
        return () => { cancelled = true; clearInterval(interval); };
    }, []);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [activeThread?.messages.length, activeThread?.messages[activeThread?.messages.length - 1]?.content]);

    // Auto-focus
    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 100);
    }, []);

    // Restore persisted tool calls when viewing a thread
    useEffect(() => {
        if (!activeThread) return;
        const restored: Record<string, ToolCall[]> = {};
        for (const msg of activeThread.messages) {
            if ((msg.metadata as any)?.toolCalls?.length) {
                restored[msg.id] = (msg.metadata as any).toolCalls;
            }
        }
        if (Object.keys(restored).length > 0) {
            setToolCalls(prev => ({ ...prev, ...restored }));
        }
    }, [activeThread?.id]);


    // ── Send message (uses useThreads CRUD for persistence) ──
    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || thinking) return;

        setThinking(true);
        setThinkingStatus("Connecting…");

        // Create or reuse thread
        let threadId: string;
        let threadMessages: Array<{ role: string; content: string }>;

        if (activeThread) {
            addMessage(activeThread.id, { role: "user", content: text.trim() });
            updateThread(activeThread.id, { status: "thinking" });
            threadId = activeThread.id;

            // Build message history from existing thread
            threadMessages = activeThread.messages
                .filter((m) => m.role === "user" || m.role === "niom")
                .map((m) => ({
                    role: m.role === "niom" ? "assistant" : "user",
                    content: m.content,
                }));

            // Ensure the latest user message is included
            const lastMsg = threadMessages[threadMessages.length - 1];
            if (!lastMsg || lastMsg.content !== text.trim() || lastMsg.role !== "user") {
                threadMessages.push({ role: "user", content: text.trim() });
            }
        } else {
            const newThread = createThread(text.trim());
            threadId = newThread.id;

            // New thread — just the first user message
            threadMessages = [{ role: "user", content: text.trim() }];
        }

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await fetch(`${getSidecarUrl()}/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: threadMessages,
                    threadId,
                    context: sidecar.workspace ? { cwd: sidecar.workspace } : undefined,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                throw new Error(err.message || err.error || `Request failed: ${res.status}`);
            }

            // Add the niom response placeholder
            const responseMsg = addMessage(threadId, {
                role: "niom",
                content: "",
                metadata: { type: "response" },
            });

            updateThread(threadId, { status: "active" });
            const msgToolCalls: ToolCall[] = [];
            let textCharsSoFar = 0;
            const messageParts: ContentPart[] = [];
            const streamedToolCalls: Array<{ toolCallId: string; toolName: string; input: any; output?: any; approvalId?: string }> = [];
            conversationRef.current = [...threadMessages];

            await parseDataStream(res, {
                onText: (_delta, accumulated) => {
                    textCharsSoFar = accumulated.length;
                    updateMessage(threadId, responseMsg.id, { content: accumulated });
                    setThinkingStatus("Streaming…");
                },
                onReasoning: (text) => {
                    setThinkingStatus(text);
                },
                onToolStart: (toolCallId, toolName) => {
                    setThinkingStatus(`Running ${toolName}…`);
                    // Record content part boundaries
                    if (messageParts.length === 0 || messageParts[messageParts.length - 1].type === "tool") {
                        messageParts.push({ type: "text", start: 0, end: textCharsSoFar });
                    } else {
                        messageParts[messageParts.length - 1] = { ...messageParts[messageParts.length - 1], end: textCharsSoFar };
                    }
                    messageParts.push({ type: "tool", toolCallId });
                    setContentParts(prev => ({ ...prev, [responseMsg.id]: [...messageParts] }));

                    msgToolCalls.push({ id: toolCallId, toolName, status: "running" });
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                },
                onToolInput: (toolCallId, _toolName, input) => {
                    const tc = msgToolCalls.find(t => t.id === toolCallId);
                    if (tc) tc.input = input;
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                    const stc = streamedToolCalls.find(t => t.toolCallId === toolCallId);
                    if (stc) stc.input = input;
                },
                onToolOutput: (toolCallId, output) => {
                    const tc = msgToolCalls.find(t => t.id === toolCallId);
                    if (tc) { tc.output = output; tc.status = "complete"; }
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                    const stc = streamedToolCalls.find(t => t.toolCallId === toolCallId);
                    if (stc) stc.output = output;
                    // Start a new text part
                    messageParts.push({ type: "text", start: textCharsSoFar, end: textCharsSoFar });
                    setContentParts(prev => ({ ...prev, [responseMsg.id]: [...messageParts] }));
                },
                onToolConfirmation: (approvalId, toolCallId, toolName, input) => {
                    const confirmation: PendingConfirmation = {
                        approvalId, toolCallId, toolName, input,
                        messageId: responseMsg.id, threadId,
                    };
                    setPendingConfirmations(prev => [...prev, confirmation]);

                    const existingTc = msgToolCalls.find(t => t.id === toolCallId);
                    if (existingTc) {
                        existingTc.input = input;
                    } else {
                        msgToolCalls.push({ id: toolCallId, toolName, input, status: "running" });
                    }
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));

                    const existing = streamedToolCalls.find(t => t.toolCallId === toolCallId);
                    if (existing) {
                        existing.approvalId = approvalId;
                    } else {
                        streamedToolCalls.push({ toolCallId, toolName, input, approvalId });
                    }

                    // Build conversation ref for confirmation resume
                    const assistantParts: any[] = [];
                    const currentContent = activeThread?.messages.find(m => m.id === responseMsg.id)?.content;
                    if (currentContent) assistantParts.push({ type: "text", text: currentContent });
                    for (const stc of streamedToolCalls) {
                        assistantParts.push({ type: "tool-call", toolCallId: stc.toolCallId, toolName: stc.toolName, input: stc.input ?? {} });
                        if (stc.approvalId) {
                            assistantParts.push({ type: "tool-approval-request", approvalId: stc.approvalId, toolCallId: stc.toolCallId });
                        }
                    }
                    const toolResultMessages = streamedToolCalls
                        .filter(stc => stc.output !== undefined && !stc.approvalId)
                        .map(stc => ({
                            role: "tool" as const,
                            content: [{ type: "tool-result" as const, toolCallId: stc.toolCallId, toolName: stc.toolName, output: { type: "json" as const, value: stc.output } }],
                        }));
                    conversationRef.current = [
                        ...threadMessages,
                        { role: "assistant", content: assistantParts },
                        ...toolResultMessages,
                    ];
                },
                onFinish: () => {
                    // Final text boundary
                    if (textCharsSoFar > 0) {
                        const lastPart = messageParts[messageParts.length - 1];
                        if (lastPart?.type === "text") {
                            lastPart.end = textCharsSoFar;
                        } else {
                            messageParts.push({ type: "text", start: textCharsSoFar, end: textCharsSoFar });
                        }
                        setContentParts(prev => ({ ...prev, [responseMsg.id]: [...messageParts] }));
                    }

                    // Persist tool calls in message metadata
                    if (msgToolCalls.length > 0) {
                        updateMessage(threadId, responseMsg.id, {
                            metadata: { type: "response", toolCalls: msgToolCalls, contentParts: messageParts } as any,
                        });
                    }

                    updateThread(threadId, { status: "completed" });
                    setThinking(false);
                    setThinkingStatus("");

                    // Auto-generate title
                    if (shouldRegenerateTitle(threadId)) {
                        requestTitleGeneration(threadId);
                    }
                },
                onError: (error) => {
                    setThinking(false);
                    setThinkingStatus("");
                    updateMessage(threadId, responseMsg.id, {
                        content: `Error: ${error}`,
                        metadata: { type: "error" },
                    });
                    updateThread(threadId, { status: "failed" });
                },
            }, controller.signal);
        } catch (err) {
            if ((err as Error).name === "AbortError") return;
            setThinking(false);
            setThinkingStatus("");
            addMessage(threadId, {
                role: "niom",
                content: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                metadata: { type: "error" },
            });
            updateThread(threadId, { status: "failed" });
        } finally {
            abortRef.current = null;
        }
    }, [activeThread, thinking, sidecar.workspace, createThread, addMessage, updateMessage, updateThread, requestTitleGeneration, shouldRegenerateTitle]);

    // ── Handle tool confirmation ──
    const handleConfirmation = useCallback(async (confirmation: PendingConfirmation, approved: boolean) => {
        setPendingConfirmations(prev => prev.filter(a => a.approvalId !== confirmation.approvalId));

        setToolCalls(prev => {
            const msgTools = prev[confirmation.messageId] || [];
            return {
                ...prev,
                [confirmation.messageId]: msgTools.map(tc =>
                    tc.id === confirmation.toolCallId
                        ? { ...tc, status: approved ? "running" as const : "error" as const }
                        : tc
                ),
            };
        });

        if (!approved) {
            updateMessage(confirmation.threadId, confirmation.messageId, {
                content: (activeThread?.messages.find(m => m.id === confirmation.messageId)?.content || "") +
                    `\n\n*Tool \`${confirmation.toolName}\` was denied by user.*`,
            });
            updateThread(confirmation.threadId, { status: "completed" });
            return;
        }

        setThinking(true);
        const threadId = confirmation.threadId;

        try {
            const controller = new AbortController();
            abortRef.current = controller;

            const messagesWithApproval = [
                ...conversationRef.current,
                {
                    role: "tool",
                    content: [{ type: "tool-approval-response", approvalId: confirmation.approvalId, approved: true }],
                },
            ];

            const res = await fetch(`${getSidecarUrl()}/run/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: messagesWithApproval,
                    context: sidecar.workspace ? { cwd: sidecar.workspace } : undefined,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                throw new Error(err.message || err.error || `Confirmation request failed: ${res.status}`);
            }

            const responseMsg = addMessage(threadId, {
                role: "niom",
                content: "",
                metadata: { type: "response" },
            });

            setToolCalls(prev => {
                const origTools = prev[confirmation.messageId] || [];
                return {
                    ...prev,
                    [confirmation.messageId]: origTools.map(tc =>
                        tc.id === confirmation.toolCallId
                            ? { ...tc, status: "complete" as const, output: { approved: true } }
                            : tc
                    ),
                };
            });

            updateThread(threadId, { status: "active" });
            const msgToolCalls: ToolCall[] = [];

            await parseDataStream(res, {
                onText: (_delta, accumulated) => {
                    updateMessage(threadId, responseMsg.id, { content: accumulated });
                },
                onToolStart: (toolCallId, toolName) => {
                    msgToolCalls.push({ id: toolCallId, toolName, status: "running" });
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                },
                onToolInput: (toolCallId, _toolName, input) => {
                    const tc = msgToolCalls.find(t => t.id === toolCallId);
                    if (tc) tc.input = input;
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                },
                onToolOutput: (toolCallId, output) => {
                    const tc = msgToolCalls.find(t => t.id === toolCallId);
                    if (tc) { tc.output = output; tc.status = "complete"; }
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                },
                onToolConfirmation: (approvalId, toolCallId, toolName, input) => {
                    setPendingConfirmations(prev => [...prev, {
                        approvalId, toolCallId, toolName, input,
                        messageId: responseMsg.id, threadId,
                    }]);
                    msgToolCalls.push({ id: toolCallId, toolName, input, status: "running" });
                    setToolCalls(prev => ({ ...prev, [responseMsg.id]: [...msgToolCalls] }));
                },
                onError: (error) => {
                    updateMessage(threadId, responseMsg.id, {
                        content: `Error: ${error}`,
                        metadata: { type: "error" },
                    });
                },
            }, controller.signal);

            if (msgToolCalls.length > 0) {
                updateMessage(threadId, responseMsg.id, {
                    metadata: { type: "response", toolCalls: msgToolCalls } as any,
                });
            }

            const hasPendingConfirmations = pendingConfirmations.length > 0 ||
                msgToolCalls.some(tc => tc.status === "running");
            updateThread(threadId, { status: hasPendingConfirmations ? "paused" : "completed" });

        } catch (err: any) {
            if (err.name === "AbortError") return;
            addMessage(threadId, {
                role: "niom",
                content: `Error resuming after confirmation: ${err.message || String(err)}`,
                metadata: { type: "error" },
            });
            updateThread(threadId, { status: "failed" });
        } finally {
            setThinking(false);
            abortRef.current = null;
        }
    }, [activeThread, sidecar.workspace, pendingConfirmations, addMessage, updateMessage, updateThread]);

    // Auto-send initial query from home
    const initialSentRef = useRef(false);
    useEffect(() => {
        if (initialQuery && !initialSentRef.current) {
            initialSentRef.current = true;
            sendMessage(initialQuery);
        }
    }, [initialQuery, sendMessage]);

    const handleSubmit = () => {
        if (!query.trim()) return;
        const q = query.trim();
        setQuery("");
        sendMessage(q);
    };

    const toggleTool = (id: string) => {
        setExpandedTools((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    // ── Keyboard shortcuts ──
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Escape — abort stream or go back
            if (e.key === "Escape") {
                if (thinking && abortRef.current) {
                    abortRef.current.abort();
                    abortRef.current = null;
                    setThinking(false);
                    setThinkingStatus("");
                    if (activeThread) {
                        updateThread(activeThread.id, { status: "completed" });
                    }
                } else {
                    onBack();
                }
                return;
            }
            // Ctrl+K — focus input
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                inputRef.current?.focus();
            }
            // Ctrl+L — clear input
            if ((e.ctrlKey || e.metaKey) && e.key === "l") {
                e.preventDefault();
                setQuery("");
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [thinking, activeThread, updateThread, onBack]);

    // ── Render ──

    const messages = activeThread?.messages || [];
    const hasMessages = messages.length > 0;

    return (
        <div className="flex flex-col h-full">
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle/50 shrink-0">
                <button
                    onClick={onBack}
                    className="w-7 h-7 flex items-center justify-center bg-transparent border border-border-subtle/30 cursor-pointer hover:bg-[rgba(91,63,230,0.06)] hover:border-accent/30 transition-all text-text-tertiary hover:text-accent"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                </button>

                <div className={`w-2 h-2 rounded-full ${sidecar.status === "online" ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" : "bg-red-500/50"}`} />

                <span className="text-[11px] font-mono font-medium text-text-primary truncate flex-1">
                    {activeThread?.title || "Workspace"}
                </span>

                {thinking && (
                    <span className="text-[9px] font-mono text-accent animate-pulse uppercase tracking-wider">
                        {thinkingStatus}
                    </span>
                )}
            </div>

            {/* ── Main content area — Conversation Stream ── */}
            <ScrollArea className="flex-1">
                {!hasMessages ? (
                    /* Empty state */
                    <div className="h-[calc(100vh-10rem)] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="w-16 h-16 rounded-full bg-accent/[0.06] border border-accent/[0.12] flex items-center justify-center">
                                <div className="w-6 h-6 rounded-full bg-accent/20 animate-pulse" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-[13px] font-mono text-text-primary">
                                    Workspace
                                </p>
                                <p className="text-[11px] text-text-tertiary max-w-[260px]">
                                    Type a message below to start an interaction.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Message stream */
                    <div className="max-w-3xl mx-auto px-6 py-4 flex flex-col gap-4">
                        {messages.map((msg) => {
                            const isUser = msg.role === "user";
                            const isLastNiom = msg.role === "niom" && msg.id === messages[messages.length - 1]?.id;
                            const isThinkingMsg = isLastNiom && !msg.content && thinking;
                            const msgToolCalls: ToolCall[] = toolCalls[msg.id] || [];
                            const msgParts = contentParts[msg.id];
                            const fullText = msg.content || "";

                            return (
                                <div key={msg.id} className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
                                    {/* Avatar — NIOM only */}
                                    {!isUser && (
                                        <div className="w-7 h-7 bg-transparent flex items-center justify-center shrink-0 mt-0.5">
                                            <NiomLogo size={16} />
                                        </div>
                                    )}

                                    {/* Bubble */}
                                    <div className={cn(
                                        "max-w-[85%] px-0.5 py-1 text-[12px] leading-relaxed",
                                        isUser
                                            ? "px-3 py-1 bg-accent/[0.08] border border-accent/[0.15] text-text-primary"
                                            : "text-text-secondary"
                                    )}>
                                        {/* Thinking state */}
                                        {isThinkingMsg && (
                                            <div className="flex items-center gap-2">
                                                <ThinkingDots />
                                                {thinkingStatus && (
                                                    <span className="text-[10px] font-mono text-text-muted animate-pulse">
                                                        {thinkingStatus}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Interleaved content: tool calls mixed with text */}
                                        {!isThinkingMsg && msgParts && msgParts.length > 0 && msgToolCalls.length > 0 ? (() => {
                                            let lastTextEnd = 0;
                                            const elements = msgParts.map((part, i) => {
                                                if (part.type === "text") {
                                                    const segment = fullText.slice(part.start ?? 0, Math.min(part.end ?? fullText.length, fullText.length));
                                                    lastTextEnd = Math.max(lastTextEnd, part.end ?? 0);
                                                    if (!segment.trim()) return null;
                                                    return <div key={`t${i}`}><Markdown content={segment} /></div>;
                                                } else {
                                                    const tc = msgToolCalls.find((t) => t.id === part.toolCallId);
                                                    if (!tc) return null;
                                                    return (
                                                        <div key={`tc${i}`} className="my-1">
                                                            <ToolCallRow
                                                                tc={tc}
                                                                isExpanded={expandedTools.has(tc.id)}
                                                                onToggle={() => toggleTool(tc.id)}
                                                            />
                                                        </div>
                                                    );
                                                }
                                            });
                                            // Trailing text
                                            if (fullText.length > lastTextEnd && lastTextEnd > 0) {
                                                elements.push(<div key="trail"><Markdown content={fullText.slice(lastTextEnd)} /></div>);
                                            }
                                            return <>{elements}</>;
                                        })() : null}

                                        {/* Fallback: legacy layout (all tools on top, then text) */}
                                        {!isThinkingMsg && !(msgParts && msgParts.length > 0 && msgToolCalls.length > 0) && (
                                            <>
                                                {msgToolCalls.length > 0 && (
                                                    <div className="flex flex-col gap-0.5 mb-2">
                                                        {msgToolCalls.map((tc) => (
                                                            <ToolCallRow
                                                                key={tc.id}
                                                                tc={tc}
                                                                isExpanded={expandedTools.has(tc.id)}
                                                                onToggle={() => toggleTool(tc.id)}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                                {!isUser && fullText ? <Markdown content={fullText} /> : (!isThinkingMsg && (fullText || null))}
                                            </>
                                        )}

                                        {/* Error badge */}
                                        {msg.metadata?.type === "error" && (
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-red-600 bg-red-600/10 px-2 py-0.5">
                                                    Error
                                                </span>
                                            </div>
                                        )}


                                    </div>
                                </div>
                            );
                        })}
                        {/* Pending confirmation cards */}
                        {pendingConfirmations.map((confirmation) => (
                            <div key={confirmation.approvalId} className="flex gap-3 justify-start">
                                <div className="w-7 h-7 bg-transparent flex items-center justify-center shrink-0 mt-0.5">
                                    <NiomLogo size={16} />
                                </div>
                                <div className="max-w-[85%] border border-yellow-500/30 bg-yellow-500/[0.05] p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                                        <span className="text-[10px] font-mono font-semibold text-yellow-500 uppercase tracking-wider">
                                            Confirmation Required
                                        </span>
                                    </div>
                                    <div className="text-[11px] font-mono text-text-primary mb-1">
                                        Tool: <span className="text-accent">{confirmation.toolName}</span>
                                    </div>
                                    {confirmation.input && (
                                        <pre className="text-[9px] font-mono text-text-tertiary bg-surface-card/50 p-2 mb-3 max-h-32 overflow-auto">
                                            {typeof confirmation.input === "string"
                                                ? confirmation.input
                                                : JSON.stringify(confirmation.input, null, 2)}
                                        </pre>
                                    )}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleConfirmation(confirmation, true)}
                                            className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-accent text-white border-none cursor-pointer hover:brightness-110 transition-all"
                                        >
                                            Confirm
                                        </button>
                                        <button
                                            onClick={() => handleConfirmation(confirmation, false)}
                                            className="px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-transparent text-text-secondary border border-border-subtle cursor-pointer hover:bg-surface-card-hover hover:border-danger/30 hover:text-danger transition-all"
                                        >
                                            Deny
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </ScrollArea>

            {/* ══════════════════════════════════════════════
                RELATED TASKS — collapsible panel
               ══════════════════════════════════════════════ */}
            {relatedTasks.length > 0 && (
                <div className="shrink-0 border-t border-accent/[0.08]">
                    {/* Toggle header */}
                    <button
                        onClick={() => setTasksExpanded(!tasksExpanded)}
                        className="w-full flex items-center gap-2 px-5 py-2 bg-transparent border-none cursor-pointer hover:bg-[rgba(91,63,230,0.03)] transition-all"
                    >
                        <ListChecks className="w-3.5 h-3.5 text-accent/60" />
                        <span className="text-[10px] font-mono font-semibold text-text-secondary uppercase tracking-[0.15em]">
                            Related Tasks
                        </span>
                        <span className="text-[9px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                            {relatedTasks.length}
                        </span>
                        <div className="flex-1" />
                        {tasksExpanded ? (
                            <ChevronDown className="w-3 h-3 text-text-muted" />
                        ) : (
                            <ChevronUp className="w-3 h-3 text-text-muted" />
                        )}
                    </button>

                    {/* Task list */}
                    {tasksExpanded && (
                        <div className="px-5 pb-2 space-y-1">
                            {relatedTasks.map(task => {
                                const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.draft;
                                return (
                                    <div
                                        key={task.id}
                                        onClick={() => onViewTask?.(task.id)}
                                        className="flex items-center gap-2.5 px-3 py-2 bg-surface-card/50 border border-border-subtle/30 hover:border-accent/15 hover:bg-[rgba(91,63,230,0.04)] transition-all cursor-pointer"
                                    >
                                        <span className="text-[11px]" title={sc.label}>{sc.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-mono text-text-primary truncate">{task.goal}</div>
                                            <div className="text-[9px] font-mono text-text-muted flex items-center gap-2">
                                                <span className={sc.color}>{sc.label}</span>
                                                <span>·</span>
                                                <span>{task.totalRuns} run{task.totalRuns !== 1 ? "s" : ""}</span>
                                                {task.nextRunAt && (
                                                    <>
                                                        <span>·</span>
                                                        <span>next: {new Date(task.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ══════════════════════════════════════════════
                ARTIFACTS — files created during this conversation
               ══════════════════════════════════════════════ */}
            {conversationArtifacts.length > 0 && (
                <div className="shrink-0 border-t border-accent/[0.08] bg-surface-base/80 px-6 py-2">
                    <ArtifactsList
                        artifacts={conversationArtifacts}
                        compact
                        onRefresh={refreshArtifacts}
                    />
                </div>
            )}

            {/* ══════════════════════════════════════════════
                FOOTER — full width, fixed to bottom
               ══════════════════════════════════════════════ */}
            <div className="shrink-0 border-t border-accent/[0.12] bg-surface-base/95 backdrop-blur-sm">
                <div className="flex items-center h-14 px-6 gap-5">

                    {/* ── LEFT: Model + Terminal ── */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" className="hover:bg-accent/10 hover:text-accent">
                                    <Cpu className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                {formatModelName(sidecar.model)}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" className="hover:bg-accent/10 hover:text-accent">
                                    <Terminal className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                Terminal
                            </TooltipContent>
                        </Tooltip>
                    </div>

                    {/* ── CENTER: Prompt ── */}
                    <div className="flex-1 flex justify-center">
                        <div className="w-full max-w-[33.333%] min-w-[200px] group relative flex items-center bg-surface-card/60 border border-border-subtle/30 hover:border-accent/20 focus-within:border-accent/30 transition-all duration-300">
                            {/* Edge glow on focus */}
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/0 to-transparent group-focus-within:via-accent/40 transition-all duration-500" />

                            {/* Icon */}
                            <div className="pl-3 pr-1.5 flex items-center justify-center text-text-tertiary group-focus-within:text-accent/70 transition-colors">
                                <Sparkles className="w-3.5 h-3.5" />
                            </div>

                            {/* Input */}
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSubmit();
                                }}
                                disabled={thinking}
                                className="flex-1 py-2 bg-transparent border-none outline-none text-text-primary text-[11px] font-mono tracking-tight placeholder:text-text-tertiary disabled:opacity-50"
                                placeholder={thinking ? "Agent is working…" : "Ask NIOM anything…"}
                            />

                            {/* Submit */}
                            {query.trim() && !thinking && (
                                <button
                                    onClick={handleSubmit}
                                    className="mr-1.5 w-6 h-6 flex items-center justify-center bg-accent text-white border-none cursor-pointer hover:brightness-110 transition-all"
                                >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                            )}

                            {/* Shortcut hint */}
                            {!query && !thinking && (
                                <div className="pr-3 group-focus-within:opacity-0 transition-opacity">
                                    <span className="text-[8px] font-mono text-text-muted tracking-wider">⌘K</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── RIGHT: Metrics ── */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {/* Uptime */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" className="hover:bg-accent/10 hover:text-accent">
                                    <Clock className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                {sidecar.status === "online" ? `Uptime: ${formatUptime(sidecar.uptime_ms)}` : "Offline"}
                            </TooltipContent>
                        </Tooltip>

                        {/* Status */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" className={`hover:bg-accent/10 ${sidecar.status === "online" ? "text-blue-600 hover:text-blue-600/60" : "text-red-600/60 hover:text-red-600"}`}>
                                    <Activity className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                Agent {sidecar.status}
                            </TooltipContent>
                        </Tooltip>

                        {/* Version */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" className="hover:bg-accent/10 hover:text-accent">
                                    <Zap className="w-3.5 h-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                v{sidecar.version}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}
