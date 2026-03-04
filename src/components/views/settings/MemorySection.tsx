/**
 * MemorySection — Brain facts, preferences, and data management.
 */

import { useState, useEffect, useCallback } from "react";
import {
    Sparkles,
    Plus,
    X,
    ChevronRight,
    RotateCcw,
    Trash2,
} from "lucide-react";
import { getSidecarUrl } from "../../../lib/useConfig";
import { SectionHeader, SettingRow, type BrainData } from "./shared";

interface MemorySectionProps {
    showSaved: (msg?: string) => void;
    showError: (msg: string) => void;
}

export function MemorySection({ showSaved, showError }: MemorySectionProps) {
    const [brain, setBrain] = useState<BrainData | null>(null);
    const [brainLoading, setBrainLoading] = useState(false);
    const [newFact, setNewFact] = useState("");
    const [newPrefKey, setNewPrefKey] = useState("");
    const [newPrefValue, setNewPrefValue] = useState("");
    const [confirmClear, setConfirmClear] = useState<string | null>(null);

    // ── Fetch brain data ──
    const fetchBrain = useCallback(async () => {
        setBrainLoading(true);
        try {
            const res = await fetch(`${getSidecarUrl()}/memory/brain`);
            if (res.ok) {
                const data = await res.json();
                setBrain(data.brain);
            }
        } catch { /* ignore */ }
        setBrainLoading(false);
    }, []);

    useEffect(() => { fetchBrain(); }, [fetchBrain]);

    // ── Brain handlers ──
    const addFact = async () => {
        if (!newFact.trim()) return;
        try {
            const res = await fetch(`${getSidecarUrl()}/memory/brain/fact`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fact: newFact.trim() }),
            });
            if (res.ok) {
                const data = await res.json();
                setBrain(data.brain);
                setNewFact("");
            }
        } catch { showError("Failed to add fact"); }
    };

    const removeFact = async (fact: string) => {
        try {
            const res = await fetch(`${getSidecarUrl()}/memory/brain/fact`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fact }),
            });
            if (res.ok) {
                const data = await res.json();
                setBrain(data.brain);
            }
        } catch { showError("Failed to remove fact"); }
    };

    const addPreference = async () => {
        if (!newPrefKey.trim() || !newPrefValue.trim()) return;
        try {
            const res = await fetch(`${getSidecarUrl()}/memory/brain/pref`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: newPrefKey.trim(), value: newPrefValue.trim() }),
            });
            if (res.ok) {
                const data = await res.json();
                setBrain(data.brain);
                setNewPrefKey("");
                setNewPrefValue("");
            }
        } catch { showError("Failed to set preference"); }
    };

    const clearBrain = async () => {
        try {
            await fetch(`${getSidecarUrl()}/memory/brain`, { method: "DELETE" });
            setBrain({ facts: [], preferences: {}, patterns: [], updatedAt: Date.now() });
            setConfirmClear(null);
            showSaved("Brain cleared");
        } catch { showError("Failed to clear brain"); }
    };

    const clearConversations = async () => {
        try {
            await fetch(`${getSidecarUrl()}/threads`, { method: "DELETE" });
            setConfirmClear(null);
            showSaved("Conversations cleared");
        } catch { showError("Failed to clear conversations"); }
    };

    return (
        <>
            <SectionHeader title="Brain — Long-Term Memory" />

            <div className="border border-border-subtle p-4 space-y-1">
                <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    <span className="text-[10px] font-mono text-text-secondary">
                        NIOM remembers these facts about you across sessions
                    </span>
                </div>

                {brainLoading ? (
                    <div className="text-[10px] font-mono text-text-muted animate-pulse py-4 text-center">
                        Loading memory...
                    </div>
                ) : (
                    <div className="space-y-1 text-[10px] font-mono">
                        <div className="flex gap-2 text-text-muted">
                            <span>{brain?.facts.length ?? 0} facts</span>
                            <span>·</span>
                            <span>{Object.keys(brain?.preferences ?? {}).length} preferences</span>
                            <span>·</span>
                            <span>{brain?.patterns.length ?? 0} patterns</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Facts */}
            <SectionHeader title="Facts" />

            <div className="space-y-1.5">
                {brain?.facts.length === 0 && (
                    <div className="text-[10px] font-mono text-text-muted py-3 text-center border border-border-subtle border-dashed">
                        No facts yet — NIOM will learn about you as you chat
                    </div>
                )}
                {brain?.facts.map((fact, i) => (
                    <div
                        key={i}
                        className="group flex items-start gap-2 px-3 py-2 bg-surface-card border border-border-subtle hover:border-accent/20 transition-colors"
                    >
                        <span className="text-accent text-[10px] mt-0.5 shrink-0">•</span>
                        <span className="text-[11px] text-text-primary flex-1">{fact}</span>
                        <button
                            onClick={() => removeFact(fact)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-red-400 transition-all cursor-pointer bg-transparent border-none shrink-0"
                            title="Remove fact"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ))}

                {/* Add fact input */}
                <div className="flex gap-2 mt-2">
                    <input
                        type="text"
                        value={newFact}
                        onChange={(e) => setNewFact(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addFact()}
                        className="flex-1 px-3 py-2 text-[11px] font-mono text-text-primary bg-surface-card border border-border-subtle outline-none focus:border-accent/40 transition-colors"
                        placeholder="Add a fact... (e.g. 'I prefer TypeScript')"
                    />
                    <button
                        onClick={addFact}
                        disabled={!newFact.trim()}
                        className="px-3 py-2 text-[10px] font-mono bg-accent/10 text-accent border border-accent/20 cursor-pointer hover:bg-accent/20 transition-all disabled:opacity-30 disabled:cursor-default"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Preferences */}
            <SectionHeader title="Preferences" />

            <div className="space-y-1.5">
                {Object.keys(brain?.preferences ?? {}).length === 0 && (
                    <div className="text-[10px] font-mono text-text-muted py-3 text-center border border-border-subtle border-dashed">
                        No preferences set
                    </div>
                )}
                {Object.entries(brain?.preferences ?? {}).map(([key, value]) => (
                    <div
                        key={key}
                        className="flex items-center gap-2 px-3 py-2 bg-surface-card border border-border-subtle"
                    >
                        <span className="text-[10px] font-mono text-accent font-semibold shrink-0">{key}</span>
                        <span className="text-[10px] font-mono text-text-muted">→</span>
                        <span className="text-[11px] text-text-primary flex-1 truncate">{value}</span>
                    </div>
                ))}

                {/* Add preference input */}
                <div className="flex gap-2 mt-2">
                    <input
                        type="text"
                        value={newPrefKey}
                        onChange={(e) => setNewPrefKey(e.target.value)}
                        className="w-[120px] shrink-0 px-3 py-2 text-[11px] font-mono text-text-primary bg-surface-card border border-border-subtle outline-none focus:border-accent/40 transition-colors"
                        placeholder="key"
                    />
                    <input
                        type="text"
                        value={newPrefValue}
                        onChange={(e) => setNewPrefValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addPreference()}
                        className="flex-1 px-3 py-2 text-[11px] font-mono text-text-primary bg-surface-card border border-border-subtle outline-none focus:border-accent/40 transition-colors"
                        placeholder="value"
                    />
                    <button
                        onClick={addPreference}
                        disabled={!newPrefKey.trim() || !newPrefValue.trim()}
                        className="px-3 py-2 text-[10px] font-mono bg-accent/10 text-accent border border-accent/20 cursor-pointer hover:bg-accent/20 transition-all disabled:opacity-30 disabled:cursor-default"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Data Management */}
            <SectionHeader title="Data Management" />

            <SettingRow
                icon={<RotateCcw className="w-4 h-4" />}
                title="Clear Conversations"
                description="Remove all chat threads and message history"
                action={<ChevronRight className="w-4 h-4 text-text-muted" />}
                onClick={() => setConfirmClear("conversations")}
            />

            <SettingRow
                icon={<Trash2 className="w-4 h-4" />}
                title="Clear Brain Memory"
                description="Remove all learned facts, preferences, and patterns"
                action={<ChevronRight className="w-4 h-4 text-text-muted" />}
                onClick={() => setConfirmClear("brain")}
                danger
            />

            {/* Confirmation dialog */}
            {confirmClear && (
                <div className="border border-red-500/30 bg-red-500/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <p className="text-[11px] text-text-primary">
                        {confirmClear === "conversations"
                            ? "This will permanently delete all conversation history. This cannot be undone."
                            : "This will permanently delete all brain memory — facts, preferences, and patterns. This cannot be undone."}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={confirmClear === "conversations" ? clearConversations : clearBrain}
                            className="px-4 py-1.5 text-[10px] font-mono font-semibold bg-red-500 text-white border-none cursor-pointer hover:bg-red-600 transition-all uppercase tracking-wide"
                        >
                            Confirm Delete
                        </button>
                        <button
                            onClick={() => setConfirmClear(null)}
                            className="px-4 py-1.5 text-[10px] font-mono text-text-secondary border border-border-subtle bg-transparent cursor-pointer hover:bg-surface-card transition-all uppercase tracking-wide"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
