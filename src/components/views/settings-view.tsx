/**
 * Settings View — Overhauled with tabbed navigation.
 *
 * Tabs:
 *   - Providers: API key management (existing, polished)
 *   - Memory:    Browse, view, edit, and delete memories
 *   - Context:   NCF stats dashboard
 *   - About:     Version info
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Cpu,
  Brain,
  Database,
  Trash2,
  Edit3,
  Save,
  X,
  User,
  Bot,
  FileText,
  Download,
  Upload,
  FolderTree,
  Hash,
  Clock,
} from "lucide-react";
import { ContextGraph } from "@/components/context-graph";

// ─── Types ───────────────────────────────────────────────────────────

type SettingsTab = "providers" | "memory" | "context";

interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl?: string;
}

interface ConfigState {
  providers: ProviderConfig[];
  defaultModel: string;
  ollamaUrl: string;
  theme: "dark" | "light";
  hasKeys: Record<string, boolean>;
}

type VerifyStatus = "idle" | "verifying" | "success" | "error";

interface ProviderState {
  key: string;
  showKey: boolean;
  verifyStatus: VerifyStatus;
  verifyMessage: string;
  dirty: boolean;
}

// ─── Provider Metadata ───────────────────────────────────────────────

const PROVIDER_META: Record<
  string,
  {
    icon: string;
    description: string;
    placeholder: string;
    models: string[];
    docsUrl: string;
  }
> = {
  anthropic: {
    icon: "🟣",
    description: "Claude models — best for reasoning and code",
    placeholder: "sk-ant-api03-...",
    models: ["claude-sonnet-4-20250514", "claude-haiku-3-5-20241022"],
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    icon: "🟢",
    description: "GPT models — versatile and fast",
    placeholder: "sk-proj-...",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    docsUrl: "https://platform.openai.com/api-keys",
  },
  google: {
    icon: "🔵",
    description: "Gemini models — multimodal and efficient",
    placeholder: "AIzaSy...",
    models: ["gemini-2.5-pro-preview-06-05", "gemini-2.0-flash"],
    docsUrl: "https://aistudio.google.com/apikey",
  },
  ollama: {
    icon: "🦙",
    description: "Local models — fully offline, no API key needed",
    placeholder: "http://localhost:11434",
    models: ["llama3.2", "mistral", "codellama", "deepseek-coder"],
    docsUrl: "https://ollama.com/download",
  },
};

// ─── Memory Category Metadata ────────────────────────────────────────

interface CategoryMeta {
  label: string;
  icon: string;
  description: string;
  scope: "user" | "agent";
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  profile: { label: "Profile", icon: "👤", description: "Identity facts — name, role, timezone", scope: "user" },
  preferences: { label: "Preferences", icon: "⚙️", description: "Topic-specific preferences — coding style, communication", scope: "user" },
  entities: { label: "Entities", icon: "🏷️", description: "People, projects, organizations mentioned", scope: "user" },
  events: { label: "Events", icon: "📅", description: "Decisions, milestones, dated occurrences", scope: "user" },
  cases: { label: "Cases", icon: "📋", description: "Problem → solution records", scope: "agent" },
  patterns: { label: "Patterns", icon: "🔄", description: "Reusable tool execution chains", scope: "agent" },
};

// ─── Component ───────────────────────────────────────────────────────

interface SettingsViewProps {
  onBack: () => void;
}

function SettingsView({ onBack }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({});
  const [loading, setLoading] = useState(true);

  // Memory browser state
  const [memories, setMemories] = useState<Record<string, MemoryItem[]>>({});
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [editingContent, setEditingContent] = useState<string | null>(null);

  // NCF stats
  const [stats, setStats] = useState<NCFStatsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Context view mode (lifted up for fullscreen graph)
  const [contextView, setContextView] = useState<"dashboard" | "graph">("dashboard");
  const isGraphFullscreen = activeTab === "context" && contextView === "graph";

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  // Load memory data when switching to memory tab
  useEffect(() => {
    if (activeTab === "memory" && Object.keys(memories).length === 0) {
      loadMemories();
    }
    if (activeTab === "context" && !stats) {
      loadStats();
    }
  }, [activeTab]);

  const loadConfig = async () => {
    try {
      const cfg = await window.niom.config.get();
      if (cfg) {
        setConfig(cfg as ConfigState);
        const states: Record<string, ProviderState> = {};
        for (const p of (cfg as ConfigState).providers) {
          states[p.id] = {
            key: "",
            showKey: false,
            verifyStatus: (cfg as ConfigState).hasKeys[p.id] ? "success" : "idle",
            verifyMessage: (cfg as ConfigState).hasKeys[p.id] ? "Connected" : "",
            dirty: false,
          };
        }
        setProviderStates(states);
      }
    } catch {
      console.error("[settings] Failed to load config");
    } finally {
      setLoading(false);
    }
  };

  const loadMemories = async () => {
    setMemoryLoading(true);
    try {
      const data = await window.niom.memory.list();
      setMemories(data || {});
    } catch {
      console.error("[settings] Failed to load memories");
    } finally {
      setMemoryLoading(false);
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const data = await window.niom.memory.stats();
      setStats(data);
    } catch {
      console.error("[settings] Failed to load stats");
      // Fallback: show zeroed stats instead of infinite spinner
      setStats({
        nodeCount: 0,
        memoryCounts: { profile: 0, preferences: 0, entities: 0, events: 0, cases: 0, patterns: 0 },
        totalMemories: 0,
        projectCount: 0,
        sessionCount: 0,
        l0IndexSize: 0,
      });
    } finally {
      setStatsLoading(false);
    }
  };

  // ─── Provider handlers ───────────────────────────────────────────

  const handleKeyChange = (providerId: string, value: string) => {
    setProviderStates((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        key: value,
        dirty: true,
        verifyStatus: "idle",
        verifyMessage: "",
      },
    }));
  };

  const handleSaveKey = useCallback(
    async (providerId: string) => {
      const state = providerStates[providerId];
      if (!state?.key.trim()) return;

      await window.niom.config.setApiKey(providerId, state.key.trim());

      setProviderStates((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          verifyStatus: "verifying" as VerifyStatus,
          verifyMessage: "Verifying...",
          dirty: false,
        },
      }));

      setTimeout(() => {
        setProviderStates((prev) => ({
          ...prev,
          [providerId]: {
            ...prev[providerId],
            verifyStatus: "success",
            verifyMessage: "Key saved",
            key: "",
          },
        }));
      }, 500);

      const cfg = await window.niom.config.get();
      if (cfg) setConfig(cfg as ConfigState);
    },
    [providerStates],
  );

  const handleRemoveKey = useCallback(async (providerId: string) => {
    await window.niom.config.setApiKey(providerId, "");
    setProviderStates((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        key: "",
        verifyStatus: "idle",
        verifyMessage: "",
        dirty: false,
      },
    }));
    const cfg = await window.niom.config.get();
    if (cfg) setConfig(cfg as ConfigState);
  }, []);

  // ─── Memory handlers ─────────────────────────────────────────────

  const handleDeleteMemory = useCallback(async (memoryPath: string) => {
    const success = await window.niom.memory.delete(memoryPath);
    if (success) {
      setSelectedMemory(null);
      setEditingContent(null);
      await loadMemories();
      await loadStats();
    }
  }, []);

  const handleSaveMemory = useCallback(async () => {
    if (!selectedMemory || editingContent === null) return;
    const success = await window.niom.memory.update(selectedMemory.path, editingContent);
    if (success) {
      setEditingContent(null);
      setSelectedMemory((prev: MemoryItem | null) => prev ? { ...prev, content: editingContent } : null);
      await loadMemories();
    }
  }, [selectedMemory, editingContent]);

  const handleExportMemories = useCallback(async () => {
    try {
      const data = await window.niom.memory.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `niom-memories-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      console.error("[settings] Export failed");
    }
  }, []);

  const handleImportMemories = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await window.niom.memory.import(data);
        await loadMemories();
        alert(`Imported ${result.imported} memories${result.skipped ? ` (${result.skipped} skipped)` : ""}.`);
      } catch (err) {
        console.error("[settings] Import failed", err);
        alert("Import failed — invalid JSON format.");
      }
    };
    input.click();
  }, []);

  // ─── Total memory count ──────────────────────────────────────────

  const totalMemories = useMemo(() => {
    return Object.values(memories).reduce((sum, items) => sum + items.length, 0);
  }, [memories]);

  // ─── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Failed to load configuration
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-mono text-sm font-medium uppercase tracking-wider">
            Settings
          </h1>
        </div>
        {/* Context view mode toggle — show when on context tab */}
        {activeTab === "context" && (
          <div className="flex gap-0.5 rounded-md border border-border p-0.5 bg-muted/30">
            <button
              onClick={() => setContextView("dashboard")}
              className={`px-2 py-1 text-[0.6rem] font-mono rounded-sm transition-colors ${
                contextView === "dashboard"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setContextView("graph")}
              className={`px-2 py-1 text-[0.6rem] font-mono rounded-sm transition-colors ${
                contextView === "graph"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Graph
            </button>
          </div>
        )}
        {/* Tab navigation */}
        <div className="flex gap-1">
          {([
            { id: "providers", label: "Providers", icon: Cpu },
            { id: "memory", label: "Memory", icon: Brain },
            { id: "context", label: "Context", icon: Database },
          ] as const).map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={activeTab === id ? "default" : "ghost"}
              size="sm"
              className={`gap-1.5 text-xs font-mono ${
                activeTab === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(id)}
            >
              <Icon className="size-3" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Fullscreen Graph Mode — bypasses ScrollArea */}
      {isGraphFullscreen && (
        <div className="flex-1 relative">
          <ContextGraph height="100%" />
        </div>
      )}

      {/* Normal Content — with ScrollArea */}
      {!isGraphFullscreen && (
        <ScrollArea className="flex-1">
          <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
            {activeTab === "providers" && (
              <ProvidersTab
                config={config}
                setConfig={setConfig}
                providerStates={providerStates}
                setProviderStates={setProviderStates}
                onKeyChange={handleKeyChange}
                onSaveKey={handleSaveKey}
                onRemoveKey={handleRemoveKey}
              />
            )}

            {activeTab === "memory" && (
              <MemoryTab
                memories={memories}
                loading={memoryLoading}
                totalMemories={totalMemories}
                selectedMemory={selectedMemory}
                editingContent={editingContent}
                onSelectMemory={setSelectedMemory}
                onStartEdit={(mem) => { setSelectedMemory(mem); setEditingContent(mem.content); }}
                onCancelEdit={() => setEditingContent(null)}
                onSaveEdit={handleSaveMemory}
                onEditContentChange={setEditingContent}
                onDeleteMemory={handleDeleteMemory}
                onExport={handleExportMemories}
                onImport={handleImportMemories}
              />
            )}

            {activeTab === "context" && (
              <ContextTab stats={stats} loading={statsLoading} onRefresh={loadStats} />
            )}

            {/* About — always at bottom */}
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-center font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground/60">
                NIOM — Local-first AI Agent
              </p>
              <AboutUpdater />
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tab Components
// ═══════════════════════════════════════════════════════════════════════

// ─── Providers Tab ───────────────────────────────────────────────────

function ProvidersTab({
  config, setConfig, providerStates, setProviderStates,
  onKeyChange, onSaveKey, onRemoveKey,
}: {
  config: ConfigState;
  setConfig: React.Dispatch<React.SetStateAction<ConfigState | null>>;
  providerStates: Record<string, ProviderState>;
  setProviderStates: React.Dispatch<React.SetStateAction<Record<string, ProviderState>>>;
  onKeyChange: (id: string, value: string) => void;
  onSaveKey: (id: string) => void;
  onRemoveKey: (id: string) => void;
}) {
  return (
    <>
      <Alert>
        <Shield className="size-4 text-primary" />
        <AlertDescription>
          API keys are encrypted at rest using your system keychain.
          They never leave this device.
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Cpu className="size-3.5" />
          Model Providers
        </h2>

        {config.providers.map((provider) => {
          const meta = PROVIDER_META[provider.id];
          const state = providerStates[provider.id];
          if (!meta || !state) return null;

          const isOllama = provider.id === "ollama";
          const isConnected = state.verifyStatus === "success" || config.hasKeys[provider.id];

          return (
            <Card key={provider.id} size="sm">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{meta.icon}</span>
                  <CardTitle>{provider.name}</CardTitle>
                </div>
                <CardDescription>{meta.description}</CardDescription>
                <CardAction>
                  <StatusBadge
                    status={state.verifyStatus}
                    message={state.verifyMessage}
                    isConnected={isConnected}
                    isOllama={isOllama}
                  />
                </CardAction>
              </CardHeader>

              <CardContent>
                {isOllama ? (
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={meta.placeholder}
                      value={config.ollamaUrl}
                      onChange={(e) =>
                        setConfig((prev) =>
                          prev ? { ...prev, ollamaUrl: e.target.value } : prev,
                        )
                      }
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await window.niom.config.set({ ollamaUrl: config.ollamaUrl });
                      }}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={state.showKey ? "text" : "password"}
                          placeholder={isConnected ? "••••••••••••••••" : meta.placeholder}
                          value={state.key}
                          onChange={(e) => onKeyChange(provider.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && state.dirty) onSaveKey(provider.id);
                          }}
                          className="pr-8 font-mono text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() =>
                            setProviderStates((prev) => ({
                              ...prev,
                              [provider.id]: { ...prev[provider.id], showKey: !prev[provider.id].showKey },
                            }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {state.showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </Button>
                      </div>

                      <Button
                        variant={state.dirty ? "default" : "outline"}
                        size="sm"
                        onClick={() => onSaveKey(provider.id)}
                        disabled={!state.dirty || state.verifyStatus === "verifying"}
                      >
                        {state.verifyStatus === "verifying" ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>

                      {isConnected && !state.dirty && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => onRemoveKey(provider.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>

                    {!isConnected && (
                      <p className="text-xs text-muted-foreground">
                        Get your key →{" "}
                        <Button
                          variant="link"
                          className="h-auto p-0 text-xs text-primary"
                          onClick={() => navigator.clipboard.writeText(meta.docsUrl)}
                        >
                          {meta.docsUrl.replace("https://", "")}
                        </Button>
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1">
                      {meta.models.map((m) => (
                        <Badge key={m} variant="outline" className="font-mono text-[0.6rem]">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ─── Memory Tab (Overhauled) ─────────────────────────────────────────

type MemoryViewMode = "timeline" | "categories";

/** Rough token count estimate (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Relative time display. */
function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

function MemoryTab({
  memories, loading, totalMemories, selectedMemory, editingContent,
  onSelectMemory, onStartEdit,
  onCancelEdit, onSaveEdit, onEditContentChange, onDeleteMemory, onExport, onImport,
}: {
  memories: Record<string, MemoryItem[]>;
  loading: boolean;
  totalMemories: number;
  selectedMemory: MemoryItem | null;
  editingContent: string | null;
  onSelectMemory: (mem: MemoryItem | null) => void;
  onStartEdit: (mem: MemoryItem) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (content: string) => void;
  onDeleteMemory: (path: string) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const [viewMode, setViewMode] = useState<MemoryViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Flatten all memories for timeline view
  const allMemories = useMemo(() => {
    const items: MemoryItem[] = [];
    for (const category of Object.keys(memories)) {
      for (const item of memories[category]) {
        items.push(item);
      }
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [memories]);

  // Apply search + category filters
  const filteredMemories = useMemo(() => {
    let filtered = allMemories;

    // Category filter
    if (activeFilters.size > 0) {
      filtered = filtered.filter((m) => activeFilters.has(m.category));
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q),
      );
    }

    return filtered;
  }, [allMemories, searchQuery, activeFilters]);

  // Total token count
  const totalTokens = useMemo(() => {
    return allMemories.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }, [allMemories]);

  // Toggle category filter
  const toggleFilter = (cat: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Selected memory detail view ──────────────────────────────
  if (selectedMemory) {
    const isEditing = editingContent !== null;
    const catMeta = CATEGORY_META[selectedMemory.category];
    const tokens = estimateTokens(selectedMemory.content);

    return (
      <div className="space-y-3">
        {/* Back + title */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => { onSelectMemory(null); onCancelEdit(); setDeleteConfirm(null); }}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium truncate">{selectedMemory.name}</h3>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[0.6rem] font-mono gap-1">
                {catMeta?.icon} {catMeta?.label}
              </Badge>
              <Badge variant="outline" className="text-[0.6rem] font-mono gap-1 border-purple-500/30 bg-purple-500/5 text-purple-400">
                ~{tokens.toLocaleString()} tokens
              </Badge>
              <span className="text-[0.6rem] text-muted-foreground font-mono">
                {timeAgo(selectedMemory.updatedAt)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {isEditing ? (
              <>
                <Button variant="default" size="sm" className="gap-1 h-7 text-xs" onClick={onSaveEdit}>
                  <Save className="size-3" /> Save
                </Button>
                <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={onCancelEdit}>
                  <X className="size-3" /> Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={() => onStartEdit(selectedMemory)}>
                  <Edit3 className="size-3" /> Edit
                </Button>
                {deleteConfirm === selectedMemory.path ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1 h-7 text-xs"
                    onClick={() => { onDeleteMemory(selectedMemory.path); setDeleteConfirm(null); }}
                  >
                    <Trash2 className="size-3" /> Confirm Delete
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-7 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirm(selectedMemory.path)}
                  >
                    <Trash2 className="size-3" /> Delete
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <Card size="sm">
          <CardContent>
            {isEditing ? (
              <textarea
                value={editingContent}
                onChange={(e) => onEditContentChange(e.target.value)}
                className="w-full min-h-[200px] bg-transparent font-mono text-xs leading-relaxed resize-y outline-none text-foreground"
                spellCheck={false}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90 max-h-[400px] overflow-y-auto">
                {selectedMemory.content || "(empty)"}
              </pre>
            )}
          </CardContent>
        </Card>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-[0.6rem] font-mono text-muted-foreground px-1">
          <span className="flex items-center gap-1">
            <FileText className="size-2.5" />
            {selectedMemory.size} bytes
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-2.5" />
            Created {new Date(selectedMemory.createdAt).toLocaleDateString()}
          </span>
          <span className="truncate opacity-60">
            {selectedMemory.path}
          </span>
        </div>
      </div>
    );
  }

  // ─── Memory Browser ───────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Brain className="size-3.5" />
          Memory Browser
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs gap-1.5">
            {totalMemories} {totalMemories === 1 ? "memory" : "memories"}
          </Badge>
          <Badge variant="outline" className="font-mono text-xs gap-1 border-purple-500/30 bg-purple-500/5 text-purple-400">
            ~{totalTokens.toLocaleString()} tokens
          </Badge>
        </div>
      </div>

      {/* Search + View Mode + Actions bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 font-mono text-xs"
          />
          <Brain className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 text-muted-foreground"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
        {/* View mode toggle */}
        <div className="flex gap-0.5 rounded-md border border-border p-0.5 bg-muted/30">
          <button
            onClick={() => setViewMode("timeline")}
            className={`px-2 py-1 text-[0.6rem] font-mono rounded-sm transition-colors ${
              viewMode === "timeline"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setViewMode("categories")}
            className={`px-2 py-1 text-[0.6rem] font-mono rounded-sm transition-colors ${
              viewMode === "categories"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Categories
          </button>
        </div>
        <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={onImport}>
          <Upload className="size-3" />
        </Button>
        <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={onExport}>
          <Download className="size-3" />
        </Button>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(CATEGORY_META).map(([cat, meta]) => {
          const count = (memories[cat] || []).length;
          const isActive = activeFilters.has(cat);
          return (
            <button
              key={cat}
              onClick={() => toggleFilter(cat)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[0.6rem] font-mono transition-all border ${
                isActive
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : count > 0
                    ? "border-border bg-muted/30 text-foreground/70 hover:bg-muted/60"
                    : "border-border/50 bg-transparent text-muted-foreground/50"
              }`}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className="opacity-60">{count}</span>
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={() => setActiveFilters(new Set())}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[0.6rem] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-2.5" />
            Clear
          </button>
        )}
      </div>

      {/* Empty state */}
      {totalMemories === 0 && (
        <Card size="sm">
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="size-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No memories yet</p>
              <p className="text-xs mt-1">
                NIOM learns about you from conversations. Start chatting and memories will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search results info */}
      {(searchQuery || activeFilters.size > 0) && totalMemories > 0 && (
        <p className="text-[0.65rem] font-mono text-muted-foreground">
          Showing {filteredMemories.length} of {totalMemories} memories
          {searchQuery && <> matching &quot;{searchQuery}&quot;</>}
        </p>
      )}

      {/* Timeline View */}
      {viewMode === "timeline" && filteredMemories.length > 0 && (
        <div className="space-y-1">
          {filteredMemories.map((item) => {
            const catMeta = CATEGORY_META[item.category];
            const tokens = estimateTokens(item.content);
            return (
              <button
                key={item.path}
                onClick={() => onSelectMemory(item)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-all text-left group"
              >
                <span className="text-base shrink-0">{catMeta?.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{item.name}</span>
                    <Badge variant="outline" className="text-[0.5rem] font-mono px-1 py-0 shrink-0">
                      {catMeta?.label}
                    </Badge>
                  </div>
                  <p className="text-[0.6rem] text-muted-foreground truncate mt-0.5">
                    {item.content.slice(0, 120).replace(/\n/g, " ").trim()}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[0.55rem] text-muted-foreground font-mono">{timeAgo(item.updatedAt)}</p>
                  <p className="text-[0.5rem] text-muted-foreground/50 font-mono">~{tokens} tok</p>
                </div>
                {/* Quick actions on hover */}
                <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); onStartEdit(item); }}
                  >
                    <Edit3 className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); onDeleteMemory(item.path); }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Categories View */}
      {viewMode === "categories" && (
        <>
          {/* User memories */}
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-[0.65rem] font-mono uppercase tracking-wider text-muted-foreground">
              <User className="size-3" />
              User Memories
            </h3>
            <Accordion type="multiple" className="space-y-1">
              {(["profile", "preferences", "entities", "events"] as const).map((cat) => {
                const items = (activeFilters.size > 0 && !activeFilters.has(cat)) ? [] : (memories[cat] || []).filter(
                  (item) => !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.content.toLowerCase().includes(searchQuery.toLowerCase()),
                );
                const meta = CATEGORY_META[cat];
                const catTokens = items.reduce((sum, item) => sum + estimateTokens(item.content), 0);
                return (
                  <AccordionItem key={cat} value={cat} className="border rounded-lg bg-card">
                    <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/30">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <span className="text-base">{meta.icon}</span>
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-sm font-medium">{meta.label}</p>
                          <p className="text-[0.65rem] text-muted-foreground truncate">{meta.description}</p>
                        </div>
                        <Badge variant="outline" className="font-mono text-[0.6rem] shrink-0 mr-1">
                          {items.length}
                        </Badge>
                        {catTokens > 0 && (
                          <Badge variant="outline" className="font-mono text-[0.5rem] shrink-0 mr-2 border-purple-500/20 text-purple-400/70">
                            ~{catTokens} tok
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      {items.length > 0 ? (
                        <div className="border-t border-border">
                          {items.map((item) => (
                            <button
                              key={item.path}
                              onClick={() => onSelectMemory(item)}
                              className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors text-left group"
                            >
                              <FileText className="size-3 text-muted-foreground shrink-0" />
                              <span className="text-xs font-medium flex-1 truncate">{item.name}</span>
                              <span className="text-[0.5rem] text-muted-foreground/50 font-mono shrink-0">
                                ~{estimateTokens(item.content)} tok
                              </span>
                              <span className="text-[0.55rem] text-muted-foreground font-mono shrink-0">
                                {timeAgo(item.updatedAt)}
                              </span>
                              <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="size-5 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); onDeleteMemory(item.path); }}
                                >
                                  <Trash2 className="size-2.5" />
                                </Button>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[0.65rem] text-muted-foreground italic px-4 pb-1">No {meta.label.toLowerCase()} recorded yet</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>

          {/* Agent memories */}
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-[0.65rem] font-mono uppercase tracking-wider text-muted-foreground">
              <Bot className="size-3" />
              Agent Memories
            </h3>
            <Accordion type="multiple" className="space-y-1">
              {(["cases", "patterns"] as const).map((cat) => {
                const items = (activeFilters.size > 0 && !activeFilters.has(cat)) ? [] : (memories[cat] || []).filter(
                  (item) => !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.content.toLowerCase().includes(searchQuery.toLowerCase()),
                );
                const meta = CATEGORY_META[cat];
                const catTokens = items.reduce((sum, item) => sum + estimateTokens(item.content), 0);
                return (
                  <AccordionItem key={cat} value={cat} className="border rounded-lg bg-card">
                    <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/30">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <span className="text-base">{meta.icon}</span>
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-sm font-medium">{meta.label}</p>
                          <p className="text-[0.65rem] text-muted-foreground truncate">{meta.description}</p>
                        </div>
                        <Badge variant="outline" className="font-mono text-[0.6rem] shrink-0 mr-1">
                          {items.length}
                        </Badge>
                        {catTokens > 0 && (
                          <Badge variant="outline" className="font-mono text-[0.5rem] shrink-0 mr-2 border-purple-500/20 text-purple-400/70">
                            ~{catTokens} tok
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      {items.length > 0 ? (
                        <div className="border-t border-border">
                          {items.map((item) => (
                            <button
                              key={item.path}
                              onClick={() => onSelectMemory(item)}
                              className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors text-left group"
                            >
                              <FileText className="size-3 text-muted-foreground shrink-0" />
                              <span className="text-xs font-medium flex-1 truncate">{item.name}</span>
                              <span className="text-[0.5rem] text-muted-foreground/50 font-mono shrink-0">
                                ~{estimateTokens(item.content)} tok
                              </span>
                              <span className="text-[0.55rem] text-muted-foreground font-mono shrink-0">
                                {timeAgo(item.updatedAt)}
                              </span>
                              <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="size-5 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); onDeleteMemory(item.path); }}
                                >
                                  <Trash2 className="size-2.5" />
                                </Button>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[0.65rem] text-muted-foreground italic px-4 pb-1">No {meta.label.toLowerCase()} recorded yet</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Context Tab ─────────────────────────────────────────────────────

function ContextTab({ stats, loading, onRefresh }: { stats: NCFStatsPayload | null; loading: boolean; onRefresh: () => void }) {
  const [projects, setProjects] = useState<Array<{
    hash: string; name: string; rootPath: string;
    techStack: Array<{ name: string; version?: string; detectedFrom: string }>;
    conventions: string[]; analyzedAt: number;
  }>>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  useEffect(() => {
    setProjectsLoading(true);
    window.niom.memory.projects().then((p) => {
      setProjects(p);
      setProjectsLoading(false);
    }).catch(() => setProjectsLoading(false));
  }, []);

  if (!stats && loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = stats || {
    nodeCount: 0, memoryCounts: {}, totalMemories: 0,
    projectCount: 0, sessionCount: 0, l0IndexSize: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Database className="size-3.5" />
          NCF Dashboard
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<Brain className="size-4 text-purple-500" />} label="Total Memories" value={s.totalMemories} />
        <StatCard icon={<FolderTree className="size-4 text-blue-500" />} label="Context Nodes" value={s.nodeCount} />
        <StatCard icon={<Hash className="size-4 text-green-500" />} label="L0 Index" value={s.l0IndexSize} />
      </div>

      {/* Memory breakdown */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-xs">Memory Breakdown</CardTitle>
          <CardDescription>Memories grouped by category</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(CATEGORY_META).map(([cat, meta]) => {
              const count = s.memoryCounts[cat] || 0;
              return (
                <div key={cat} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{meta.icon}</span>
                    <span className="text-xs">{meta.label}</span>
                    <Badge variant="outline" className="text-[0.55rem] font-mono">
                      {meta.scope}
                    </Badge>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Extra stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<FolderTree className="size-4 text-amber-500" />} label="Projects" value={s.projectCount} />
        <StatCard icon={<Clock className="size-4 text-cyan-500" />} label="Sessions" value={s.sessionCount} />
      </div>

      {/* Detected Workspaces */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-xs">Detected Workspaces</CardTitle>
          <CardDescription>Projects indexed by NIOM from your conversations</CardDescription>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <FolderTree className="size-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No workspaces detected yet</p>
              <p className="text-[0.65rem] mt-1">NIOM auto-detects workspaces when you use file tools in a project directory.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((proj) => (
                <div key={proj.hash} className="rounded-lg border border-border/50 bg-muted/20 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium">{proj.name}</span>
                    <span className="text-[0.55rem] text-muted-foreground/50">
                      {proj.analyzedAt ? new Date(proj.analyzedAt).toLocaleDateString() : "—"}
                    </span>
                  </div>
                  <div
                    className="text-[0.6rem] text-muted-foreground font-mono truncate cursor-pointer hover:text-primary transition-colors"
                    onClick={() => window.niom.shell.openPath(proj.rootPath)}
                    title="Reveal in Finder"
                  >
                    {proj.rootPath}
                  </div>
                  {proj.techStack.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {proj.techStack.map((tech, idx) => (
                        <Badge key={idx} variant="outline" className="text-[0.5rem] px-1 py-0 font-mono">
                          {tech.name}{tech.version ? ` ${tech.version}` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {proj.conventions.length > 0 && (
                    <div className="text-[0.55rem] text-muted-foreground/60 mt-0.5">
                      {proj.conventions.join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


// ─── Stat Card ───────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <p className="font-mono text-lg font-semibold">{value}</p>
            <p className="text-[0.6rem] text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────

function StatusBadge({
  status, message, isConnected, isOllama,
}: {
  status: VerifyStatus; message: string; isConnected: boolean; isOllama: boolean;
}) {
  if (status === "verifying") {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Loader2 className="size-3 animate-spin" />
        Verifying
      </Badge>
    );
  }

  if (isConnected || (isOllama && status !== "error")) {
    return (
      <Badge variant="outline" className="gap-1 border-green-500/30 bg-green-500/10 text-xs text-green-500">
        <CheckCircle2 className="size-3" />
        {message || "Connected"}
      </Badge>
    );
  }

  if (status === "error") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 text-xs text-destructive">
        <XCircle className="size-3" />
        {message || "Error"}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      Not configured
    </Badge>
  );
}

// ─── About / Updater ─────────────────────────────────────────────────

type UpdaterStatus = "idle" | "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error";

function AboutUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cleanup = window.niom?.updater?.onStatus(
      (data: { status: string; version?: string; progress?: number; error?: string }) => {
        setStatus(data.status as UpdaterStatus);
        if (data.version) setVersion(data.version);
        if (data.progress != null) setProgress(data.progress);
        if (data.error) setError(data.error);
      }
    );
    return cleanup;
  }, []);

  const handleCheck = async () => {
    setStatus("checking");
    setError(null);
    const available = await window.niom?.updater?.check();
    if (available) {
      setVersion(available);
      setStatus("available");
    } else {
      setStatus("up-to-date");
    }
  };

  const handleDownload = async () => {
    setStatus("downloading");
    setProgress(0);
    await window.niom?.updater?.download();
  };

  const handleInstall = () => {
    window.niom?.updater?.install();
  };

  return (
    <div className="flex items-center justify-center gap-2">
      {status === "idle" && (
        <Button variant="ghost" size="sm" onClick={handleCheck} className="h-5 px-2 font-mono text-[0.6rem] text-muted-foreground/60 hover:text-foreground">
          Check for updates
        </Button>
      )}
      {status === "checking" && (
        <span className="flex items-center gap-1.5 font-mono text-[0.6rem] text-muted-foreground/60">
          <Loader2 className="size-3 animate-spin" />
          Checking…
        </span>
      )}
      {status === "up-to-date" && (
        <span className="flex items-center gap-1.5 font-mono text-[0.6rem] text-muted-foreground/60">
          <CheckCircle2 className="size-3 text-green-500" />
          Up to date
        </span>
      )}
      {status === "available" && version && (
        <Button variant="ghost" size="sm" onClick={handleDownload} className="h-5 px-2 font-mono text-[0.6rem] text-primary hover:text-primary">
          <Download className="size-3 mr-1" />
          v{version} available — download
        </Button>
      )}
      {status === "downloading" && (
        <span className="flex items-center gap-1.5 font-mono text-[0.6rem] text-primary">
          <Loader2 className="size-3 animate-spin" />
          Downloading{progress != null ? ` ${progress}%` : "…"}
        </span>
      )}
      {status === "ready" && (
        <Button variant="ghost" size="sm" onClick={handleInstall} className="h-5 px-2 font-mono text-[0.6rem] text-green-500 hover:text-green-400">
          <Download className="size-3 mr-1" />
          Restart to update
        </Button>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1.5 font-mono text-[0.6rem] text-muted-foreground/50">
          <XCircle className="size-3" />
          {error || "Update check failed"}
          <Button variant="ghost" size="sm" onClick={handleCheck} className="h-4 px-1 font-mono text-[0.55rem] text-muted-foreground/50">
            retry
          </Button>
        </span>
      )}
    </div>
  );
}

export { SettingsView };
