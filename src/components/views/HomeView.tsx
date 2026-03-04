/**
 * HomeView — NIOM Home Dashboard.
 *
 * Left panel: greeting, recent activity, stats, CTA.
 * Right panel: archive/capability grid.
 * Center: Orb.
 * Bottom: floating prompt input + footer status bar.
 */

import React, { useState, useCallback, type ReactNode } from "react";
import { Orb, type OrbState } from "../Orb";
import { Card } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import EllipsisText from "../ui/EllipsisText";
import {
    Item,
    ItemContent,
    ItemTitle,
    ItemDescription,
    ItemMedia,
    ItemGroup,
} from "../ui/item";
import {
    Rocket,
    BookOpen,
    Terminal,
    MessageSquare,
    ArrowUp,
    Sparkles,
    Trash2,
    Check,
    X,
} from "lucide-react";
import { UpdateBanner } from "../UpdateBanner";
import type { useThreads } from "../../hooks/useThreads";

// ── Types ──

interface HoverDisplay {
    icon: ReactNode;
    label?: string;
}

const HOVER_DISPLAYS: Record<string, HoverDisplay> = {
    getStarted: {
        icon: <Rocket className="w-14 h-14 text-text-primary/80 opacity-50" strokeWidth={1.2} />,
        label: "Launch",
    },
    docs: {
        icon: <BookOpen className="w-14 h-14 text-text-primary/80 opacity-50" strokeWidth={1.2} />,
        label: "Learn",
    },
    headline: {
        icon: <Terminal className="w-12 h-12 text-text-primary/80 opacity-50" strokeWidth={1.2} />,
        label: "sudo niom --awaken",
    },
};

// ── Helpers ──

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return "Late night";
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    if (hour < 21) return "Good evening";
    return "Late night";
}

