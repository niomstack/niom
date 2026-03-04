/**
 * AboutSection — Version info, hotkey status, links.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, ExternalLink, Key } from "lucide-react";
import { SectionHeader, SettingRow, type SidecarStatus } from "./shared";

interface AboutSectionProps {
    sidecarStatus: SidecarStatus | null;
}

export function AboutSection({ sidecarStatus }: AboutSectionProps) {
    const [hotkeyStatus, setHotkeyStatus] = useState<{ registered: boolean; shortcut: string; error?: string } | null>(null);

    useEffect(() => {
        invoke<{ registered: boolean; shortcut: string; error?: string }>("get_hotkey_status")
            .then(setHotkeyStatus)
            .catch(() => { });
    }, []);

    return (
        <>
            <SectionHeader title="About NIOM" />

            {/* Hotkey warning */}
            {hotkeyStatus && !hotkeyStatus.registered && (
                <div className="px-3 py-2.5 border border-amber-500/30 bg-amber-500/[0.06] mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span className="text-[10px] font-mono font-semibold text-amber-500 uppercase tracking-wider">
                            Shortcut Unavailable
                        </span>
                    </div>
                    <p className="text-[10px] font-mono text-text-secondary leading-relaxed">
                        <span className="text-text-primary">{hotkeyStatus.shortcut}</span> is
                        already in use by another application. Global invoke shortcut won't work in this session.
                    </p>
                </div>
            )}

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
    );
}
