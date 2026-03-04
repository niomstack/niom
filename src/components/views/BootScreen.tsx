/**
 * BootScreen — Shown while NIOM initializes.
 *
 * Displays the Orb with animated status messages while the sidecar boots.
 * Transitions to the home view once everything is ready.
 * If something fails, shows error details here instead of on the home view.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Orb } from "../Orb";

/* ═══════════════════════════════════════════
   Boot steps — shown sequentially
   ═══════════════════════════════════════════ */

interface BootStep {
    id: string;
    label: string;
    status: "pending" | "active" | "done" | "error";
    detail?: string;
}

const INITIAL_STEPS: BootStep[] = [
    { id: "sidecar", label: "Starting AI engine", status: "pending" },
    { id: "providers", label: "Connecting providers", status: "pending" },
    { id: "skills", label: "Loading Skill Tree", status: "pending" },
    { id: "ready", label: "Ready", status: "pending" },
];

/* ═══════════════════════════════════════════
   Props
   ═══════════════════════════════════════════ */

interface BootScreenProps {
    sidecarUrl: string;
    appVersion: string;
    onReady: () => void;
}

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export function BootScreen({ sidecarUrl, appVersion, onReady }: BootScreenProps) {
    const [steps, setSteps] = useState<BootStep[]>(INITIAL_STEPS);
    const [mounted, setMounted] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const bootStart = useRef(Date.now());
    const hasCompletedRef = useRef(false);
    const attemptCountRef = useRef(0);

    // Mount animation
    useEffect(() => {
        requestAnimationFrame(() => setMounted(true));
    }, []);

    // Elapsed time counter
    useEffect(() => {
        const interval = setInterval(() => {
            setElapsedMs(Date.now() - bootStart.current);
        }, 100);
        return () => clearInterval(interval);
    }, []);

    // Advance a step to a given status
    const advanceStep = useCallback((stepId: string, status: BootStep["status"], detail?: string) => {
        setSteps(prev => prev.map(s =>
            s.id === stepId ? { ...s, status, detail: detail ?? s.detail } : s
        ));
    }, []);

    // Aggressive health polling during boot
    useEffect(() => {
        if (hasCompletedRef.current) return;

        // Mark first step as active immediately
        advanceStep("sidecar", "active");

        const poll = async () => {
            if (hasCompletedRef.current) return;
            attemptCountRef.current++;

            try {
                const [healthRes, rootRes] = await Promise.all([
                    fetch(`${sidecarUrl}/health`, { signal: AbortSignal.timeout(3000) }),
                    fetch(`${sidecarUrl}/`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
                ]);

                if (!healthRes.ok) throw new Error("Sidecar unhealthy");

                // Sidecar is up
                advanceStep("sidecar", "done");

                // Check provider
                advanceStep("providers", "active");
                if (rootRes?.ok) {
                    const root = await rootRes.json();
                    if (root.model) {
                        advanceStep("providers", "done", root.model.includes("/") ? root.model.split("/")[1] : root.model);
                    } else {
                        advanceStep("providers", "done", "No model configured");
                    }
                } else {
                    advanceStep("providers", "done");
                }

                // Skills loaded (if sidecar is up, skills are loaded)
                advanceStep("skills", "active");
                await new Promise(r => setTimeout(r, 400)); // brief visual pause
                advanceStep("skills", "done");

                // All ready
                advanceStep("ready", "active");
                await new Promise(r => setTimeout(r, 300));
                advanceStep("ready", "done");

                hasCompletedRef.current = true;

                // Transition out
                await new Promise(r => setTimeout(r, 600));
                onReady();
            } catch {
                // Still booting — keep polling
                if (attemptCountRef.current > 30) {
                    // ~30 seconds of trying — show error
                    advanceStep("sidecar", "error", "Connection failed");
                    setErrorMessage(
                        "Could not connect to the AI engine. The sidecar may have failed to start. Check logs at ~/.niom/"
                    );
                }
            }
        };

        poll();
        const interval = setInterval(poll, 1000); // aggressive: 1s during boot
        return () => clearInterval(interval);
    }, [sidecarUrl, advanceStep, onReady]);

    // Current active step for the status message
    const activeStep = steps.find(s => s.status === "active") || steps.find(s => s.status === "pending");
    const hasError = steps.some(s => s.status === "error");

    return (
        <div
            className={`h-screen w-full bg-surface-base flex flex-col items-center justify-center transition-opacity duration-700 ${mounted ? "opacity-100" : "opacity-0"}`}
        >
            {/* HUD decorative lines */}
            <div className="absolute top-0 left-[30%] w-px h-full bg-border-subtle opacity-10" />
            <div className="absolute top-0 right-[30%] w-px h-full bg-border-subtle opacity-10" />
            <div className="absolute top-[40%] left-0 w-full h-px bg-border-subtle opacity-10" />
            <div className="absolute bottom-[20%] left-0 w-full h-px bg-border-subtle opacity-10" />

            {/* Corner brackets */}
            <div className="absolute top-12 left-12">
                <div className="w-6 h-6 border-l border-t border-accent/30" />
            </div>
            <div className="absolute bottom-12 right-12">
                <div className="w-6 h-6 border-r border-b border-accent/30" />
            </div>

            {/* ── Orb ── */}
            <div className="relative mb-10">
                <Orb
                    state={hasError ? "error" : "processing"}
                    size="w-[200px] h-[200px]"
                    glowOpacity={0.15}
                    coreBlur={8}
                />
            </div>

            {/* ── Status text ── */}
            <div className="flex flex-col items-center gap-4 max-w-sm">
                {/* Active step label */}
                <div className="flex items-center gap-3">
                    {!hasError && (
                        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    )}
                    {hasError && (
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                    <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-secondary">
                        {hasError ? "Initialization Failed" : activeStep?.label || "Starting..."}
                    </span>
                </div>

                {/* Steps list */}
                <div className="flex flex-col gap-1.5 w-full">
                    {steps.map(step => (
                        <div key={step.id} className="flex items-center gap-3">
                            {/* Status indicator */}
                            <div className="w-4 flex items-center justify-center">
                                {step.status === "done" && (
                                    <svg className="w-3 h-3 text-accent" viewBox="0 0 12 12" fill="none">
                                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                )}
                                {step.status === "active" && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                )}
                                {step.status === "pending" && (
                                    <div className="w-1 h-1 rounded-full bg-border-subtle opacity-40" />
                                )}
                                {step.status === "error" && (
                                    <svg className="w-3 h-3 text-red-500" viewBox="0 0 12 12" fill="none">
                                        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                )}
                            </div>

                            {/* Label */}
                            <span className={`text-[10px] font-mono tracking-wider ${step.status === "done"
                                ? "text-text-secondary"
                                : step.status === "active"
                                    ? "text-text-primary"
                                    : step.status === "error"
                                        ? "text-red-500"
                                        : "text-text-muted"
                                }`}>
                                {step.label}
                            </span>

                            {/* Detail */}
                            {step.detail && step.status === "done" && (
                                <span className="text-[9px] font-mono text-text-muted ml-auto">
                                    {step.detail}
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {/* Error details */}
                {errorMessage && (
                    <div className="mt-2 px-3 py-2 border border-red-500/30 bg-red-500/[0.06] text-[10px] font-mono text-red-400 leading-relaxed w-full">
                        {errorMessage}
                    </div>
                )}

                {/* Elapsed time */}
                <div className="flex items-center gap-3 pt-2">
                    <div className="h-px flex-1 bg-border-subtle opacity-20 w-16" />
                    <span className="text-[9px] font-mono text-text-muted tracking-wider">
                        {(elapsedMs / 1000).toFixed(1)}s
                    </span>
                    <div className="h-px flex-1 bg-border-subtle opacity-20 w-16" />
                </div>

                {/* Version */}
                {appVersion && (
                    <span className="text-[9px] font-mono text-text-muted tracking-widest uppercase">
                        NIOM v{appVersion}
                    </span>
                )}

                {/* Retry button on error */}
                {hasError && (
                    <button
                        onClick={() => {
                            setErrorMessage(null);
                            attemptCountRef.current = 0;
                            hasCompletedRef.current = false;
                            setSteps(INITIAL_STEPS);
                        }}
                        className="mt-2 px-4 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-accent/10 border border-accent/30 text-accent cursor-pointer hover:bg-accent/20 transition-all"
                    >
                        Retry
                    </button>
                )}
            </div>
        </div>
    );
}
