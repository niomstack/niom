/**
 * GeneralSection — System behavior settings.
 *
 * Autostart toggle, global shortcut status, and other system preferences.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Power, Keyboard } from "lucide-react";
import { SectionHeader } from "./shared";

export function GeneralSection() {
    const [autostart, setAutostart] = useState<boolean | null>(null);
    const [toggling, setToggling] = useState(false);
    const [hotkeyStatus, setHotkeyStatus] = useState<{
        registered: boolean;
        shortcut: string;
        error?: string;
    } | null>(null);

    useEffect(() => {
        invoke<boolean>("get_autostart_enabled")
            .then(setAutostart)
            .catch(() => setAutostart(null));

        invoke<{ registered: boolean; shortcut: string; error?: string }>("get_hotkey_status")
            .then(setHotkeyStatus)
            .catch(() => { });
    }, []);

    const toggleAutostart = async () => {
        if (autostart === null || toggling) return;
        setToggling(true);
        try {
            const newState = await invoke<boolean>("set_autostart_enabled", {
                enabled: !autostart,
            });
            setAutostart(newState);
        } catch (err) {
            console.error("Failed to toggle autostart:", err);
        } finally {
            setToggling(false);
        }
    };

    return (
        <>
            <SectionHeader title="System" />

            {/* Autostart toggle */}
            <div className="flex items-center justify-between py-3 px-3 border border-border-subtle bg-surface-card/30 hover:border-accent/20 transition-all mb-3">
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 flex items-center justify-center border border-[rgba(91,63,230,0.12)] bg-[rgba(91,63,230,0.06)]">
                        <Power className="w-3.5 h-3.5 text-accent/70" />
                    </div>
                    <div>
                        <div className="text-[11px] font-mono text-text-primary">
                            Start on system boot
                        </div>
                        <div className="text-[10px] font-mono text-text-tertiary">
                            Launch NIOM automatically when you log in
                        </div>
                    </div>
                </div>

                {autostart === null ? (
                    <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
                        unavailable
                    </span>
                ) : (
                    <button
                        onClick={toggleAutostart}
                        disabled={toggling}
                        className={`
                            relative w-9 h-5 rounded-full transition-all duration-200 cursor-pointer
                            ${autostart
                                ? "bg-accent shadow-[0_0_8px_rgba(91,63,230,0.3)]"
                                : "bg-surface-card border border-border-subtle"
                            }
                            ${toggling ? "opacity-50" : ""}
                        `}
                    >
                        <div
                            className={`
                                absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200
                                ${autostart
                                    ? "left-[18px] bg-white"
                                    : "left-0.5 bg-text-muted"
                                }
                            `}
                        />
                    </button>
                )}
            </div>

            {/* Hotkey status */}
            <div className="flex items-center justify-between py-3 px-3 border border-border-subtle bg-surface-card/30 mb-3">
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 flex items-center justify-center border border-[rgba(91,63,230,0.12)] bg-[rgba(91,63,230,0.06)]">
                        <Keyboard className="w-3.5 h-3.5 text-accent/70" />
                    </div>
                    <div>
                        <div className="text-[11px] font-mono text-text-primary">
                            Global shortcut
                        </div>
                        <div className="text-[10px] font-mono text-text-tertiary">
                            {hotkeyStatus?.shortcut || "Ctrl+Space"} to summon NIOM
                        </div>
                    </div>
                </div>

                {hotkeyStatus && (
                    <span
                        className={`text-[9px] font-mono uppercase tracking-wider ${hotkeyStatus.registered
                                ? "text-emerald-400"
                                : "text-amber-400"
                            }`}
                    >
                        {hotkeyStatus.registered ? "active" : "conflict"}
                    </span>
                )}
            </div>

            {hotkeyStatus && !hotkeyStatus.registered && (
                <div className="px-3 py-2.5 border border-amber-500/30 bg-amber-500/[0.06] mb-3">
                    <p className="text-[10px] font-mono text-text-secondary leading-relaxed">
                        <span className="text-text-primary">{hotkeyStatus.shortcut}</span> is
                        already in use by another application. You can still use the system tray icon to open NIOM.
                    </p>
                </div>
            )}
        </>
    );
}
