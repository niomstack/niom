import { useCallback, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
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
import {
  ArrowUp,
  Paperclip,
  XIcon,
  FileIcon,
  ImageIcon,
  FileTextIcon,
  ChevronDown,
  CheckIcon,
  SparklesIcon,
  CpuIcon,
  GlobeIcon,
} from "lucide-react";

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
    id: "claude-4-sonnet",
    name: "Claude 4 Sonnet",
    provider: "Anthropic",
    icon: <SparklesIcon className="size-3.5" />,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    icon: <GlobeIcon className="size-3.5" />,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    icon: <SparklesIcon className="size-3.5" />,
  },
  {
    id: "local-llama",
    name: "Llama 3.3 70B",
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
export function PromptBox() {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model>(MODELS[0]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    // TODO: Wire up to agent system
    console.log("Submit:", { input: trimmed, files, model: selectedModel.id });

    setInput("");
    setFiles([]);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, files, hasFiles, selectedModel]);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
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
    <div className="w-full bg-card backdrop-blur-xl rounded-xl shadow-md">
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
                  <button
                    onClick={() => removeFile(file.id)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </InputGroupAddon>
        )}

        {/* ── Textarea ── */}
        <InputGroupTextarea
          ref={textareaRef}
          placeholder="Ask NIOM anything..."
          className="min-h-[44px] max-h-[200px] font-mono text-sm placeholder:text-muted-foreground"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        />

        {/* ── Footer: Attach + Model selector + Send ── */}
        <InputGroupAddon align="block-end" className="">
          <div className="flex w-full items-center gap-1">
            {/* Attach file */}
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              onClick={handleFileSelect}
              className="text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-3.5" />
              <span className="sr-only">Attach files</span>
            </InputGroupButton>

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

            {/* Send button */}
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
          </div>
        </InputGroupAddon>
      </InputGroup>

      {/* Keyboard hint */}
      <div className="flex justify-center py-2 px-3">
        <span className="font-mono text-[0.6rem] text-muted-foreground">
          <kbd className="rounded border border-border px-1 py-0.5 text-[0.55rem]">
            Enter
          </kbd>{" "}
          to send ·{" "}
          <kbd className="rounded border border-border px-1 py-0.5 text-[0.55rem]">
            Shift + Enter
          </kbd>{" "}
          for new line
        </span>
      </div>
    </div>
  );
}
