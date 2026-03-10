import { useEffect, useState } from "react";
import { Minus, Square, X, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TitlebarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

function Titlebar({ isDark, onToggleTheme }: TitlebarProps) {
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
        <div className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_oklch(0.74_0.14_290)] animate-pulse" />
        <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          NIOM
        </span>
      </div>

      {/* Right side — theme toggle + window controls */}
      <div
        className="flex items-center mr-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
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
