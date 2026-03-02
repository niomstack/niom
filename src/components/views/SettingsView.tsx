/**
 * SettingsView — NIOM configuration panel.
 *
 * Categories:
 *   1. AI Models — model selection, API keys, connection test
 *   2. Memory    — brain facts, preferences, clear data
 *   3. About     — version, links
 */

import { useState, useEffect, useCallback } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { ModelSelector } from "../ModelSelector";
import { cn } from "../../lib/utils";
import {
    Item,
    ItemContent,
    ItemTitle,
    ItemDescription,
    ItemMedia,
    ItemGroup,
} from "../ui/item";
import {
    Cpu,
    Settings,
    Info,
    ChevronRight,
    Key,
    Brain,
    Trash2,
    ExternalLink,
    Plus,
    X,
    RotateCcw,
    Sparkles,
} from "lucide-react";

// ── Constants ──

const SIDECAR_URL = "http://localhost:3001";

// ── Types ──

interface SettingsSection {
    id: string;
    label: string;
    icon: React.ReactNode;
}

interface BrainData {
    facts: string[];
    preferences: Record<string, string>;
    patterns: string[];
    updatedAt: number;
}

const SECTIONS: SettingsSection[] = [
    { id: "models", label: "AI Models", icon: <Cpu className="w-4 h-4" /> },
    { id: "memory", label: "Memory", icon: <Brain className="w-4 h-4" /> },
    { id: "about", label: "About", icon: <Info className="w-4 h-4" /> },
];

// ── Sub-components ──

function SectionHeader({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-3 mb-3 mt-1">
            <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-[0.25em]">
                {title}
            </span>
            <div className="h-px flex-1 bg-border-subtle opacity-20" />
        </div>
    );
}

function SettingRow({
    icon,
    title,
    description,
    action,
    onClick,
    danger,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    action?: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
}) {
    return (
        <Item
            variant="default"
            size="sm"
            className={cn(
                "cursor-pointer",
                danger
                    ? "hover:bg-red-500/5 hover:border-red-500/20"
                    : "hover:bg-[rgba(91,63,230,0.04)]"
            )}
            onClick={onClick}
        >
            <ItemMedia variant="icon" className={cn(
                "size-7",
                danger
                    ? "border-red-500/20 bg-red-500/8"
                    : "border-[rgba(91,63,230,0.12)] bg-[rgba(91,63,230,0.06)]"
            )}>
                {icon}
            </ItemMedia>
            <ItemContent>
                <ItemTitle className={cn("text-[11px]", danger && "text-red-400")}>{title}</ItemTitle>
                <ItemDescription className="text-[10px] text-text-tertiary">
                    {description}
                </ItemDescription>
            </ItemContent>
            {action && <div className="shrink-0">{action}</div>}
        </Item>
    );
}

// ── Main Component ──

interface SettingsViewProps {
    onClose: () => void;
}

interface SidecarStatus {
    model: string | null;
    gateway: boolean;
    workspace: string | null;
    version: string;
    status: "online" | "offline";
}

