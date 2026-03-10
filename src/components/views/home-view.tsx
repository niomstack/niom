import { Particles } from "@/components/ui/particles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Workflow, Bug, FileText } from "lucide-react";
import { PromptBox } from "@/components/prompt-box";

function HomeView({ isDark }: { isDark: boolean }) {
  const particleColor = isDark ? "#a78bfa" : "#7c3aed";

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* Soft radial gradient — violet center glow */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: isDark
            ? "radial-gradient(ellipse at 50% 45%, rgba(167, 139, 250, 0.12), transparent 65%)"
            : "radial-gradient(ellipse at 50% 45%, rgba(196, 181, 253, 0.35), transparent 65%)",
        }}
      />

      {/* Particles layer */}
      <Particles
        className="absolute inset-0 z-[1] opacity-20"
        quantity={80}
        staticity={40}
        ease={60}
        size={0.5}
        color={particleColor}
        refresh={isDark}
      />

      {/* Content */}
      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-8 px-6">
        {/* Prompt box */}
        <PromptBox />

        {/* Quick actions */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {[
            { icon: Search, label: "Search" },
            { icon: FileText, label: "Summarize" },
            { icon: Workflow, label: "Automate" },
            { icon: Bug, label: "Debug" },
          ].map(({ icon: Icon, label }) => (
            <Button
              key={label}
              variant="outline"
              className="group gap-1.5 bg-card/80 text-xs text-muted-foreground backdrop-blur-sm hover:border-primary hover:bg-primary/10 hover:text-foreground"
            >
              <Icon className="size-3 text-primary" />
              <span className="font-mono uppercase tracking-wider">
                {label}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { HomeView };