function formatRelativeTime(timestamp: number): string {
    const d = Date.now() - timestamp;
    const m = Math.floor(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const CARD_ENTRIES = [
    { id: "NX-0001", title: "Focus", subtitle: "Knows your workflow", description: "Learns what you're working on and adapts" },
    { id: "NX-0002", title: "Search", subtitle: "Finds anything instantly", description: "Web, files, docs — one prompt, zero tabs" },
    { id: "NX-0007", title: "Actions", subtitle: "Does the boring stuff", description: "Emails, scheduling, file ops — handled" },
    { id: "NX-0013", title: "Models", subtitle: "Best AI, your choice", description: "GPT, Claude, Gemini, local — one interface" },
    { id: "NX-0019", title: "Apps", subtitle: "Controls any app", description: "Click, type, scroll — across your desktop" },
    { id: "NX-0024", title: "Connect", subtitle: "Plugs into everything", description: "GitHub, Slack, Drive — 13k+ integrations" },
];

// ── Props ──

interface HomeViewProps {
    userName: string;
    appVersion: string;
    sidecarModel: string | null;
    sidecarUptime: number;
    threadState: ReturnType<typeof useThreads>;
    inputRef: React.RefObject<HTMLInputElement | null>;
    query: string;
    setQuery: (q: string) => void;
    startConversation: (prompt: string) => void;
    setView: (view: "home" | "settings" | "workspace" | "tasks" | "skills") => void;
}

export function HomeView({
    userName,
    appVersion,
    sidecarModel,
    sidecarUptime,
    threadState,
    inputRef,
    query,
    setQuery,
    startConversation,
    setView,
}: HomeViewProps) {
    const { threads } = threadState;
    const [orbState, setOrbState] = useState<OrbState>("idle");
    const [hoverKey, setHoverKey] = useState<string | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

    const enterDisplay = useCallback((key: string) => {
        setHoverKey(key);
        setOrbState("display");
    }, []);

    const leaveDisplay = useCallback(() => {
        setHoverKey(null);
        setOrbState("idle");
    }, []);

    const activeDisplay = hoverKey ? HOVER_DISPLAYS[hoverKey] : null;

    return (
        <>
            {/* ── HUD decorative lines ── */}
            <div className="absolute top-0 left-[8%] w-px h-full bg-border-subtle opacity-30" />
            <div className="absolute top-0 left-[40%] w-px h-full bg-border-subtle opacity-15" />
            <div className="absolute top-[15%] left-0 w-full h-px bg-border-subtle opacity-20" />
            <div className="absolute top-[85%] left-0 w-full h-px bg-border-subtle opacity-20" />

            {/* ── Corner brackets ── */}
            <div className="absolute top-12 left-3 z-10 p-3 cursor-default">
                <div className="w-6 h-6 border-l border-t border-accent/40" />
            </div>
            <div className="absolute bottom-12 right-6 z-10">
                <div className="w-6 h-6 border-r border-b border-accent/40" />
            </div>

            {/* ══ ORB — absolute center ══ */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative pointer-events-auto">
                    {/* Crosshair lines */}
                    <div className="absolute left-1/2 -translate-x-1/2 w-px h-[140%] -top-[20%] bg-border-subtle opacity-10" />
                    <div className="absolute top-1/2 -translate-y-1/2 h-px w-[140%] -left-[20%] bg-border-subtle opacity-10" />

                    {/* Orbit ring decorations */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-border-subtle/10" />
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-border-subtle/5" />

                    <Orb state={orbState} size="w-[280px] h-[280px]">
                        {activeDisplay && (
                            <div className="orb-display-content flex flex-col items-center gap-3 scale-[0.8]">
                                {activeDisplay.icon}
                                {activeDisplay.label && (
                                    <span className="text-[9px] font-mono text-text-primary/80 uppercase tracking-[0.3em]">
                                        {activeDisplay.label}
                                    </span>
                                )}
                            </div>
                        )}
                    </Orb>

                    {/* Side label */}
                    <div className="absolute -right-10 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <div className="w-6 h-px bg-accent/30" />
                        <span className="text-[8px] font-mono text-text-tertiary uppercase tracking-widest [writing-mode:vertical-lr]">
                            Neural Core
                        </span>
                    </div>
                </div>
            </div>

            {/* ══ LEFT PANEL — dashboard section ══ */}
            <div className="relative z-10 min-h-screen w-[45%] flex items-center justify-center pointer-events-none">
                <div className="max-w-md w-full px-12 py-8 pointer-events-auto">
                    <div className="space-y-5">

                        {/* Status tag */}
                        <div className="flex items-center gap-3">
                            <div className={`w-1.5 h-1.5 rounded-full bg-accent animate-pulse`} />
                            <span className="text-[10px] uppercase tracking-[0.3em] text-text-tertiary font-medium font-mono cursor-default">
                                {`System Active${appVersion ? ` — v${appVersion}` : ""}`}
                            </span>
                            <div className="h-px flex-1 bg-border-subtle opacity-30" />
                        </div>

                        {/* Update available banner */}
                        <UpdateBanner />

                        {/* Greeting */}
                        <div className="space-y-1">
                            <h1 className="text-3xl font-semibold tracking-tight leading-[1.1]">
                                <span className="text-text-primary">{getGreeting()},</span>
                                <br />
                                <span className="text-accent">{userName}.</span>
                            </h1>
                        </div>

                        {/* HUD divider */}
                        <div className="flex items-center gap-3 py-1">
                            <div className="w-12 h-px bg-accent/60" />
                            <div className="w-1 h-1 rotate-45 bg-accent/40" />
                            <div className="h-px flex-1 bg-border-subtle opacity-20" />
                        </div>

                        {/* Recent Activity */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-[0.25em]">
                                    Recent Activity
                                </span>
                                <div className="h-px flex-1 bg-border-subtle opacity-20" />
                            </div>

                            <ScrollArea className="h-[240px]">
                                <ItemGroup>
                                    {threads.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-8 text-text-tertiary">
                                            <MessageSquare className="w-5 h-5 opacity-30 mb-2" />
                                            <span className="text-[11px] font-mono">No interactions yet</span>
                                        </div>
                                    ) : (
                                        threads.slice(0, 10).map((thread, i) => (
                                            <React.Fragment key={thread.id}>
                                                <Item
                                                    variant="default"
                                                    size="sm"
                                                    className="group cursor-pointer hover:bg-[rgba(91,63,230,0.04)]"
                                                    onClick={() => {
                                                        if (confirmingDeleteId === thread.id) return;
                                                        threadState.viewThread(thread.id);
                                                        setView("workspace");
                                                    }}
                                                >
                                                    <span className="text-[10px] font-mono text-accent/50 w-5 shrink-0">
                                                        {String(i + 1).padStart(2, "0")}
                                                    </span>
                                                    <ItemMedia variant="icon" className="size-7 border-[rgba(91,63,230,0.12)] bg-[rgba(91,63,230,0.06)]">
                                                        <MessageSquare className="w-4 h-4" />
                                                    </ItemMedia>
                                                    <ItemContent>
                                                        <ItemTitle className="text-[11px]"><EllipsisText text={thread.title} length={20} /></ItemTitle>
                                                        <ItemDescription className="text-[10px] text-text-tertiary">
                                                            {thread.messages.length} messages
                                                        </ItemDescription>
                                                    </ItemContent>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        {confirmingDeleteId === thread.id ? (
                                                            <>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); threadState.deleteThread(thread.id); setConfirmingDeleteId(null); }}
                                                                    className="w-6 h-6 flex items-center justify-center bg-transparent border border-green-500/30 text-green-500 cursor-pointer hover:bg-green-500/10 transition-all"
                                                                    title="Confirm delete"
                                                                >
                                                                    <Check className="w-3 h-3" />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(null); }}
                                                                    className="w-6 h-6 flex items-center justify-center bg-transparent border border-border-subtle text-text-muted cursor-pointer hover:bg-surface-card transition-all"
                                                                    title="Cancel"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="text-[9px] font-mono text-text-muted group-hover:hidden">
                                                                    {formatRelativeTime(thread.updatedAt)}
                                                                </span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(thread.id); }}
                                                                    className="w-6 h-6 hidden group-hover:flex items-center justify-center bg-transparent border-none text-text-muted cursor-pointer hover:text-red-400 transition-all"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </Item>
                                            </React.Fragment>
                                        ))
                                    )}
                                </ItemGroup>
                            </ScrollArea>
                        </div>

                        {/* Quick stats row */}
                        <div className="flex items-center gap-5 pt-1">
                            {[
                                { label: "Threads", value: `${threads.length}` },
                                { label: "Model", value: sidecarModel ? (sidecarModel.includes("/") ? sidecarModel.split("/")[1] : sidecarModel) : "—" },
                                { label: "Uptime", value: sidecarUptime > 0 ? (() => { const m = Math.floor(sidecarUptime / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; })() : "—" },
                            ].map((item, i) => (
                                <div key={item.label} className="flex items-center gap-5">
                                    {i > 0 && <div className="w-px h-5 bg-border-subtle opacity-30" />}
                                    <div className="flex flex-col">
                                        <span className="text-[8px] uppercase tracking-[0.25em] text-text-muted font-mono">{item.label}</span>
                                        <span className="text-[10px] font-mono text-text-primary/80">{item.value}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* CTA buttons */}
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                className="px-5 py-2 text-[11px] font-mono font-semibold uppercase tracking-wider bg-accent text-white border-none cursor-pointer hover:brightness-110 transition-all"
                                onMouseEnter={() => enterDisplay("getStarted")}
                                onMouseLeave={leaveDisplay}
                                onClick={() => startConversation("")}
                            >
                                Open Workspace
                            </button>
                            <button
                                className="px-5 py-2 text-[11px] font-mono font-semibold uppercase tracking-wider bg-transparent text-text-secondary border border-border-subtle cursor-pointer hover:bg-surface-card hover:border-accent/30 transition-all"
                                onClick={() => setView("tasks")}
                            >
                                Tasks
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ══ RIGHT PANEL — archive grid ══ */}
            <div className="absolute right-0 top-0 z-10 min-h-screen w-[38%] flex items-center justify-center pointer-events-none">
                <div className="max-w-[400px] w-full px-8 py-8 pointer-events-auto">
                    {/* Panel header */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="h-px flex-1 bg-border-subtle opacity-20" />
                        <span className="text-[9px] font-mono text-text-muted uppercase tracking-[0.3em]">
                            Archive Index
                        </span>
                        <div className="w-1 h-1 rotate-45 bg-accent/30" />
                    </div>

                    {/* 4×3 grid */}
                    <div className="grid grid-cols-2 gap-2">
                        {CARD_ENTRIES.map((entry) => (
                            <Card
                                key={entry.id}
                                id={entry.id}
                                title={entry.title}
                                subtitle={entry.subtitle}
                                description={entry.description}
                            />
                        ))}
                    </div>

                    {/* Panel footer */}
                    <div className="flex items-center gap-3 mt-4">
                        <div className="w-1 h-1 rotate-45 bg-accent/20" />
                        <div className="h-px flex-1 bg-border-subtle opacity-15" />
                        <span className="text-[9px] font-mono text-text-muted uppercase tracking-widest">
                            {CARD_ENTRIES.length} entries
                        </span>
                    </div>
                </div>
            </div>

            {/* ══ PROMPT INPUT — floating above footer ══ */}
            <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-30 w-[520px]">
                {/* Corner brackets */}
                <div className="absolute -top-2 -right-2 w-4 h-4 border-r border-t border-accent/40" />
                <div className="absolute -bottom-2 -left-2 w-4 h-4 border-l border-b border-accent/40" />

                <div className="group relative flex items-center bg-surface-base/95 backdrop-blur-md border border-border-subtle/30 hover:border-accent/20 focus-within:border-accent/30 transition-all duration-300">
                    {/* Glass overlay */}
                    <div className="absolute inset-0 bg-gradient-to-r from-[rgba(91,63,230,0.02)] via-transparent to-[rgba(91,63,230,0.02)] pointer-events-none" />
                    <div className="absolute inset-px border border-white/[0.03] pointer-events-none" />

                    {/* Edge glow on focus */}
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/0 to-transparent group-focus-within:via-accent/50 transition-all duration-500" />
                    <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/0 to-transparent group-focus-within:via-accent/20 transition-all duration-500" />

                    {/* Sparkle icon */}
                    <div className="relative pl-4 pr-2 flex items-center justify-center text-text-tertiary group-focus-within:text-accent/70 transition-colors">
                        <Sparkles className="w-4 h-4" />
                    </div>

                    {/* Input */}
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && query.trim()) {
                                startConversation(query.trim());
                            }
                        }}
                        className="relative flex-1 py-3 bg-transparent border-none outline-none text-text-primary text-[13px] font-mono tracking-tight placeholder:text-text-tertiary"
                        placeholder="Ask NIOM anything…"
                    />

                    {/* Submit button — appears when there's text */}
                    {query.trim() && (
                        <button
                            onClick={() => startConversation(query.trim())}
                            className="relative mr-2 w-7 h-7 flex items-center justify-center bg-accent text-white border-none cursor-pointer hover:brightness-110 transition-all"
                        >
                            <ArrowUp className="w-4 h-4" />
                        </button>
                    )}

                    {/* Shortcut hint — hidden when focused */}
                    {!query && (
                        <div className="relative pr-4 group-focus-within:opacity-0 transition-opacity">
                            <span className="text-[9px] font-mono text-text-tertiary tracking-wider">⌘K</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ══ FOOTER — HUD status bar ══ */}
            <div className="fixed bottom-0 left-0 right-0 z-30">
                <div className="flex items-center justify-between px-6 h-9 bg-surface-base/90 backdrop-blur-sm border-t border-accent/[0.25]">
                    {/* Left — nav links */}
                    <div className="flex items-center gap-4">
                        {["Docs", "Skills", "Settings"].map(label => (
                            <span
                                key={label}
                                className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-tertiary hover:text-accent transition-colors cursor-pointer"
                                onClick={() => {
                                    if (label === "Settings") setView("settings");
                                    if (label === "Skills") setView("skills");
                                }}
                            >
                                {label}
                            </span>
                        ))}
                    </div>

                    {/* Center — platform tags */}
                    <div className="flex items-center gap-2">
                        {["macOS", "Windows", "Linux"].map(p => (
                            <div key={p} className="group flex items-center gap-1.5 px-2.5 py-0.5 bg-accent/[0.08] border border-accent/[0.2] hover:bg-accent/[0.18] hover:border-accent/40 cursor-default transition-all">
                                <div className="w-1 h-1 rounded-full bg-accent/70 group-hover:bg-accent group-hover:shadow-[0_0_6px_rgba(91,63,230,0.5)] transition-all" />
                                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-text-tertiary group-hover:text-accent transition-colors">{p}</span>
                            </div>
                        ))}
                    </div>

                    {/* Right — copyright */}
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono text-text-muted tracking-wider">
                            ⌘Space to invoke · Esc to hide
                        </span>
                        <span className="text-[9px] font-mono text-text-muted tracking-wider">
                            © 2026 NIOM
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
