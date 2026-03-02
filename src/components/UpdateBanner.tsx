/**
 * UpdateBanner — Auto-update notification component.
 *
 * Checks for updates via Tauri's updater plugin on mount and periodically.
 * Shows a non-intrusive HUD-style banner when an update is available.
 * Clicking the banner downloads + installs the update silently, then relaunches.
 */

import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowDownCircle, Loader2, CheckCircle2 } from "lucide-react";

type UpdateState = "checking" | "available" | "downloading" | "installing" | "done" | "idle" | "error";

export function UpdateBanner() {
    const [updateState, setUpdateState] = useState<UpdateState>("idle");
    const [update, setUpdate] = useState<Update | null>(null);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const checkForUpdates = useCallback(async () => {
        try {
            setUpdateState("checking");
            const result = await check();
            if (result) {
                setUpdate(result);
                setUpdateState("available");
            } else {
                setUpdateState("idle");
            }
        } catch (e) {
            console.warn("[updater] Check failed:", e);
            setUpdateState("idle"); // Don't show error on check failure — just silently skip
        }
    }, []);

    // Check on mount
    useEffect(() => {
        // Small delay so the app feels snappy before checking
        const timer = setTimeout(checkForUpdates, 5000);
        return () => clearTimeout(timer);
    }, [checkForUpdates]);

    // Periodic re-check every 30 minutes
    useEffect(() => {
        const interval = setInterval(checkForUpdates, 30 * 60 * 1000);
        return () => clearInterval(interval);
    }, [checkForUpdates]);

    const doUpdate = useCallback(async () => {
        if (!update) return;

        try {
            setUpdateState("downloading");
            setProgress(0);

            let downloaded = 0;
            let contentLength = 0;

            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case "Started":
                        contentLength = event.data.contentLength ?? 0;
                        break;
                    case "Progress":
                        downloaded += event.data.chunkLength;
                        if (contentLength > 0) {
                            setProgress(Math.round((downloaded / contentLength) * 100));
                        }
                        break;
                    case "Finished":
                        setUpdateState("installing");
                        break;
                }
            });

            setUpdateState("done");

            // Brief pause so user sees "installed" state, then relaunch
            setTimeout(async () => {
                await relaunch();
            }, 1500);
        } catch (e: any) {
            console.error("[updater] Update failed:", e);
            setError(e?.message || "Update failed");
            setUpdateState("error");
        }
    }, [update]);

    // Nothing to show
    if (updateState === "idle" || updateState === "checking") return null;

    return (
        <button
            onClick={updateState === "available" ? doUpdate : undefined}
            disabled={updateState !== "available"}
            className={`
        group w-full flex items-center gap-3 px-3 py-2
        border transition-all duration-300 cursor-pointer
        ${updateState === "available"
                    ? "border-accent/30 bg-accent/[0.06] hover:bg-accent/[0.12] hover:border-accent/50"
                    : updateState === "error"
                        ? "border-red-500/30 bg-red-500/[0.06] cursor-default"
                        : "border-accent/20 bg-accent/[0.04] cursor-default"
                }
      `}
        >
            {/* Icon */}
            <div className="shrink-0">
                {updateState === "available" && (
                    <ArrowDownCircle className="w-4 h-4 text-accent group-hover:scale-110 transition-transform" />
                )}
                {(updateState === "downloading" || updateState === "installing") && (
                    <Loader2 className="w-4 h-4 text-accent animate-spin" />
                )}
                {updateState === "done" && (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                )}
                {updateState === "error" && (
                    <span className="text-red-400 text-xs">✗</span>
                )}
            </div>

            {/* Text */}
            <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[10px] font-mono text-text-primary/90 tracking-wide truncate">
                    {updateState === "available" && `Update v${update?.version} available`}
                    {updateState === "downloading" && `Downloading update… ${progress}%`}
                    {updateState === "installing" && "Installing update…"}
                    {updateState === "done" && "Update installed — relaunching…"}
                    {updateState === "error" && (error || "Update failed")}
                </span>

                {/* Progress bar */}
                {updateState === "downloading" && (
                    <div className="mt-1 h-[2px] w-full bg-border-subtle/30 overflow-hidden">
                        <div
                            className="h-full bg-accent transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Action hint */}
            {updateState === "available" && (
                <span className="text-[8px] font-mono text-accent/70 uppercase tracking-[0.2em] shrink-0 group-hover:text-accent transition-colors">
                    Install
                </span>
            )}
        </button>
    );
}
