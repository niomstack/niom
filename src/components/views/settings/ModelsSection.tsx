/**
 * ModelsSection — AI model selection, API keys, and connection test.
 */

import { useState } from "react";
import { ModelSelector } from "../../ModelSelector";
import { cn } from "../../../lib/utils";
import { getSidecarUrl } from "../../../lib/useConfig";
import { SectionHeader, type SidecarStatus } from "./shared";

interface ModelsSectionProps {
    sidecarStatus: SidecarStatus | null;
    onSidecarUpdate: (status: SidecarStatus) => void;
    showSaved: (msg?: string) => void;
    showError: (msg: string) => void;
}

export function ModelsSection({ sidecarStatus, onSidecarUpdate, showSaved, showError }: ModelsSectionProps) {
    const [activeProvider, setActiveProvider] = useState(sidecarStatus?.provider || "openai");
    const [activeModel, setActiveModel] = useState(sidecarStatus?.model || "");
    const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
    const [showKeyFor, setShowKeyFor] = useState<string | null>(null);
    const [savingSettings, setSavingSettings] = useState(false);
    const [testResult, setTestResult] = useState("");

    const handleSave = async () => {
        setSavingSettings(true);
        try {
            const apiKey = providerKeys[activeProvider] || "";
            const res = await fetch(`${getSidecarUrl()}/providers/configure`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: activeProvider,
                    model: activeModel || undefined,
                    provider_key: apiKey || undefined,
                    provider_name: activeProvider,
                }),
            });
            if (res.ok) {
                showSaved();
                setTestResult("");
                onSidecarUpdate({ ...sidecarStatus!, model: activeModel });
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
            const res = await fetch(`${getSidecarUrl()}/providers/test`, {
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

    return (
        <>
            <SectionHeader title="Provider" />

            {/* Provider tabs */}
            <div className="flex flex-wrap gap-1 mb-4">
                {(["openai", "anthropic", "google", "groq", "mistral", "xai"] as const).map(p => (
                    <button
                        key={p}
                        onClick={() => setActiveProvider(p)}
                        className={cn(
                            "px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border cursor-pointer transition-all",
                            activeProvider === p
                                ? "bg-accent text-white border-accent"
                                : providerKeys[p]
                                    ? "bg-transparent text-green-500 border-green-500/30 hover:bg-green-500/5"
                                    : "bg-transparent text-text-tertiary border-border-subtle hover:bg-surface-card"
                        )}
                    >
                        {providerKeys[p] && <span className="mr-1">✓</span>}
                        {p}
                    </button>
                ))}
            </div>

            <SectionHeader title="API Key" />

            <div className="space-y-1">
                <label className="text-[9px] font-mono text-text-muted uppercase tracking-[0.2em]">
                    {activeProvider} API Key
                </label>
                <div className="flex gap-2">
                    <input
                        type={showKeyFor === activeProvider ? "text" : "password"}
                        value={providerKeys[activeProvider] || ""}
                        onChange={(e) => setProviderKeys(prev => ({ ...prev, [activeProvider]: e.target.value }))}
                        className="flex-1 px-3 py-2 text-[12px] font-mono text-text-primary bg-surface-card border border-border-subtle outline-none focus:border-accent/40 transition-colors"
                        placeholder={{
                            openai: "sk-...",
                            anthropic: "sk-ant-...",
                            google: "AIza...",
                            groq: "gsk_...",
                            mistral: "Enter key...",
                            xai: "xai-...",
                        }[activeProvider] || "Enter API key..."}
                    />
                    <button
                        onClick={() => setShowKeyFor(showKeyFor === activeProvider ? null : activeProvider)}
                        className="px-3 py-2 text-[10px] font-mono text-text-tertiary border border-border-subtle bg-transparent cursor-pointer hover:bg-surface-card transition-all"
                    >
                        {showKeyFor === activeProvider ? "Hide" : "Show"}
                    </button>
                </div>
            </div>

            <SectionHeader title="Model" />

            <div className="space-y-1">
                <label className="text-[9px] font-mono text-text-muted uppercase tracking-[0.2em]">
                    Active Model
                </label>
                <ModelSelector
                    value={activeModel}
                    onSelect={(id: string) => setActiveModel(id)}
                    sidecarUrl={getSidecarUrl()}
                    provider={activeProvider}
                />
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
                    testResult.startsWith("✓") ? "bg-green-500/5 text-green-600 border border-green-500/20" :
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
                    { label: "Provider", value: activeProvider, ok: null as boolean | null },
                    { label: "Model", value: sidecarStatus?.model || "—", ok: null as boolean | null },
                    { label: "API Key", value: providerKeys[activeProvider] ? "Configured" : "Not set", ok: !!providerKeys[activeProvider] },
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
    );
}
