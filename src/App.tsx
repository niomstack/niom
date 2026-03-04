/**
 * App.tsx — NIOM Desktop Shell.
 *
 * Thin routing shell: manages view state, sidecar health polling,
 * and keyboard shortcuts. All view content delegated to sub-components.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WindowHeader } from "./components/WindowHeader";
import { HomeView } from "./components/views/HomeView";
import { BootScreen } from "./components/views/BootScreen";
import { SettingsView } from "./components/views/SettingsView";
import { WorkspaceView } from "./components/views/WorkspaceView";
import { TasksView } from "./components/views/TasksView";
import { SkillTreeView } from "./components/views/SkillTreeView";
import { TooltipProvider } from "./components/ui/tooltip";
import { useThreads } from "./hooks/useThreads";
import { useConfig } from "./lib/useConfig";

// ── View type ──
type ViewName = "home" | "settings" | "workspace" | "tasks" | "skills";

// ── App ──

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [userName, setUserName] = useState("User");
  const [view, setView] = useState<ViewName>("home");
  const [query, setQuery] = useState("");
  const [initialQuery, setInitialQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const threadState = useThreads();
  const [sidecarModel, setSidecarModel] = useState<string | null>(null);
  const [sidecarUptime, setSidecarUptime] = useState<number>(0);
  const [appVersion, setAppVersion] = useState<string>("");
  const { sidecarUrl } = useConfig();
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // Fetch OS username + app version
  useEffect(() => {
    invoke<string>("get_os_username").then(setUserName).catch(() => { });
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => { })
    );
  }, []);

  // Mount animation + reveal window (window starts hidden to avoid blank frame)
  useEffect(() => {
    // Double rAF ensures the first frame is painted before showing the window
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        setMounted(true);
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().show();
          await getCurrentWindow().setFocus();
        } catch { /* dev/non-Tauri env */ }
      });
    });
  }, []);

  // Sidecar health check + periodic polling (only after boot completes)
  const checkSidecar = useCallback(async () => {
    if (booting) return; // BootScreen handles its own polling
    try {
      const [healthRes, rootRes] = await Promise.all([
        fetch(`${sidecarUrl}/health`),
        fetch(`${sidecarUrl}/`).catch(() => null),
      ]);
      if (healthRes.ok) {
        const health = await healthRes.json();
        setSidecarUptime(health.uptime_ms || 0);
      }
      if (rootRes?.ok) {
        const root = await rootRes.json();
        setSidecarModel(root.model || null);
      }
    } catch {
      // silently ignore — boot screen handles init errors
    }
  }, [sidecarUrl, booting]);

  useEffect(() => { checkSidecar(); }, [checkSidecar]);
  useEffect(() => {
    const interval = setInterval(checkSidecar, 15_000);
    return () => clearInterval(interval);
  }, [checkSidecar]);

  // Listen for overlay-shown event → focus input + refresh
  useEffect(() => {
    const unlisten = listen("overlay-shown", () => {
      inputRef.current?.focus();
      setQuery("");
      checkSidecar();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [checkSidecar]);

  // ── Go home (clear thread + view) ──
  const goHome = useCallback(() => {
    threadState.goHome();
    setView("home");
    setQuery("");
    setInitialQuery("");
  }, [threadState]);

  // ── Start a new conversation from homepage ──
  const startConversation = useCallback((prompt: string) => {
    threadState.setActiveThreadId(null);
    setInitialQuery(prompt);
    setQuery("");
    setView("workspace");
  }, [threadState]);

  // Keyboard shortcuts — consolidated
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "home") {
          goHome();
          return;
        }
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        getCurrentWindow().hide();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        goHome();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        setQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, goHome]);

  return (
    <TooltipProvider>
      <div
        className={`h-screen w-full bg-surface-base relative overflow-hidden overflow-y-auto transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}
      >
        {/* ── Window header with traffic lights + drag region ── */}
        <WindowHeader />

        {/* ══ BOOT SCREEN — shown during initialization ══ */}
        {booting && (
          <div className="absolute inset-0 z-50 bg-surface-base pt-10 overflow-hidden">
            <BootScreen
              sidecarUrl={sidecarUrl}
              appVersion={appVersion}
              onReady={() => {
                setBooting(false);
                // Fetch full status now that sidecar is confirmed healthy
                fetch(`${sidecarUrl}/`).then(r => r.json()).then(root => {
                  setSidecarModel(root.model || null);
                }).catch(() => { });
                fetch(`${sidecarUrl}/health`).then(r => r.json()).then(health => {
                  setSidecarUptime(health.uptime_ms || 0);
                }).catch(() => { });
              }}
            />
          </div>
        )}

        {/* ══ SETTINGS VIEW ══ */}
        {!booting && view === "settings" && (
          <div className="absolute inset-0 z-40 bg-surface-base pt-10">
            <SettingsView onClose={goHome} />
          </div>
        )}

        {/* ══ WORKSPACE VIEW ══ */}
        {!booting && view === "workspace" && (
          <div className="absolute inset-0 z-40 bg-surface-base pt-10">
            <WorkspaceView
              onBack={goHome}
              initialQuery={initialQuery}
              threadState={threadState}
              onViewTask={(taskId) => { setFocusTaskId(taskId); setView("tasks"); }}
            />
          </div>
        )}

        {/* ══ TASKS VIEW ══ */}
        {!booting && view === "tasks" && (
          <div className="absolute inset-0 z-40 bg-surface-base pt-10">
            <TasksView onBack={() => { setFocusTaskId(null); goHome(); }} initialTaskId={focusTaskId} />
          </div>
        )}

        {/* ══ SKILLS VIEW ══ */}
        {!booting && view === "skills" && (
          <div className="absolute inset-0 z-40 bg-surface-base pt-10">
            <SkillTreeView onBack={goHome} />
          </div>
        )}

        {/* ══ HOME VIEW ══ */}
        {!booting && view === "home" && (
          <HomeView
            userName={userName}
            appVersion={appVersion}
            sidecarModel={sidecarModel}
            sidecarUptime={sidecarUptime}
            threadState={threadState}
            inputRef={inputRef}
            query={query}
            setQuery={setQuery}
            startConversation={startConversation}
            setView={setView}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
