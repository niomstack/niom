import { useCallback, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "./ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import {
  ArrowUp,
  Paperclip,
  XIcon,
  FileIcon,
  ImageIcon,
  FileTextIcon,
  ChevronDown,
  ChevronRight,
  CheckIcon,
  SparklesIcon,
  CpuIcon,
  GlobeIcon,
  Square,
  Zap,
  AlertTriangle,
  LibraryBig,
  Mic,
  MicOff,
  Loader2,
  AppWindow,
  X,
  Antenna,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { useVoiceInput } from "@/hooks/use-voice-input";

// ─── Types ───────────────────────────────────────────────────────────
interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
  icon: React.ReactNode;
}

const MODELS: Model[] = [
  {
    id: "anthropic:claude-sonnet-4-20250514",
    name: "Claude 4 Sonnet",
    provider: "Anthropic",
    icon: <SparklesIcon className="size-3.5" />,
  },
  {
    id: "openai:gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    icon: <GlobeIcon className="size-3.5" />,
  },
  {
    id: "google:gemini-2.5-pro-preview-06-05",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    icon: <SparklesIcon className="size-3.5" />,
  },
  {
    id: "ollama:llama3.2",
    name: "Llama 3.2",
    provider: "Local",
    icon: <CpuIcon className="size-3.5" />,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/"))
    return <ImageIcon className="size-3 shrink-0" />;
  if (type.startsWith("text/") || type.includes("pdf"))
    return <FileTextIcon className="size-3 shrink-0" />;
  return <FileIcon className="size-3 shrink-0" />;
}

// ─── Component ───────────────────────────────────────────────────────

interface PromptBoxProps {
  onSubmit?: (text: string, model: string) => void;
  /** Called when user explicitly submits as a Task */
  onSubmitAsTask?: (goal: string, model: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  compact?: boolean;
  /** Whether a task is awaiting user approval */
  pendingApproval?: boolean;
  /** Open the task panel (used from approval banner) */
  onOpenTaskPanel?: () => void;
  /** Whether cross-thread recall is active */
  recallEnabled?: boolean;
  /** Toggle cross-thread recall */
  onRecallChange?: (enabled: boolean) => void;
  /** Whether task awareness is active */
  taskAwarenessEnabled?: boolean;
  /** Toggle task awareness */
  onTaskAwarenessChange?: (enabled: boolean) => void;
  /** Active window context from global hotkey (Option+Space) */
  windowContext?: { appName: string; windowTitle: string } | null;
  /** Clear the window context */
  onClearWindowContext?: () => void;
}

export function PromptBox({ onSubmit: onSubmitProp, onSubmitAsTask, onStop, isStreaming, compact, pendingApproval, onOpenTaskPanel, recallEnabled, onRecallChange, taskAwarenessEnabled, onTaskAwarenessChange, windowContext, onClearWindowContext }: PromptBoxProps = {}) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model>(MODELS[0]);
  const [taskMode, setTaskMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if voice input is available (needs OpenAI key)
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  useEffect(() => {
    window.niom?.config?.get().then((config) => {
      setVoiceAvailable(config?.hasKeys?.openai === true);
    });
  }, []);

  // Voice input
  const { isRecording, isTranscribing, toggleRecording } = useVoiceInput({
    onTranscription: (text) => {
      // Append transcribed text at cursor / end of current input
      setInput((prev) => {
        const separator = prev.length > 0 && !prev.endsWith(" ") ? " " : "";
        return prev + separator + text;
      });
      // Focus the textarea after transcription
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    onError: (error) => {
      toast.error("Voice input failed", { description: error });
    },
  });

  const hasFiles = files.length > 0;

  // File handling
  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      if (!selected) return;

      const newFiles: AttachedFile[] = Array.from(selected).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        type: f.type,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
      // Reset input so same file can be re-selected
      e.target.value = "";
    },
    [],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // Submit
  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && !hasFiles) return;

    if (taskMode && onSubmitAsTask) {
      // Submit as a background Task
      onSubmitAsTask(trimmed, selectedModel.id);
      setTaskMode(false); // Reset after submit
    } else if (onSubmitProp) {
      // If window context is active, prepend it so the agent knows what the user was doing
      let finalText = trimmed;
      if (windowContext) {
        const ctx = windowContext.windowTitle
          ? `[Context: User was in ${windowContext.appName} — ${windowContext.windowTitle}]`
          : `[Context: User was in ${windowContext.appName}]`;
        finalText = `${ctx}\n${trimmed}`;
      }
      onSubmitProp(finalText, selectedModel.id);
    }

    setInput("");
    setFiles([]);
    onClearWindowContext?.();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, files, hasFiles, selectedModel, onSubmitProp, onSubmitAsTask, taskMode, windowContext, onClearWindowContext]);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isStreaming) return; // Ignore keyboard during streaming
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, isStreaming],
  );

  // Auto-resize textarea
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    },
    [],
  );

  const canSubmit = input.trim().length > 0 || hasFiles;

  return (
    <div className="w-full rounded-xl border border-border bg-card shadow-lg dark:shadow-[0_4px_24px_rgba(0,0,0,0.3)] shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
      {/* Pending task approval banner */}
      {pendingApproval && (
        <button
          onClick={onOpenTaskPanel}
          className="flex w-full items-center gap-2 rounded-t-xl border-b border-amber-600/20 dark:border-amber-400/20 bg-amber-600/5 dark:bg-amber-400/5 px-3 py-1.5 text-xs font-mono text-amber-600 dark:text-amber-400 hover:bg-amber-600/10 dark:hover:bg-amber-400/10 transition-colors cursor-pointer"
        >
          <AlertTriangle className="size-3 shrink-0" />
          <span>A background task is waiting for your approval</span>
          <ChevronRight className="size-3 ml-auto shrink-0" />
        </button>
      )}

      {/* Active window context badge (from Option+Space hotkey) */}
      {windowContext && (
        <div className="flex w-full items-center gap-2 rounded-t-xl border-b border-teal-600/20 dark:border-teal-400/20 bg-teal-600/5 dark:bg-teal-400/5 px-3 py-1.5">
          <AppWindow className="size-3 shrink-0 text-teal-600 dark:text-teal-400" />
          <span className="text-xs font-mono text-teal-600 dark:text-teal-400 truncate">
            {windowContext.appName}
            {windowContext.windowTitle && (
              <span className="text-teal-600/60 dark:text-teal-400/60">
                {" — "}{windowContext.windowTitle.length > 60
                  ? windowContext.windowTitle.slice(0, 60) + "…"
                  : windowContext.windowTitle}
              </span>
            )}
          </span>
          <button
            onClick={onClearWindowContext}
            className="ml-auto shrink-0 text-teal-600/60 dark:text-teal-400/60 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <InputGroup className="rounded-xl border-border bg-card shadow-sm backdrop-blur-xl transition-all duration-300 focus-within:border-primary focus-within:shadow-[0_0_0_1px_oklch(0.74_0.14_290/0.3),0_8px_40px_oklch(0.74_0.14_290/0.12)]">
        {/* ── Header: File attachments (conditional) ── */}
        {hasFiles && (
          <InputGroupAddon
            align="block-start"
            className="border-b border-border"
          >
            <div className="flex w-full flex-wrap gap-1.5">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group/file flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs transition-colors hover:border-primary"
                >
                  {getFileIcon(file.type)}
                  <span className="max-w-[120px] truncate font-mono text-[0.65rem] text-foreground">
                    {file.name}
                  </span>
                  <span className="text-[0.6rem] text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeFile(file.id)}
                    className="ml-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </InputGroupAddon>
        )}

        {/* ── Textarea ── */}
        <InputGroupTextarea
          ref={textareaRef}
          placeholder={isStreaming ? "NIOM is generating..." : "Ask NIOM anything..."}
          className="min-h-[44px] max-h-[200px] font-mono text-sm placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isStreaming}
        />

        {/* ── Footer: Attach + Model selector + Send ── */}
        <InputGroupAddon align="block-end" className="">
          <div className="flex w-full items-center gap-1">
            {/* Attach file */}
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              onClick={handleFileSelect}
              className="text-foreground/70 hover:text-foreground"
            >
              <Paperclip className="size-3.5" />
              <span className="sr-only">Attach files</span>
            </InputGroupButton>

            {/* Task mode toggle */}
            {onSubmitAsTask && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setTaskMode((prev) => !prev)}
                      className={`relative transition-all ${
                        taskMode
                          ? "text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 bg-amber-600/10 dark:bg-amber-400/10"
                          : "text-foreground/70 hover:text-foreground"
                      }`}
                    >
                      <Zap className={`size-3.5 ${taskMode ? "fill-current" : ""}`} />
                      {taskMode && (
                        <span className="absolute -top-0.5 -right-0.5 flex size-1.5">
                          <span className="absolute inline-flex size-full rounded-full bg-amber-600 dark:bg-amber-400 opacity-75 animate-ping" />
                          <span className="relative inline-flex size-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {taskMode ? "Task mode ON — will run in background" : "Send as background Task"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Cross-thread recall toggle */}
            {onRecallChange && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onRecallChange(!recallEnabled)}
                      className={`relative transition-all ${
                        recallEnabled
                          ? "text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 bg-violet-600/10 dark:bg-violet-400/10"
                          : "text-foreground/70 hover:text-foreground"
                      }`}
                    >
                      <LibraryBig className="size-3.5" />
                      {recallEnabled && (
                        <span className="absolute -top-0.5 -right-0.5 flex size-1.5">
                          <span className="relative inline-flex size-1.5 rounded-full bg-violet-600 dark:bg-violet-400" />
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {recallEnabled ? "Recall ON — using knowledge from all threads" : "Recall — inject task knowledge from other threads"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Task awareness toggle */}
            {onTaskAwarenessChange && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onTaskAwarenessChange(!taskAwarenessEnabled)}
                      className={`relative transition-all ${
                        taskAwarenessEnabled
                          ? "text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 bg-amber-600/10 dark:bg-amber-400/10"
                          : "text-foreground/70 hover:text-foreground"
                      }`}
                    >
                      <Antenna className="size-3.5" />
                      {taskAwarenessEnabled && (
                        <span className="absolute -top-0.5 -right-0.5 flex size-1.5">
                          <span className="relative inline-flex size-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {taskAwarenessEnabled ? "Task Awareness ON — you can interact with running tasks" : "Task Awareness — let the agent see and steer running tasks"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Voice input toggle */}
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={voiceAvailable ? toggleRecording : undefined}
                    disabled={!voiceAvailable || isTranscribing}
                    className={`relative transition-all ${
                      !voiceAvailable
                        ? "text-foreground/30 cursor-not-allowed"
                        : isRecording
                        ? "text-rose-500 dark:text-rose-400 hover:text-rose-400 dark:hover:text-rose-300 bg-rose-500/10 dark:bg-rose-400/10"
                        : isTranscribing
                        ? "text-amber-500 dark:text-amber-400"
                        : "text-foreground/70 hover:text-foreground"
                    }`}
                  >
                    {isTranscribing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : isRecording ? (
                      <MicOff className="size-3.5" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                    {isRecording && (
                      <span className="absolute -top-0.5 -right-0.5 flex size-1.5">
                        <span className="absolute inline-flex size-full rounded-full bg-rose-500 dark:bg-rose-400 opacity-75 animate-ping" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-rose-500 dark:bg-rose-400" />
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {!voiceAvailable
                    ? "Add OpenAI API key in Settings for voice input"
                    : isRecording
                    ? "Listening... stops when you pause"
                    : isTranscribing
                    ? "Processing..."
                    : "Voice input"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-6 gap-1 rounded-md px-2 text-[0.65rem] font-medium text-muted-foreground hover:text-foreground"
                >
                  {selectedModel.icon}
                  <span className="font-mono">{selectedModel.name}</span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={8}
                className="w-56"
              >
                <DropdownMenuLabel className="font-mono uppercase tracking-widest text-[0.6rem]">
                  Select Model
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {MODELS.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => setSelectedModel(model)}
                    className="gap-2"
                  >
                    {model.icon}
                    <div className="flex flex-1 flex-col">
                      <span className="text-xs font-medium">{model.name}</span>
                      <span className="font-mono text-[0.6rem] text-muted-foreground">
                        {model.provider}
                      </span>
                    </div>
                    {selectedModel.id === model.id && (
                      <CheckIcon className="size-3.5 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Send / Stop button */}
            {isStreaming ? (
              <InputGroupButton
                size="icon-sm"
                variant="destructive"
                className="rounded-lg"
                onClick={onStop}
              >
                <Square className="size-3 fill-current" />
                <span className="sr-only">Stop generating</span>
              </InputGroupButton>
            ) : (
              <InputGroupButton
                size="icon-sm"
                variant="default"
                className="rounded-lg"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                <ArrowUp className="size-3.5" />
                <span className="sr-only">Send</span>
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>

      {/* Keyboard hint */}
      {!compact && (
      <div className="flex justify-center py-2 px-3">
        <span className="font-mono text-[0.6rem] text-muted-foreground">
          <Kbd>Enter</Kbd>{" "}
          to send ·{" "}
          <Kbd>Shift + Enter</Kbd>{" "}
          for new line ·{" "}
          <Kbd>Esc</Kbd>{" "}
          to stop
        </span>
      </div>
      )}
    </div>
  );
}
