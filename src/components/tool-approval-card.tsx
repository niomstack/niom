/**
 * ToolApprovalCard — Confirmation UI for tools that require user approval.
 *
 * Shows the tool name, description, and arguments preview.
 * User can Approve, Deny, or "Always Approve for this session".
 */

import { useState } from "react";
import {
  ShieldCheck,
  ShieldX,
  FilePen,
  Terminal,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ToolApprovalRequest {
  approvalId: string;
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  displayName: string;
  description: string;
}

interface ToolApprovalCardProps {
  request: ToolApprovalRequest;
  onApprove: (approvalId: string, rememberForSession: boolean) => void;
  onDeny: (approvalId: string) => void;
}

// Tool icon mapping
function getToolIcon(toolName: string) {
  switch (toolName) {
    case "writeFile":
    case "editFile":
      return FilePen;
    case "runCommand":
      return Terminal;
    default:
      return ShieldCheck;
  }
}

export function ToolApprovalCard({ request, onApprove, onDeny }: ToolApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState<"approved" | "denied" | null>(null);

  const Icon = getToolIcon(request.toolName);

  const handleApprove = (rememberForSession: boolean) => {
    setDecided("approved");
    onApprove(request.approvalId, rememberForSession);
  };

  const handleDeny = () => {
    setDecided("denied");
    onDeny(request.approvalId);
  };

  // Already decided — show collapsed result
  if (decided) {
    return (
      <div className={`rounded-lg border overflow-hidden transition-all duration-200 animate-in fade-in ${
        decided === "approved"
          ? "border-green-500/30 bg-green-500/5"
          : "border-red-500/30 bg-red-500/5"
      }`}>
        <div className="flex items-center gap-2.5 px-3 py-2">
          {decided === "approved" ? (
            <ShieldCheck className="size-3.5 text-green-500 shrink-0" />
          ) : (
            <ShieldX className="size-3.5 text-red-500 shrink-0" />
          )}
          <span className="font-mono text-xs font-medium text-foreground">
            {request.displayName}
          </span>
          <span className="truncate text-[0.6rem] text-muted-foreground font-mono flex-1">
            {request.description}
          </span>
          <Badge
            variant="outline"
            className={`text-[0.55rem] ${
              decided === "approved"
                ? "text-green-500 border-green-500/30"
                : "text-red-500 border-red-500/30"
            }`}
          >
            {decided === "approved" ? "Approved" : "Denied"}
          </Badge>
        </div>
      </div>
    );
  }

  // Pending approval
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 overflow-hidden transition-all duration-200 animate-in fade-in slide-in-from-bottom-2">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Loader2 className="size-3.5 text-amber-500 animate-spin shrink-0" />
        <Icon className="size-3.5 text-primary/70 shrink-0" />
        <span className="font-mono text-xs font-medium text-foreground">
          {request.displayName}
        </span>
        <span className="text-[0.6rem] text-amber-600 dark:text-amber-400 font-medium">
          needs approval
        </span>
      </div>

      {/* Description + Preview */}
      <div className="border-t border-amber-500/20 px-3 py-2 space-y-2">
        <p className="text-[0.7rem] text-foreground/80 leading-relaxed">
          {request.description}
        </p>

        {/* Expandable args preview */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[0.6rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDown className="size-2.5" />
          ) : (
            <ChevronRight className="size-2.5" />
          )}
          <span className="font-mono">Details</span>
        </button>

        {expanded && (
          <div className="rounded-md bg-muted/30 p-2 ring-1 ring-border/50">
            <pre className="text-[0.6rem] font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">
              {formatArgs(request.toolName, request.args)}
            </pre>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => handleApprove(false)}
            className="h-6 text-[0.65rem] px-3 bg-green-600 hover:bg-green-700 text-white font-medium"
          >
            <ShieldCheck className="size-3 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleApprove(true)}
            className="h-6 text-[0.65rem] px-3 text-green-600 border-green-600/30 hover:bg-green-600/10 font-medium"
          >
            Always this session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDeny}
            className="h-6 text-[0.65rem] px-3 text-red-500 hover:bg-red-500/10 font-medium"
          >
            <ShieldX className="size-3 mr-1" />
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Args Formatting ──────────────────────────────────────────────────

function formatArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "writeFile": {
      const path = String(args.path || "");
      const content = String(args.content || "");
      const lines = content.split("\n");
      const preview = lines.length > 15
        ? lines.slice(0, 15).join("\n") + `\n... (${lines.length - 15} more lines)`
        : content;
      return `path: ${path}\n\ncontent:\n${preview}`;
    }
    case "runCommand": {
      const cmd = String(args.command || "");
      const cwd = args.cwd ? `\ncwd: ${args.cwd}` : "";
      const timeout = args.timeout ? `\ntimeout: ${args.timeout}s` : "";
      return `command: ${cmd}${cwd}${timeout}`;
    }
    default:
      return JSON.stringify(args, null, 2);
  }
}