export function SettingsView({ onClose }: SettingsViewProps) {
    const [activeSection, setActiveSection] = useState("models");

    // AI Models state
    const [activeModel, setActiveModel] = useState("");
    const [gatewayKey, setGatewayKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [saveStatus, setSaveStatus] = useState<string | null>(null);
    const [savingSettings, setSavingSettings] = useState(false);
    const [testResult, setTestResult] = useState("");
    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);

    // Memory state
    const [brain, setBrain] = useState<BrainData | null>(null);
    const [brainLoading, setBrainLoading] = useState(false);
    const [newFact, setNewFact] = useState("");
    const [newPrefKey, setNewPrefKey] = useState("");
    const [newPrefValue, setNewPrefValue] = useState("");
    const [confirmClear, setConfirmClear] = useState<string | null>(null);

    // ── Fetch sidecar status ──
    useEffect(() => {
        async function fetchStatus() {
            try {
                const [rootRes, healthRes] = await Promise.all([
                    fetch(`${SIDECAR_URL}/`),
                    fetch(`${SIDECAR_URL}/health`),
                ]);
                const root = await rootRes.json();
                const health = await healthRes.json();
                setSidecarStatus({
                    model: root.model || null,
                    gateway: !!root.gateway || !!root.gatewayKey,
                    workspace: root.workspace || null,
                    version: health.version || "0.1.0",
                    status: health.status === "ok" ? "online" : "offline",
                });
                if (root.model) setActiveModel(root.model);
            } catch {
                setSidecarStatus(null);
            }
        }
        fetchStatus();
    }, []);

    // ── Fetch brain data ──
    const fetchBrain = useCallback(async () => {
        setBrainLoading(true);
        try {
            const res = await fetch(`${SIDECAR_URL}/memory/brain`);
            if (res.ok) {
                const data = await res.json();
                setBrain(data.brain);
            }
        } catch { /* ignore */ }
        setBrainLoading(false);
    }, []);

    useEffect(() => {
        if (activeSection === "memory") fetchBrain();
    }, [activeSection, fetchBrain]);

    // ── Status helpers ──
    const showSaved = (msg = "Saved") => {
        setSaveStatus(msg);
        setTimeout(() => setSaveStatus(null), 2000);
    };

    const showError = (msg: string) => {
        setSaveStatus(msg);
        setTimeout(() => setSaveStatus(null), 3000);
    };

    // ── AI Model handlers ──
    const handleSave = async () => {
        setSavingSettings(true);
        try {
            const res = await fetch(`${SIDECAR_URL}/providers/configure`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: activeModel || undefined,
                    gateway_key: gatewayKey || undefined,
                }),
            });
            if (res.ok) {
                showSaved();
                setSidecarStatus(prev => prev ? { ...prev, model: activeModel, gateway: !!gatewayKey } : prev);
            } else {
                const err = await res.json().catch(() => ({ error: "Unknown error" }));
                showError(err.error || "Failed to save");
            }
        } catch {
            showError("Connection error");
        } finally {
            setSavingSettings(false);
        }
    };

    const handleTest = async () => {
        setTestResult("Testing...");
        try {
            const res = await fetch(`${SIDECAR_URL}/providers/test`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: activeModel }),
            });
            const data = await res.json();
            if (res.ok && data.status === "ok") {
                setTestResult(`✓ Connected — ${data.model} (${data.latency_ms}ms)`);
            } else {
                setTestResult(`✗ ${data.message || data.error || "Test failed"}`);
            }
        } catch (e) {
            setTestResult(`✗ Connection error: ${e instanceof Error ? e.message : "Unknown"}`);
        }
    };

    // ── Brain handlers ──
    const addFact = async () => {
        if (!newFact.trim()) return;
        try {
            const res = await fetch(`${SIDECAR_URL}/memory/brain/fact`, {
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
            const res = await fetch(`${SIDECAR_URL}/memory/brain/fact`, {
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
            const res = await fetch(`${SIDECAR_URL}/memory/brain/pref`, {
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
            await fetch(`${SIDECAR_URL}/memory/brain`, { method: "DELETE" });
            setBrain({ facts: [], preferences: {}, patterns: [], updatedAt: Date.now() });
            setConfirmClear(null);
            showSaved("Brain cleared");
        } catch { showError("Failed to clear brain"); }
    };

    const clearConversations = async () => {
        try {
            await fetch(`${SIDECAR_URL}/threads`, { method: "DELETE" });
            setConfirmClear(null);
            showSaved("Conversations cleared");
        } catch { showError("Failed to clear conversations"); }
    };

    return (
        <div className="flex h-full">
            {/* ── Sidebar nav ── */}
            <div className="w-[180px] shrink-0 border-r border-border-subtle py-4 px-2">
                <div className="flex items-center gap-2 px-3 mb-4">
                    <Settings className="w-4 h-4 text-accent" />
                    <span className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider">
                        Settings
                    </span>
                </div>

                <ItemGroup>
                    {SECTIONS.map((section) => (
                        <Item
                            key={section.id}
                            variant="default"
                            size="sm"
                            className={`cursor-pointer mb-0.5 ${activeSection === section.id
                                ? "bg-[rgba(91,63,230,0.1)] border-[rgba(91,63,230,0.2)]"
                                : "hover:bg-[rgba(91,63,230,0.04)]"
                                }`}
                            onClick={() => setActiveSection(section.id)}
                        >
                            <ItemMedia variant="default" className="text-accent/60">
                                {section.icon}
                            </ItemMedia>
                            <ItemContent>
                                <ItemTitle className={`text-[11px] ${activeSection === section.id ? "text-accent" : ""}`}>
                                    {section.label}
                                </ItemTitle>
                            </ItemContent>
                        </Item>
                    ))}
                </ItemGroup>

                {/* Back button */}
                <div className="mt-auto pt-6 px-2">
                    <button
                        onClick={onClose}
                        className="w-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-tertiary border border-border-subtle bg-transparent cursor-pointer hover:bg-surface-card hover:border-accent/30 transition-all"
                    >
                        ← Back
                    </button>
                </div>
            </div>

            {/* ── Content area ── */}
            <div className="flex-1 min-w-0">
                <ScrollArea className="h-full">
                    <div className="max-w-lg px-6 py-5 space-y-5">

                        {/* Save status toast */}
                        {saveStatus && (
                            <div className={`fixed top-14 right-6 z-50 px-4 py-2 text-[10px] font-mono uppercase tracking-wider ${saveStatus === "Saved" || saveStatus.includes("cleared")
                                ? "bg-accent text-white"
                                : "bg-danger text-white"
                                }`}>
                                {saveStatus.startsWith("✓") || saveStatus === "Saved" || saveStatus.includes("cleared") ? "✓" : "✗"} {saveStatus}
                            </div>
                        )}

                        {/* ═══ AI MODELS ═══ */}
                        {activeSection === "models" && (
                            <>
                                <SectionHeader title="Active Model" />

                                <div className="space-y-1">
                                    <label className="text-[9px] font-mono text-text-muted uppercase tracking-[0.2em]">
                                        Model
                                    </label>
                                    <ModelSelector
                                        value={activeModel}
                                        onSelect={(id: string) => setActiveModel(id)}
                                        sidecarUrl={SIDECAR_URL}
                                    />
                                </div>

                                <SectionHeader title="API Configuration" />

                                <div className="space-y-1">
                                    <label className="text-[9px] font-mono text-text-muted uppercase tracking-[0.2em]">
                                        Gateway API Key
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type={showKey ? "text" : "password"}
                                            value={gatewayKey}
                                            onChange={(e) => setGatewayKey(e.target.value)}
                                            className="flex-1 px-3 py-2 text-[12px] font-mono text-text-primary bg-surface-card border border-border-subtle outline-none focus:border-accent/40 transition-colors"
                                            placeholder="vck_..."
                                        />
                                        <button
                                            onClick={() => setShowKey(!showKey)}
                                            className="px-3 py-2 text-[10px] font-mono text-text-tertiary border border-border-subtle bg-transparent cursor-pointer hover:bg-surface-card transition-all"
                                        >
                                            {showKey ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex gap-2 mt-4">
                                    <button
                                        onClick={handleSave}
                                        disabled={savingSettings}
                                        className="flex-1 px-4 py-2 text-[11px] font-mono font-semibold bg-accent text-white border-none cursor-pointer hover:brightness-110 transition-all disabled:opacity-50 uppercase tracking-wide"
                                    >
                                        {savingSettings ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                        onClick={handleTest}
                                        disabled={!sidecarStatus}
                                        className="px-4 py-2 text-[11px] font-mono font-semibold bg-surface-card text-text-secondary border border-border-subtle cursor-pointer hover:bg-surface-card-hover transition-all disabled:opacity-50 uppercase tracking-wide"
                                    >
                                        Test
                                    </button>
                                </div>

                                {testResult && (
                                    <div className={cn("mt-3 px-3 py-2 text-[10px] font-mono",
                                        testResult.startsWith("✓") ? "bg-green-500/10 text-green-500" :
                                            testResult === "Testing..." ? "bg-accent/10 text-accent animate-pulse" :
                                                "bg-red-500/10 text-red-500"
                                    )}>
                                        {testResult}
                                    </div>
                                )}

                                {/* Status Card */}
                                <SectionHeader title="Status" />

                                <div className="border border-border-subtle p-4 space-y-2.5">
                                    {[
                                        { label: "Sidecar", value: sidecarStatus ? "Connected" : "Offline", ok: !!sidecarStatus },
                                        { label: "Model", value: sidecarStatus?.model || "—", ok: null as boolean | null },
                                        { label: "Gateway", value: sidecarStatus?.gateway ? "Active" : "Not configured", ok: sidecarStatus?.gateway ?? null },
                                        { label: "Workspace", value: sidecarStatus?.workspace || "—", ok: null as boolean | null },
                                    ].map(row => (
                                        <div key={row.label} className="flex items-center justify-between">
                                            <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wide">{row.label}</span>
                                            <span className={cn("text-[10px] font-mono",
                                                row.ok === true ? "text-green-500 font-semibold" :
                                                    row.ok === false ? "text-text-muted" :
                                                        "text-text-primary truncate max-w-[60%] text-right"
                                            )} title={row.value}>{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {/* ═══ MEMORY ═══ */}
                        {activeSection === "memory" && (
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
                        )}

                        {/* ═══ ABOUT ═══ */}
                        {activeSection === "about" && (
                            <>
                                <SectionHeader title="About NIOM" />

                                <div className="space-y-3">
                                    <div className="flex items-center gap-4 py-3">
                                        <div className="w-12 h-12 bg-[rgba(91,63,230,0.1)] border border-[rgba(91,63,230,0.2)] flex items-center justify-center">
                                            <img src="/niom-logo.png" alt="NIOM" className="w-8 h-8" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-semibold text-text-primary">NIOM</div>
                                            <div className="text-[10px] font-mono text-text-tertiary">v0.1.0 · Desktop AI Agent</div>
                                        </div>
                                    </div>

                                    {[
                                        { label: "Version", value: sidecarStatus?.version || "0.1.0" },
                                        { label: "Build", value: "dev" },
                                        { label: "Runtime", value: "Tauri v2" },
                                        { label: "AI Engine", value: "Node.js Sidecar" },
                                        { label: "Platform", value: navigator.platform },
                                    ].map((item) => (
                                        <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-border-subtle/50">
                                            <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
                                                {item.label}
                                            </span>
                                            <span className="text-[11px] font-mono text-text-primary">
                                                {item.value}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <SectionHeader title="Links" />

                                <SettingRow
                                    icon={<ExternalLink className="w-4 h-4" />}
                                    title="Documentation"
                                    description="Read the docs at docs.niom.com"
                                    action={<ChevronRight className="w-4 h-4 text-text-muted" />}
                                />

                                <SettingRow
                                    icon={<ExternalLink className="w-4 h-4" />}
                                    title="GitHub"
                                    description="View source code and report issues"
                                    action={<ChevronRight className="w-4 h-4 text-text-muted" />}
                                />

                                <SettingRow
                                    icon={<Key className="w-4 h-4" />}
                                    title="License"
                                    description="Open source — AGPL v3 License"
                                    action={<ChevronRight className="w-4 h-4 text-text-muted" />}
                                />
                            </>
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
