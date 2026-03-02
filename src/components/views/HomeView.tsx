/**
 * HomeView — HUD-style home screen matching the www landing page aesthetic.
 * Central orb-style logo, feature cards with hover glow, recent threads.
 */

import { NiomLogo, Icons } from "../Icons";

interface SidecarStatus {
    model: string | null;
    gateway: boolean;
    workspace: string | null;
}

interface ThreadSummary {
    id: string;
    title: string;
    status: string;
    messages: Array<{ id: string }>;
}

export function HomeView({
    sidecarStatus,
    threads,
    onViewThread,
    onDeleteThread,
}: {
    sidecarStatus: SidecarStatus | null;
    threads: ThreadSummary[];
    onViewThread: (id: string) => void;
    onDeleteThread: (id: string) => void;
}) {
    return (
        <div className="flex flex-col gap-5 px-5 pt-5 pb-4">

            {/* ═══ Hero — Central Logo + Tagline ═══ */}
            <div className="flex flex-col items-center gap-3 py-6">
                {/* Orb-style logo */}
                <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-accent-softer flex items-center justify-center border border-accent/10">
                        <NiomLogo size={48} />
                    </div>
                    {/* Glow ring */}
                    <div className="absolute inset-0 rounded-full border border-accent/5 scale-125 animate-pulse" />
                </div>
                <div className="flex flex-col items-center gap-1">
                    <span className="font-niom text-[11px] font-extrabold text-text-accent tracking-[0.3em] uppercase">NIOM</span>
                    <span className="text-[13px] text-text-secondary text-center">
                        {(() => { const h = new Date().getHours(); if (h < 6) return "Working late? I'm here."; if (h < 12) return "Good morning. Ready when you are."; if (h < 17) return "Good afternoon. What are we building?"; return "Good evening. How can I help?"; })()}
                    </span>
                </div>
            </div>

            {/* ═══ Status Bar — compact HUD line ═══ */}
            <div className="flex items-center justify-between px-4 py-2.5 hud-card relative hud-bracket">
                <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${sidecarStatus ? "bg-ok shadow-[0_0_6px_var(--color-ok)]" : "bg-danger/50"}`} />
                    <span className="text-[11px] font-mono text-text-secondary">
                        {sidecarStatus ? "AGENT ONLINE" : "AGENT OFFLINE"}
                    </span>
                </div>
                <span className="text-[10px] font-mono text-text-tertiary truncate max-w-[200px]">
                    {sidecarStatus?.model || "no model"}
                </span>
            </div>

            {/* ═══ Feature Cards — www homepage style grid ═══ */}
            <div className="grid grid-cols-2 gap-2">
                {[
                    { icon: Icons.aura, label: "Focus", desc: "Watches your context", color: "text-accent" },
                    { icon: Icons.lightning, label: "Actions", desc: "Runs tools for you", color: "text-warn" },
                    { icon: Icons.sparkles, label: "Search", desc: "Web + file intelligence", color: "text-info" },
                    { icon: Icons.clock, label: "Tasks", desc: "Background automations", color: "text-ok" },
                ].map(card => (
                    <div key={card.label} className="hud-feature-card">
                        <div className={`w-5 h-5 ${card.color} hud-feature-icon transition-all mb-2`}>{card.icon}</div>
                        <div className="text-[11px] font-semibold text-text-primary tracking-wide uppercase mb-0.5">{card.label}</div>
                        <div className="text-[10px] text-text-tertiary">{card.desc}</div>
                    </div>
                ))}
            </div>

            {/* ═══ Quick Stats ═══ */}
            <div className="grid grid-cols-3 gap-2">
                <div className="hud-card px-3 py-2.5 text-center">
                    <div className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide mb-1">Tools</div>
                    <div className="text-sm font-semibold text-text-primary">8</div>
                </div>
                <div className="hud-card px-3 py-2.5 text-center">
                    <div className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide mb-1">Threads</div>
                    <div className="text-sm font-semibold text-text-primary">{threads.length}</div>
                </div>
                <div className="hud-card px-3 py-2.5 text-center">
                    <div className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide mb-1">MCP</div>
                    <div className="text-sm font-semibold text-text-primary">0</div>
                </div>
            </div>

            {/* ═══ Recent Threads ═══ */}
            {threads.length > 0 && (
                <div>
                    <div className="flex items-center px-1 mb-2">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-tertiary flex-1">Recent</span>
                        <span className="text-[10px] font-mono text-text-muted bg-surface-card px-2 py-0.5">{threads.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        {threads.slice(0, 4).map(thread => (
                            <div key={thread.id} className="group flex items-center hud-card hover:bg-surface-card-hover transition-all">
                                <div className="flex-1 flex flex-col gap-0.5 px-3 py-2 cursor-pointer" onClick={() => onViewThread(thread.id)}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono text-text-tertiary w-4 text-center">
                                            {thread.status === "completed" ? "✓" : thread.status === "failed" ? "✗" : "›"}
                                        </span>
                                        <span className="text-[11px] font-medium text-text-primary truncate flex-1">{thread.title}</span>
                                    </div>
                                    <div className="text-[10px] font-mono text-text-muted pl-6">
                                        {thread.messages.length} msg{thread.messages.length > 1 ? "s" : ""}
                                    </div>
                                </div>
                                <button
                                    className="w-6 h-6 flex items-center justify-center text-text-muted bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-100 hover:text-danger transition-all mr-2 text-[10px] font-mono"
                                    onClick={e => { e.stopPropagation(); onDeleteThread(thread.id); }}
                                    title="Delete"
                                >×</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
