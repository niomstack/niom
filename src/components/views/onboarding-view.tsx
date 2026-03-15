/**
 * Onboarding View — First-run wizard for new NIOM users.
 *
 * Steps:
 *   1. Welcome — Logo + tagline + CTA
 *   2. API Keys — Inline key entry for providers
 *   3. Features — Quick tour of key capabilities
 *   4. Ready — Start chatting
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import niomLogo from "@/assets/niom-logo.png";
import { Particles } from "@/components/ui/particles";
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Brain,
  Zap,
  Shield,
  Eye,
  EyeOff,
  Globe,
  Cpu,
  Rocket,
  Sparkles,
  FolderTree,
  MessageSquare,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface OnboardingViewProps {
  onComplete: () => void;
}

type Step = "welcome" | "keys" | "features" | "ready";

interface ProviderKeyState {
  key: string;
  showKey: boolean;
  saved: boolean;
}

// ─── Provider Definitions ────────────────────────────────────────────

const PROVIDERS: Array<{
  id: string;
  name: string;
  placeholder: string;
  description: string;
  icon: string;
  recommended?: boolean;
}> = [
  {
    id: "anthropic",
    name: "Anthropic",
    placeholder: "sk-ant-api03-...",
    description: "Claude 4 / Sonnet — best for complex reasoning",
    icon: "🟣",
    recommended: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    placeholder: "sk-...",
    description: "GPT-4.5 / GPT-4o — versatile general use",
    icon: "🟢",
  },
  {
    id: "google",
    name: "Google",
    placeholder: "AIza...",
    description: "Gemini 2.5 — great for large context",
    icon: "🔵",
  },
];

// ─── Step Indicator ──────────────────────────────────────────────────

function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 transition-all duration-300 ${
              i <= current
                ? "text-primary"
                : "text-muted-foreground/40"
            }`}
          >
            <div
              className={`size-2 rounded-full transition-all duration-300 ${
                i < current
                  ? "bg-primary"
                  : i === current
                  ? "bg-primary ring-2 ring-primary/30"
                  : "bg-muted-foreground/20"
              }`}
            />
            <span className="text-[0.55rem] font-mono uppercase tracking-wider hidden sm:inline">
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-8 transition-colors duration-300 ${
                i < current ? "bg-primary/50" : "bg-muted-foreground/10"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Welcome Step ────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Logo with glow */}
      <div className="relative">
        <div className="absolute inset-0 scale-150 animate-pulse rounded-full bg-primary/10 blur-3xl" />
        <img
          src={niomLogo}
          alt="NIOM"
          className="relative size-20 rounded-2xl ring-1 ring-white/10"
        />
      </div>

      <div className="space-y-3 max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to NIOM
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your local-first AI agent that learns, remembers, and grows with every conversation.
          All data stays on your machine — always.
        </p>
      </div>

      {/* Key features grid */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {[
          { icon: Brain, label: "Persistent Memory", desc: "Remembers across sessions" },
          { icon: Zap, label: "Background Tasks", desc: "Autonomous task execution" },
          { icon: Shield, label: "100% Local", desc: "Your keys, your data" },
          { icon: FolderTree, label: "Project Aware", desc: "Auto-detects workspaces" },
        ].map(({ icon: Icon, label, desc }) => (
          <Card key={label} size="sm">
            <CardContent>
              <div className="flex flex-col items-center gap-1.5 py-1">
                <Icon className="size-4 text-primary" />
                <span className="text-xs font-medium">{label}</span>
                <span className="text-[0.55rem] text-muted-foreground">{desc}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button onClick={onNext} className="gap-2 font-mono text-xs">
        Get Started
        <ArrowRight className="size-3.5" />
      </Button>
    </div>
  );
}

// ─── API Keys Step ───────────────────────────────────────────────────

function KeysStep({
  providerStates,
  onKeyChange,
  onSaveKey,
  onNext,
  onBack,
}: {
  providerStates: Record<string, ProviderKeyState>;
  onKeyChange: (id: string, key: string) => void;
  onSaveKey: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const hasSavedKey = Object.values(providerStates).some((s) => s.saved);

  const [showStates, setShowStates] = useState<Record<string, boolean>>({});

  const toggleShow = (id: string) => {
    setShowStates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex flex-col items-center gap-6 text-center animate-in fade-in slide-in-from-right-4 duration-500 w-full max-w-md">
      <div className="relative">
        <div className="absolute inset-0 scale-150 animate-pulse rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex size-14 items-center justify-center rounded-2xl bg-card ring-1 ring-border">
          <KeyRound className="size-6 text-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Connect a Model Provider</h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-sm">
          Add at least one API key. Your keys are stored locally and never leave your machine.
          You can add more later in Settings.
        </p>
      </div>

      <div className="w-full space-y-3">
        {PROVIDERS.map((provider) => {
          const state = providerStates[provider.id] || { key: "", showKey: false, saved: false };
          return (
            <Card key={provider.id} size="sm" className={state.saved ? "ring-1 ring-green-500/30" : ""}>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{provider.icon}</span>
                      <span className="text-xs font-medium">{provider.name}</span>
                      {provider.recommended && (
                        <Badge variant="outline" className="text-[0.5rem] px-1 py-0 text-primary border-primary/30">
                          Recommended
                        </Badge>
                      )}
                    </div>
                    {state.saved && (
                      <div className="flex items-center gap-1 text-green-500">
                        <CheckCircle2 className="size-3.5" />
                        <span className="text-[0.6rem] font-mono">Connected</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[0.55rem] text-muted-foreground text-left">
                    {provider.description}
                  </p>
                  {!state.saved && (
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showStates[provider.id] ? "text" : "password"}
                          placeholder={provider.placeholder}
                          value={state.key}
                          onChange={(e) => onKeyChange(provider.id, e.target.value)}
                          className="pr-8 font-mono text-xs h-8"
                        />
                        <button
                          type="button"
                          onClick={() => toggleShow(provider.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showStates[provider.id] ? (
                            <EyeOff className="size-3" />
                          ) : (
                            <Eye className="size-3" />
                          )}
                        </button>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 text-xs font-mono"
                        disabled={!state.key.trim()}
                        onClick={() => onSaveKey(provider.id)}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Ollama note */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50 w-full">
        <Globe className="size-3.5 text-muted-foreground shrink-0" />
        <p className="text-[0.55rem] text-muted-foreground text-left">
          Running Ollama locally? NIOM auto-detects it at <span className="font-mono">localhost:11434</span>.
          No API key needed — just start Ollama.
        </p>
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-mono" onClick={onBack}>
          <ArrowLeft className="size-3" />
          Back
        </Button>
        <Button
          size="sm"
          className="gap-1.5 text-xs font-mono"
          onClick={onNext}
          disabled={!hasSavedKey}
        >
          Continue
          <ArrowRight className="size-3" />
        </Button>
      </div>

      {!hasSavedKey && (
        <button
          onClick={onNext}
          className="text-[0.55rem] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
        >
          Skip for now →
        </button>
      )}
    </div>
  );
}

// ─── Features Step ───────────────────────────────────────────────────

function FeaturesStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const features = [
    {
      icon: Brain,
      title: "Persistent Memory",
      desc: "NIOM extracts and remembers facts about you — preferences, projects, patterns. Everything persists across conversations.",
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
    {
      icon: Zap,
      title: "Background Tasks",
      desc: "Fire off autonomous tasks that run in the background while you keep chatting. Like having AI minions.",
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      icon: Cpu,
      title: "Smart Routing",
      desc: "Every query is routed through a Skill Graph — NIOM picks the best tools and approach for each request.",
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      icon: MessageSquare,
      title: "Recall Mode",
      desc: "Toggle recall to inject relevant memories into conversations. NIOM gets smarter the more you use it.",
      color: "text-cyan-500",
      bg: "bg-cyan-500/10",
    },
    {
      icon: FolderTree,
      title: "Project Awareness",
      desc: "Auto-detects your workspaces — knows your tech stacks, conventions, and project structures.",
      color: "text-green-500",
      bg: "bg-green-500/10",
    },
    {
      icon: Shield,
      title: "100% Local",
      desc: "All data lives on your machine. Your API keys, memories, and conversations never touch any server.",
      color: "text-red-500",
      bg: "bg-red-500/10",
    },
  ];

  return (
    <div className="flex flex-col items-center gap-6 text-center animate-in fade-in slide-in-from-right-4 duration-500 w-full max-w-lg">
      <div className="relative">
        <div className="absolute inset-0 scale-150 animate-pulse rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex size-14 items-center justify-center rounded-2xl bg-card ring-1 ring-border">
          <Sparkles className="size-6 text-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">What NIOM Can Do</h2>
        <p className="text-xs text-muted-foreground">
          A quick look at the key features. You'll discover more as you use it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full">
        {features.map(({ icon: Icon, title, desc, color, bg }) => (
          <Card key={title} size="sm" className="text-left">
            <CardContent>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className={`flex size-6 items-center justify-center rounded-md ${bg}`}>
                    <Icon className={`size-3 ${color}`} />
                  </div>
                  <span className="text-xs font-medium">{title}</span>
                </div>
                <p className="text-[0.55rem] text-muted-foreground leading-relaxed">
                  {desc}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 w-full">
        <Sparkles className="size-3.5 text-primary shrink-0" />
        <p className="text-[0.55rem] text-muted-foreground text-left">
          <span className="font-medium text-foreground">Pro tip:</span> Press{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted text-[0.5rem] font-mono">⌥ Space</kbd>{" "}
          from anywhere to summon NIOM instantly.
        </p>
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-mono" onClick={onBack}>
          <ArrowLeft className="size-3" />
          Back
        </Button>
        <Button size="sm" className="gap-1.5 text-xs font-mono" onClick={onNext}>
          Almost Done
          <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── Ready Step ──────────────────────────────────────────────────────

function ReadyStep({ onComplete, onBack }: { onComplete: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="relative">
        <div className="absolute inset-0 scale-150 rounded-full bg-green-500/10 blur-3xl" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-card ring-1 ring-green-500/20">
          <Rocket className="size-7 text-green-500" />
        </div>
      </div>

      <div className="space-y-3 max-w-md">
        <h2 className="text-xl font-semibold">You're All Set! 🚀</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          NIOM is ready to go. Start a conversation and it will begin learning about you —
          your preferences, projects, and patterns.
        </p>
      </div>

      {/* Starter suggestions */}
      <div className="w-full max-w-sm space-y-2">
        <p className="text-[0.6rem] font-mono uppercase tracking-wider text-muted-foreground/60">
          Try saying something like
        </p>
        <div className="space-y-1.5">
          {[
            "Tell me about yourself — what can you do?",
            "Help me organize my project ideas",
            "What's new in TypeScript 5.7?",
          ].map((prompt) => (
            <div
              key={prompt}
              className="px-3 py-2 rounded-lg bg-muted/30 border border-border/50 text-xs text-muted-foreground text-left font-mono"
            >
              "{prompt}"
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-mono" onClick={onBack}>
          <ArrowLeft className="size-3" />
          Back
        </Button>
        <Button size="sm" className="gap-2 text-xs font-mono" onClick={onComplete}>
          <Sparkles className="size-3.5" />
          Start Chatting
        </Button>
      </div>
    </div>
  );
}

// ─── Main Onboarding View ────────────────────────────────────────────

const STEPS: Step[] = ["welcome", "keys", "features", "ready"];
const STEP_LABELS = ["Welcome", "Connect", "Features", "Ready"];

function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [providerStates, setProviderStates] = useState<Record<string, ProviderKeyState>>({
    anthropic: { key: "", showKey: false, saved: false },
    openai: { key: "", showKey: false, saved: false },
    google: { key: "", showKey: false, saved: false },
  });

  const stepIndex = STEPS.indexOf(currentStep);

  const goNext = useCallback(() => {
    const i = STEPS.indexOf(currentStep);
    if (i < STEPS.length - 1) setCurrentStep(STEPS[i + 1]);
  }, [currentStep]);

  const goBack = useCallback(() => {
    const i = STEPS.indexOf(currentStep);
    if (i > 0) setCurrentStep(STEPS[i - 1]);
  }, [currentStep]);

  const handleKeyChange = useCallback((providerId: string, key: string) => {
    setProviderStates((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], key },
    }));
  }, []);

  const handleSaveKey = useCallback(async (providerId: string) => {
    const state = providerStates[providerId];
    if (!state?.key.trim()) return;

    try {
      await window.niom.config.setApiKey(providerId, state.key.trim());
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: { key: "", showKey: false, saved: true },
      }));
    } catch (err) {
      console.error("[onboarding] Failed to save key:", err);
    }
  }, [providerStates]);

  const handleComplete = useCallback(async () => {
    try {
      await window.niom.config.set({ onboardingComplete: true });
    } catch {
      console.error("[onboarding] Failed to save onboarding state");
    }
    onComplete();
  }, [onComplete]);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden">
      {/* Background particles */}
      <Particles
        className="absolute inset-0 z-0"
        quantity={40}
        staticity={60}
        color="var(--primary)"
      />

      {/* Step indicator */}
      <div className="absolute top-6 z-10">
        <StepIndicator current={stepIndex} steps={STEP_LABELS} />
      </div>

      {/* Step content */}
      <div className="relative z-10 flex items-center justify-center px-6 w-full">
        {currentStep === "welcome" && <WelcomeStep onNext={goNext} />}
        {currentStep === "keys" && (
          <KeysStep
            providerStates={providerStates}
            onKeyChange={handleKeyChange}
            onSaveKey={handleSaveKey}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {currentStep === "features" && <FeaturesStep onNext={goNext} onBack={goBack} />}
        {currentStep === "ready" && <ReadyStep onComplete={handleComplete} onBack={goBack} />}
      </div>

      {/* Version */}
      <div className="absolute bottom-4 z-10">
        <p className="text-[0.5rem] font-mono uppercase tracking-widest text-muted-foreground/30">
          NIOM v0.1.0
        </p>
      </div>
    </div>
  );
}

export { OnboardingView };
