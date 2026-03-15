/**
 * StatusBar — Bottom bar showing memory status and connected model.
 *
 * Listens for memory:updated events and updates the count in real-time.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Brain, Cpu } from "lucide-react";

interface StatusBarProps {
  activeModel?: string;
}

function StatusBar({ activeModel }: StatusBarProps) {
  const [memoryCount, setMemoryCount] = useState(0);

  // Listen for real-time memory updates from NCF extraction
  useEffect(() => {
    const cleanup = window.niom?.memory?.onUpdate((data) => {
      setMemoryCount((prev) => prev + data.newFacts);
    });
    return cleanup;
  }, []);

  // Parse model display name from "provider:model" format
  const modelDisplay = activeModel
    ? activeModel.split(":").pop()?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? activeModel
    : null;

  return (
    <div className="flex h-6 shrink-0 items-center justify-between bg-background/60 px-3 backdrop-blur-sm">
      {/* Left — Memory status */}
      <Badge variant="outline" className="h-4 gap-1 border-transparent bg-transparent px-1.5 font-mono text-[0.6rem] text-muted-foreground">
        <Brain className="size-3 text-primary/70" />
        {memoryCount === 0
          ? "NCF Active"
          : `${memoryCount} new ${memoryCount === 1 ? "memory" : "memories"}`}
      </Badge>

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

