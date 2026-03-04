/**
 * SettingsView — NIOM configuration panel.
 *
 * Thin shell: sidebar nav + section routing.
 * Sections are self-contained components in ./settings/.
 */

import { useState, useEffect } from "react";
import { ScrollArea } from "../ui/scroll-area";
import {
    ItemContent,
    ItemTitle,
    ItemMedia,
    ItemGroup,
    Item,
} from "../ui/item";
import { Cpu, Settings, Info, Brain } from "lucide-react";
import { getSidecarUrl } from "../../lib/useConfig";
import type { SidecarStatus } from "./settings/shared";
import { ModelsSection } from "./settings/ModelsSection";
import { MemorySection } from "./settings/MemorySection";
import { AboutSection } from "./settings/AboutSection";

// ── Section definitions ──

interface SettingsSection {
    id: string;
    label: string;
    icon: React.ReactNode;
}

const SECTIONS: SettingsSection[] = [
    { id: "models", label: "AI Models", icon: <Cpu className="w-4 h-4" /> },
    { id: "memory", label: "Memory", icon: <Brain className="w-4 h-4" /> },
    { id: "about", label: "About", icon: <Info className="w-4 h-4" /> },
];

// ── Main Component ──

interface SettingsViewProps {
    onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
    const [activeSection, setActiveSection] = useState("models");
    const [saveStatus, setSaveStatus] = useState<string | null>(null);
    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);

    // ── Fetch sidecar status ──
    useEffect(() => {
        async function fetchStatus() {
            try {
                const [rootRes, healthRes] = await Promise.all([
                    fetch(`${getSidecarUrl()}/`),
                    fetch(`${getSidecarUrl()}/health`),
                ]);
                const root = await rootRes.json();
                const health = await healthRes.json();
                setSidecarStatus({
                    model: root.model || null,
                    provider: root.provider || null,
                    workspace: root.workspace || null,
                    version: health.version || "0.1.0",
                    status: health.status === "ok" ? "online" : "offline",
                });
            } catch {
                setSidecarStatus(null);
            }
        }
        fetchStatus();
    }, []);

    // ── Status helpers (shared with sections) ──
    const showSaved = (msg = "Saved") => {
        setSaveStatus(msg);
        setTimeout(() => setSaveStatus(null), 2000);
    };

    const showError = (msg: string) => {
        setSaveStatus(msg);
        setTimeout(() => setSaveStatus(null), 3000);
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

                        {activeSection === "models" && (
                            <ModelsSection
                                sidecarStatus={sidecarStatus}
                                onSidecarUpdate={setSidecarStatus}
                                showSaved={showSaved}
                                showError={showError}
                            />
                        )}

                        {activeSection === "memory" && (
                            <MemorySection
                                showSaved={showSaved}
                                showError={showError}
                            />
                        )}

                        {activeSection === "about" && (
                            <AboutSection sidecarStatus={sidecarStatus} />
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
