import { useEffect, useState } from "react";
import { Minus, Square, X, Sun, Moon, Settings, ArrowDownCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import niomLogo from "@/assets/niom-logo.png";

interface TitlebarProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings?: () => void;
  showSettingsButton?: boolean;
}

// ─── Update Status Types ────────────────────────────────────────────

type UpdateStatus = "idle" | "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error";

interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

// ─── Update Badge Component ─────────────────────────────────────────

function UpdateBadge() {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    const cleanup = window.niom.updater.onStatus(
      (data: UpdateState) => {
        setUpdate(data);
      },
    );
    return cleanup;
  }, []);

  // Don't show anything if idle or up-to-date
  if (update.status === "idle" || update.status === "up-to-date") {
    return null;
  }

  // Checking for updates
  if (update.status === "checking") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground animate-pulse">
        <Loader2 className="size-3 animate-spin" />
        <span className="text-[0.6rem] font-medium">Checking…</span>
      </div>
    );
  }

  // Update available — prompt to download
  if (update.status === "available") {
    return (
      <button
        onClick={() => window.niom.updater.download()}
        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full
                   bg-emerald-500/15 text-emerald-500 border border-emerald-500/20
                   hover:bg-emerald-500/25 transition-colors cursor-pointer"
      >
        <ArrowDownCircle className="size-3" />
        <span className="text-[0.6rem] font-semibold">v{update.version} available</span>
      </button>
    );
  }

  // Downloading
  if (update.status === "downloading") {
    const pct = update.progress ?? 0;
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
        <Loader2 className="size-3 animate-spin" />
        <span className="text-[0.6rem] font-medium">Downloading {pct}%</span>
        <div className="w-12 h-1 rounded-full bg-blue-500/20 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // Ready to install
  if (update.status === "ready") {
    return (
      <button
        onClick={() => window.niom.updater.install()}
        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full
                   bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
                   hover:bg-emerald-500/25 transition-colors cursor-pointer
                   animate-pulse"
      >
        <CheckCircle2 className="size-3" />
        <span className="text-[0.6rem] font-semibold">Install v{update.version}</span>
      </button>
    );
  }

  // Error — show retry
  if (update.status === "error") {
    return (
      <button
        onClick={() => window.niom.updater.check()}
        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full
                   bg-destructive/15 text-destructive border border-destructive/20
                   hover:bg-destructive/25 transition-colors cursor-pointer"
        title={update.error}
      >
        <RefreshCw className="size-3" />
        <span className="text-[0.6rem] font-medium">Retry update</span>
      </button>
    );
  }

  return null;
}

// ─── Titlebar Component ─────────────────────────────────────────────

function Titlebar({ isDark, onToggleTheme, onOpenSettings, showSettingsButton = true }: TitlebarProps) {
  const [platform, setPlatform] = useState<string>("darwin");

  useEffect(() => {
    if (window.niom?.window?.platform) {
      window.niom.window
        .platform()
        .then(setPlatform)
        .catch(() => {});
    }
  }, []);

  const isMac = platform === "darwin";

  return (
    <div
      className="flex h-11 shrink-0 items-center justify-between bg-background/80 backdrop-blur-md"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left side — spacer for macOS traffic lights */}
      <div className={isMac ? "w-20" : "w-4"} />

      {/* Center — app title */}
      <div className="flex items-center gap-2">
        <img src={niomLogo} alt="" className="size-4" draggable={false} />
        <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          NIOM
        </span>
      </div>

      {/* Right side — update badge + theme toggle + window controls */}
      <div
        className="flex items-center gap-1 mr-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Update badge — most prominent position */}
        <UpdateBadge />

        {showSettingsButton && onOpenSettings && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <Settings className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          {isDark ? (
            <Sun className="size-3.5" />
          ) : (
            <Moon className="size-3.5" />
          )}
        </Button>

        {!isMac && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.niom.window.minimize()}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <Minus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.niom.window.maximize()}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <Square className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.niom.window.close()}
              className="size-8 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export { Titlebar };
