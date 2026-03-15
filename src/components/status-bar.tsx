/**
 * StatusBar — Bottom bar showing memory status, connected model, and update status.
 *
 * Listens for memory:updated and updater:status events.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Brain, Cpu, Download, Check, Loader2, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StatusBarProps {
  activeModel?: string;
}

type UpdateStatus = "idle" | "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error";

interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  error?: string;
}

function StatusBar({ activeModel }: StatusBarProps) {
  const [memoryCount, setMemoryCount] = useState(0);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  // Listen for real-time memory updates from NCF extraction
  useEffect(() => {
    const cleanup = window.niom?.memory?.onUpdate((data) => {
      setMemoryCount((prev) => prev + data.newFacts);
    });
    return cleanup;
  }, []);

  // Listen for updater status changes
  useEffect(() => {
    const cleanup = window.niom?.updater?.onStatus(
      (data: { status: string; version?: string; progress?: number; error?: string }) => {
        setUpdate({
          status: data.status as UpdateStatus,
          version: data.version,
          progress: data.progress,
          error: data.error,
        });
      },
    );
    return cleanup;
  }, []);

  // Parse model display name from "provider:model" format
  const modelDisplay = activeModel
    ? activeModel.split(":").pop()?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? activeModel
    : null;

  const handleDownload = async () => {
    if (update.status === "available") {
      await window.niom?.updater?.download();
    } else if (update.status === "ready") {
      await window.niom?.updater?.install();
    }
  };

  return (
    <div className="flex h-6 shrink-0 items-center justify-between bg-background/60 px-3 backdrop-blur-sm">
      {/* Left — Memory status */}
      <Badge variant="outline" className="h-4 gap-1 border-transparent bg-transparent px-1.5 font-mono text-[0.6rem] text-muted-foreground">
        <Brain className="size-3 text-primary/70" />
        {memoryCount === 0
          ? "NCF Active"
          : `${memoryCount} new ${memoryCount === 1 ? "memory" : "memories"}`}
      </Badge>

      {/* Center — Update status (only when relevant) */}
      {update.status === "available" && update.version && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          className="h-4 gap-1.5 px-2 font-mono text-[0.6rem] text-primary hover:text-primary hover:bg-primary/10"
        >
          <ArrowUpCircle className="size-3" />
          v{update.version} available — click to update
        </Button>
      )}

      {update.status === "downloading" && (
        <Badge variant="outline" className="h-4 gap-1 border-transparent bg-transparent px-1.5 font-mono text-[0.6rem] text-primary">
          <Loader2 className="size-3 animate-spin" />
          Downloading{update.progress != null ? ` ${update.progress}%` : "…"}
        </Badge>
      )}

      {update.status === "ready" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          className="h-4 gap-1.5 px-2 font-mono text-[0.6rem] text-green-500 hover:text-green-400 hover:bg-green-500/10"
        >
          <Download className="size-3" />
          Update ready — click to restart
        </Button>
      )}

      {update.status === "up-to-date" && (
        <Badge variant="outline" className="h-4 gap-1 border-transparent bg-transparent px-1.5 font-mono text-[0.6rem] text-muted-foreground/50">
          <Check className="size-3" />
          Up to date
        </Badge>
      )}

      {/* Right — Connected model */}
      {modelDisplay && (
        <Badge variant="outline" className="h-4 gap-1 border-transparent bg-transparent px-1.5 font-mono text-[0.6rem] text-muted-foreground">
          <Cpu className="size-3 text-muted-foreground/60" />
          {modelDisplay}
        </Badge>
      )}
    </div>
  );
}

export { StatusBar };
