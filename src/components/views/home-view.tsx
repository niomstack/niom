import { useEffect, useState, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import niomLogo from "@/assets/niom-logo.png";
import { Particles } from "@/components/ui/particles";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemGroup } from "@/components/ui/item";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Card } from "@/components/ui/card";
import {
  Search,
  MessageSquare,
  Pin,
  Sparkles,
  Brain,
  Zap,
  Shield,
  KeyRound,
  Settings,
  X,
  Rocket,
} from "lucide-react";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { PromptBox } from "@/components/prompt-box";
import { TaskList } from "@/components/task-panel";
import type { ThreadMeta } from "@/shared/types";
import type { TaskMeta, TaskTemplate } from "@/shared/task-types";
import { TASK_TEMPLATES, renderTemplateGoal } from "@/shared/task-templates";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Empty State: No API Key ────────────────────────────────────────

function NoApiKeyState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      {/* Glowing key icon */}
      <div className="relative">
        <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-xl" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-card ring-1 ring-border">
          <KeyRound className="size-7 text-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">
          Connect a model to get started
        </h3>
        <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">
          NIOM works with your API keys — your data never touches our servers.
          Add a key from Anthropic, OpenAI, Google, or connect a local Ollama instance.
        </p>
      </div>

      <Button
        variant="default"
        className="gap-2 font-mono text-xs"
        onClick={onOpenSettings}
      >
        <Settings className="size-3.5" />
        Open Settings
        <Kbd className="ml-1 text-[0.55rem] opacity-60">⌘,</Kbd>
      </Button>

      {/* Feature highlights */}
      <div className="mt-2 grid grid-cols-3 gap-4">
        {[
          { icon: Shield, label: "Local-first", desc: "Your data stays on your machine" },
          { icon: Zap, label: "Multi-provider", desc: "Any model, one interface" },
          { icon: Brain, label: "Remembers you", desc: "Gets smarter over time" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex flex-col items-center gap-1.5 rounded-lg p-3">
            <Icon className="size-4 text-primary/60" />
            <span className="text-[0.65rem] font-medium text-foreground">{label}</span>
            <span className="text-[0.55rem] text-muted-foreground leading-tight text-center">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty State: No Threads ────────────────────────────────────────

function NoThreadsState() {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      {/* Floating sparkle animation */}
      <div className="relative">
        <div className="absolute -top-1 -right-1 animate-pulse">
          <Sparkles className="size-3 text-primary/40" />
        </div>
        <div className="flex size-12 items-center justify-center rounded-xl bg-card ring-1 ring-border/60">
          <MessageSquare className="size-5 text-muted-foreground/60" />
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground/80">
          No conversations yet
        </p>
        <p className="max-w-xs text-[0.65rem] text-muted-foreground leading-relaxed">
          Start your first chat above. NIOM will learn your preferences and remember them across sessions.
        </p>
      </div>

      {/* Shortcut hints */}
      <div className="flex items-center gap-3 mt-1">
        <span className="font-mono text-[0.55rem] text-muted-foreground/70">
          <Kbd>⌘N</Kbd> new chat
        </span>
        <span className="text-muted-foreground/30">·</span>
        <span className="font-mono text-[0.55rem] text-muted-foreground/70">
          <Kbd>⌘K</Kbd> search
        </span>
        <span className="text-muted-foreground/30">·</span>
        <span className="font-mono text-[0.55rem] text-muted-foreground/70">
          <Kbd>⌘,</Kbd> settings
        </span>
      </div>
    </div>
  );
}

// ─── Template Bar ───────────────────────────────────────────────────

function TemplateBar({ onSelect }: { onSelect: (template: TaskTemplate) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground/60 mr-1">
        Tasks
      </span>
      {TASK_TEMPLATES.map((t) => (
        <Button
          key={t.id}
          variant="outline"
          size="sm"
          className="group gap-1.5 h-7 bg-card/80 text-xs text-muted-foreground backdrop-blur-sm hover:border-primary hover:bg-primary/10 hover:text-foreground transition-all"
          onClick={() => onSelect(t)}
        >
          <span className="text-sm">{t.icon}</span>
          <span className="font-mono text-[0.6rem] uppercase tracking-wider">
            {t.name}
          </span>
        </Button>
      ))}
    </div>
  );
}

// ─── Template Dialog ─────────────────────────────────────────────────

function TemplateDialog({
  template,
  onClose,
  onLaunch,
}: {
  template: TaskTemplate;
  onClose: () => void;
  onLaunch: (goal: string, systemPrompt: string, maxSteps?: number, checkpointEvery?: number) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const requiredFields = template.fields.filter((f) => f.required);
  const allRequiredFilled = requiredFields.every((f) => values[f.id]?.trim());

  const handleLaunch = () => {
    if (!allRequiredFilled) return;

    const goal = renderTemplateGoal(template, values);

    // Build the system prompt with field values substituted
    let prompt = template.systemPrompt;
    for (const field of template.fields) {
      const val = values[field.id]?.trim() || "";
      prompt = prompt.replace(new RegExp(`\\{\\{${field.id}\\}\\}`, "g"), val);
    }

    onLaunch(goal, prompt, template.maxSteps, template.checkpointEvery);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="w-full max-w-md mx-4 animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">{template.icon}</span>
            <div>
              <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
              <p className="text-[0.65rem] text-muted-foreground">{template.description}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>

        {/* Fields */}
        <div className="p-4 space-y-3">
          {template.fields.map((field) => (
            <div key={field.id} className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                {field.label}
                {field.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <Input
                placeholder={field.placeholder}
                value={values[field.id] || ""}
                onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                className="font-mono text-xs h-8"
                autoFocus={field === template.fields[0]}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-muted/30">
          <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground font-mono">
            <Zap className="size-2.5" />
            <span>Max {template.maxSteps || 30} steps</span>
            <span className="text-muted-foreground/40">·</span>
            <span>Checkpoint every {template.checkpointEvery || 10}</span>
          </div>
          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs font-mono"
            disabled={!allRequiredFilled}
            onClick={handleLaunch}
          >
            <Rocket className="size-3" />
            Launch Task
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── HomeView ────────────────────────────────────────────────────────

export interface HomeViewRef {
  focusSearch: () => void;
  focusPrompt: () => void;
}

interface HomeViewProps {
  isDark: boolean;
  onSubmit?: (text: string, model: string) => void;
  onSelectThread?: (id: string) => void;
  onDeleteThread?: (id: string) => void;
  onOpenSettings?: () => void;
  hasApiKey?: boolean;
  /** Global task list from useTaskManager */
  tasks?: TaskMeta[];
  /** Navigate to a task's source thread + open panel */
  onSelectTask?: (taskId: string, threadId: string) => void;
  /** Delete a task */
  onDeleteTask?: (taskId: string) => void;
  /** Submit a message explicitly as a background Task */
  onSubmitAsTask?: (goal: string, model: string) => void;
  /** Launch a task from a template with full config */
  onLaunchTemplate?: (goal: string, systemPrompt: string, maxSteps?: number, checkpointEvery?: number) => void;
  /** Whether cross-thread recall is active */
  recallEnabled?: boolean;
  /** Toggle cross-thread recall */
  onRecallChange?: (enabled: boolean) => void;
  /** Active window context from global hotkey */
  windowContext?: { appName: string; windowTitle: string } | null;
  /** Clear window context */
  onClearWindowContext?: () => void;
}

const HomeView = forwardRef<HomeViewRef, HomeViewProps>(function HomeView(
  { isDark, onSubmit, onSelectThread, onDeleteThread, onOpenSettings, hasApiKey = true, tasks = [], onSelectTask, onDeleteTask, onSubmitAsTask, onLaunchTemplate, recallEnabled, onRecallChange, windowContext, onClearWindowContext },
  ref,
) {
  const particleColor = isDark ? "#a78bfa" : "#7c3aed";
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<TaskTemplate | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const promptBoxRef = useRef<HTMLTextAreaElement>(null);

  // Expose focus methods to parent via ref
  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      setSearchVisible(true);
      // Wait for render then focus
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    },
    focusPrompt: () => {
      // Focus the textarea inside the PromptBox
      // We can't directly ref into PromptBox, so query it
      requestAnimationFrame(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[placeholder="Ask NIOM anything..."]',
        );
        textarea?.focus();
      });
    },
  }));

  useEffect(() => {
    window.niom?.threads?.list().then(setThreads).catch(() => {});
  }, []);

  const filteredThreads = searchQuery
    ? threads.filter((t) =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : threads;

  // Close search on Escape
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      setSearchVisible(false);
      searchInputRef.current?.blur();
    }
  };

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
        {/* NIOM Logo */}
        <div className="flex flex-col items-center gap-3 mb-2">
          <img
            src={niomLogo}
            alt="NIOM"
            className="size-16 drop-shadow-lg animate-in zoom-in-75 duration-500"
            draggable={false}
          />
        </div>

        {/* Prompt box */}
        <PromptBox onSubmit={onSubmit} onSubmitAsTask={onSubmitAsTask} recallEnabled={recallEnabled} onRecallChange={onRecallChange} windowContext={windowContext} onClearWindowContext={onClearWindowContext} />

        {/* Task Templates */}
        {hasApiKey && (
          <TemplateBar
            onSelect={(template) => setActiveTemplate(template)}
          />
        )}

        {/* Empty state or thread list */}
        {!hasApiKey ? (
          /* No API key configured — show setup wizard */
          <div className="w-full max-w-xl mt-4">
            <NoApiKeyState onOpenSettings={() => onOpenSettings?.()} />
          </div>
        ) : threads.length === 0 ? (
          /* API key exists but no threads yet */
          <div className="w-full max-w-xl mt-4">
            <NoThreadsState />
          </div>
        ) : (
          /* Recent threads */
          <div className="w-full max-w-xl mt-8">
            <div className="flex items-center justify-between mb-2">
              <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                Recent Threads
              </p>
              <div className="flex items-center gap-1.5">
                {/* Show/hide search toggle or always-visible */}
                {searchVisible ? (
                  <Input
                    ref={searchInputRef}
                    placeholder="Filter threads…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="h-6 w-48 font-mono text-xs animate-in fade-in slide-in-from-right-2 duration-200"
                    autoFocus
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      setSearchVisible(true);
                      requestAnimationFrame(() => searchInputRef.current?.focus());
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Search className="size-3" />
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="max-h-80 -mx-4 -my-6">
              <ItemGroup className="px-4 py-6">
                {filteredThreads.map((thread) => (
                  <div key={thread.id} className="group/thread relative">
                    <Item
                      variant="outline"
                      size="sm"
                      className="cursor-pointer bg-card transition-all hover:bg-muted/50 hover:shadow-[0_4px_16px_oklch(0_0_0/0.12)] dark:hover:shadow-[0_0_15px_oklch(0.74_0.14_290/0.1)] pr-10"
                      onClick={() => onSelectThread?.(thread.id)}
                    >
                      <ItemMedia variant="icon">
                        {thread.pinned ? (
                          <Pin className="size-4 text-primary" />
                        ) : (
                          <MessageSquare className="size-4 text-muted-foreground" />
                        )}
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{thread.title}</ItemTitle>
                        <ItemDescription>
                          {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"} · {formatRelativeTime(thread.updatedAt)}
                        </ItemDescription>
                      </ItemContent>
                    </Item>

                    {/* Delete button — visible on hover, requires confirmation */}
                    <ConfirmDeleteButton
                      onDelete={() => {
                        onDeleteThread?.(thread.id);
                        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/thread:opacity-100 transition-opacity"
                    />
                  </div>
                ))}
              </ItemGroup>
            </ScrollArea>
            {searchQuery && filteredThreads.length === 0 && (
              <p className="py-4 text-center font-mono text-xs text-muted-foreground">
                No threads matching "{searchQuery}"
              </p>
            )}
          </div>
        )}

        {/* Global tasks list */}
        {hasApiKey && tasks.length > 0 && (
          <div className="mt-4">
            <TaskList
              tasks={tasks}
              onSelect={(taskId) => {
                const task = tasks.find((t) => t.id === taskId);
                if (task) onSelectTask?.(taskId, task.threadId);
              }}
              onDelete={(taskId) => onDeleteTask?.(taskId)}
            />
          </div>
        )}
      </div>

      {/* Template dialog */}
      {activeTemplate && (
        <TemplateDialog
          template={activeTemplate}
          onClose={() => setActiveTemplate(null)}
          onLaunch={(goal, systemPrompt, maxSteps, checkpointEvery) => {
            onLaunchTemplate?.(goal, systemPrompt, maxSteps, checkpointEvery);
            setActiveTemplate(null);
          }}
        />
      )}
    </div>
  );
});

export { HomeView };
