/**
 * ToolCallDisplay — rendering components for tool calls in chat messages.
 *
 * Extracts the formatToolCall helper and re-usable ToolCallRow component
 * that was previously inline in App.tsx.
 */

import React from "react";
import { cn } from "../lib/utils";

// ── Types ──

export interface ToolCall {
    id: string;
    toolName: string;
    input?: any;
    output?: any;
    status: "running" | "complete" | "error";
}

// ── Format Helper ──

export function formatToolCall(tc: ToolCall): { icon: string; label: string; description: string; badge: string | null } {
    const input = tc.input || {};
    const output = tc.output || {};

    const shortPath = (p: string) => {
        if (!p) return "";
        const parts = p.replace(/\\/g, "/").split("/");
        return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : p;
    };

    switch (tc.toolName) {
        case "readFile":
            return {
                icon: "📄",
                label: "Read",
                description: shortPath(input.path || ""),
                badge: output.lines ? `${output.lines} lines` : output.error ? "failed" : null,
            };
        case "writeFile":
            return {
                icon: "✏️",
                label: "Wrote",
                description: shortPath(input.path || ""),
                badge: output.lines ? `${output.lines} lines` : output.error ? "failed" : null,
            };
        case "listDirectory":
            return {
                icon: "📂",
                label: "Listed",
                description: shortPath(input.path || "."),
                badge: output.count != null ? `${output.count} entries` : output.error ? "failed" : null,
            };
        case "deleteFile":
            return {
                icon: "🗑️",
                label: "Deleted",
                description: shortPath(input.path || ""),
                badge: output.status === "deleted" ? (output.type || "done") : output.error ? "failed" : null,
            };
        case "runCommand": {
            const cmd = input.command || "";
            const shortCmd = cmd.length > 50 ? cmd.slice(0, 47) + "…" : cmd;
            const exitCode = output.exitCode;
            return {
                icon: "⚡",
                label: "Ran",
                description: shortCmd,
                badge: exitCode != null ? (exitCode === 0 ? "success" : `exit ${exitCode}`) : null,
            };
        }
        case "fetchUrl": {
            let hostname = "";
            try { hostname = input.url ? new URL(input.url).hostname : "(no URL)"; } catch { hostname = input.url || "(invalid URL)"; }
            return {
                icon: "🌐",
                label: "Fetched",
                description: hostname,
                badge: output.error ? "failed" : output.truncated ? "truncated" : output.content ? null : "empty",
            };
        }
        case "webSearch":
            return {
                icon: "🔍",
                label: "Searched",
                description: input.query || "(empty query)",
                badge: output.error
                    ? "failed"
                    : output.results?.length != null
                        ? `${output.results.length} results`
                        : null,
            };
        case "systemInfo":
            return {
                icon: "💻",
                label: "System Info",
                description: input.detail === "full" ? "detailed" : "summary",
                badge: null,
            };
        case "deepResearch":
            return {
                icon: "🔬",
                label: "Deep Research",
                description: input.topic ? (input.topic.length > 50 ? input.topic.slice(0, 47) + "…" : input.topic) : "",
                badge: output.sourcesRead != null
                    ? `${output.sourcesRead}/${output.sourcesSearched || "?"} sources`
                    : output.error ? "failed" : null,
            };
        case "notifyUser":
            return {
                icon: "🔔",
                label: "Notified",
                description: input.title || input.message?.slice(0, 50) || "",
                badge: output.status === "sent" ? "sent" : output.error ? "failed" : null,
            };
        case "editFile":
            return {
                icon: "✂️",
                label: "Edited",
                description: shortPath(input.path || ""),
                badge: output.replacements != null ? `${output.replacements} change${output.replacements !== 1 ? "s" : ""}` : output.error ? "failed" : null,
            };
        case "searchFiles":
            return {
                icon: "🔎",
                label: "Searched files",
                description: input.pattern || input.query || "",
                badge: output.totalMatches != null ? `${output.totalMatches} matches` : output.error ? "failed" : null,
            };
        default:
            return {
                icon: "⚙️",
                label: tc.toolName,
                description: "",
                badge: null,
            };
    }
}

// ── Human-Friendly Tool Details ──

function renderToolDetails(tc: ToolCall): React.ReactNode {
    const input = tc.input || {};
    const output = tc.output || {};

    const shortPath = (p: string, maxLen = 60) => {
        if (!p) return "";
        const parts = p.replace(/\\/g, "/").split("/");
        const short = parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : p;
        return short.length > maxLen ? "..." + short.slice(-maxLen) : short;
    };

    const DetailRow = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
        <div className="flex gap-2 text-[10px] leading-relaxed">
            <span className="text-text-muted shrink-0 w-14">{label}</span>
            <span className={cn("text-text-secondary flex-1 break-all", mono && "font-mono text-[9px]")}>{value}</span>
        </div>
    );

    switch (tc.toolName) {
        case "readFile":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Path" value={shortPath(input.path || "")} mono />
                    {output.lines && <DetailRow label="Lines" value={`${output.lines} lines read`} />}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                    {output.content && (
                        <div className="mt-1">
                            <pre className="font-mono text-[9px] leading-relaxed text-text-muted bg-black/10 px-2 py-1 max-h-[100px] overflow-y-auto whitespace-pre-wrap">
                                {typeof output.content === "string" ? output.content.slice(0, 400) : ""}
                                {typeof output.content === "string" && output.content.length > 400 ? "\n..." : ""}
                            </pre>
                        </div>
                    )}
                </div>
            );

        case "writeFile":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Path" value={shortPath(input.path || "")} mono />
                    {output.lines && <DetailRow label="Written" value={`${output.lines} lines`} />}
                    {output.status && <DetailRow label="Status" value={output.status} />}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "listDirectory":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Path" value={shortPath(input.path || ".")} mono />
                    {output.count != null && <DetailRow label="Entries" value={`${output.count} items`} />}
                    {output.entries && Array.isArray(output.entries) && (
                        <div className="mt-1 text-[9px] text-text-muted font-mono pl-1 max-h-[80px] overflow-y-auto">
                            {output.entries.slice(0, 15).map((e: any, i: number) => (
                                <div key={i} className="truncate">{typeof e === "string" ? e : e.name || e}</div>
                            ))}
                            {output.entries.length > 15 && <div className="text-text-muted">...and {output.entries.length - 15} more</div>}
                        </div>
                    )}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "deleteFile":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Path" value={shortPath(input.path || "")} mono />
                    {output.status && <DetailRow label="Status" value={output.status === "deleted" ? "✓ Deleted" : output.status} />}
                    {output.type && <DetailRow label="Type" value={output.type} />}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "runCommand": {
            const stdout = output.stdout || output.output || "";
            const stderr = output.stderr || "";
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Cmd" value={input.command || ""} mono />
                    {input.cwd && <DetailRow label="Dir" value={shortPath(input.cwd)} mono />}
                    {output.exitCode != null && (
                        <DetailRow label="Exit" value={output.exitCode === 0 ? "✓ Success (0)" : `✗ Code ${output.exitCode}`} />
                    )}
                    {stdout && (
                        <div className="mt-1">
                            <pre className="font-mono text-[9px] leading-relaxed text-text-secondary bg-black/10 rounded px-2 py-1 max-h-[100px] overflow-y-auto whitespace-pre-wrap">
                                {typeof stdout === "string" ? stdout.slice(0, 500) : JSON.stringify(stdout).slice(0, 500)}
                            </pre>
                        </div>
                    )}
                    {stderr && (
                        <div className="mt-0.5">
                            <pre className="font-mono text-[9px] leading-relaxed text-danger/70 bg-danger/5 px-2 py-1 max-h-[60px] overflow-y-auto whitespace-pre-wrap">
                                {typeof stderr === "string" ? stderr.slice(0, 300) : ""}
                            </pre>
                        </div>
                    )}
                </div>
            );
        }

        case "webSearch":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Query" value={input.query || ""} />
                    {output.results && Array.isArray(output.results) && output.results.length > 0 ? (
                        <div className="mt-1 flex flex-col gap-1">
                            {output.results.map((r: any, i: number) => (
                                <div key={i} className="text-[9px] pl-1 border-l-2 border-accent/20">
                                    <div className="text-text-secondary font-medium truncate">{r.title}</div>
                                    {r.url && <div className="text-accent/60 font-mono truncate">{r.url}</div>}
                                    {r.snippet && <div className="text-text-muted line-clamp-1">{r.snippet}</div>}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <DetailRow label="Result" value={output.message || "No results"} />
                    )}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "fetchUrl":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="URL" value={input.url || ""} mono />
                    {output.title && <DetailRow label="Title" value={output.title} />}
                    {output.contentType && <DetailRow label="Type" value={output.contentType} />}
                    {output.truncated && <DetailRow label="Note" value="Content was truncated (>8KB)" />}
                    {output.content && (
                        <div className="mt-1">
                            <pre className="font-mono text-[9px] leading-relaxed text-text-muted bg-black/10 rounded px-2 py-1 max-h-[80px] overflow-y-auto whitespace-pre-wrap">
                                {typeof output.content === "string" ? output.content.slice(0, 400) : ""}
                            </pre>
                        </div>
                    )}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "systemInfo":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Detail" value={input.detail === "full" ? "Full system info" : "Summary"} />
                    {output.os && <DetailRow label="OS" value={`${output.os} ${output.arch || ""}`} />}
                    {output.cpus != null && <DetailRow label="CPUs" value={String(output.cpus)} />}
                    {output.memory && <DetailRow label="Memory" value={output.memory} />}
                    {output.disk && <DetailRow label="Disk" value={output.disk} />}
                </div>
            );

        case "deepResearch": {
            const sources = output.sources || [];
            const successSources = sources.filter((s: any) => s.readSuccess);
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Topic" value={input.topic || ""} />
                    <DetailRow label="Depth" value={input.depth || "thorough"} />
                    {output.sourcesSearched != null && (
                        <DetailRow label="Sources" value={`${output.sourcesRead || 0} read / ${output.sourcesSearched} found`} />
                    )}
                    {successSources.length > 0 && (
                        <div className="mt-1 flex flex-col gap-1">
                            {successSources.slice(0, 6).map((s: any, i: number) => (
                                <div key={i} className="text-[9px] pl-1 border-l-2 border-accent/20">
                                    <div className="text-text-secondary font-medium truncate">
                                        [{i + 1}] {s.title}
                                    </div>
                                    {s.url && <div className="text-accent/60 font-mono truncate">{s.url}</div>}
                                    {s.snippet && <div className="text-text-muted line-clamp-1">{s.snippet}</div>}
                                </div>
                            ))}
                            {successSources.length > 6 && (
                                <div className="text-[9px] text-text-muted pl-1">
                                    ...and {successSources.length - 6} more sources
                                </div>
                            )}
                        </div>
                    )}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );
        }

        case "notifyUser":
            return (
                <div className="flex flex-col gap-0.5">
                    {input.title && <DetailRow label="Title" value={input.title} />}
                    <DetailRow label="Message" value={input.message || input.body || ""} />
                    {input.urgency && <DetailRow label="Urgency" value={input.urgency} />}
                    {output.status && <DetailRow label="Status" value={output.status === "sent" ? "✓ Sent" : output.status} />}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "editFile":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Path" value={shortPath(input.path || "")} mono />
                    {input.find && <DetailRow label="Find" value={typeof input.find === "string" ? input.find.slice(0, 100) : ""} mono />}
                    {output.replacements != null && <DetailRow label="Changes" value={`${output.replacements} replacement${output.replacements !== 1 ? "s" : ""}`} />}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        case "searchFiles":
            return (
                <div className="flex flex-col gap-0.5">
                    <DetailRow label="Pattern" value={input.pattern || input.query || ""} mono />
                    {input.path && <DetailRow label="In" value={shortPath(input.path)} mono />}
                    {output.totalMatches != null && <DetailRow label="Matches" value={`${output.totalMatches} in ${output.filesMatched || "?"} files`} />}
                    {output.matches && Array.isArray(output.matches) && output.matches.length > 0 && (
                        <div className="mt-1 text-[9px] text-text-muted font-mono pl-1 max-h-[80px] overflow-y-auto">
                            {output.matches.slice(0, 8).map((m: any, i: number) => (
                                <div key={i} className="truncate">{shortPath(m.file || m.path || "", 40)}:{m.line || ""}</div>
                            ))}
                            {output.matches.length > 8 && <div>...and {output.matches.length - 8} more</div>}
                        </div>
                    )}
                    {output.error && <DetailRow label="Error" value={output.error} />}
                </div>
            );

        default:
            // Fallback for unknown tools — show raw JSON
            return (
                <div className="flex flex-col gap-1">
                    {tc.input && (
                        <div>
                            <div className="text-[9px] text-text-muted mb-0.5">Input</div>
                            <pre className="font-mono text-[9px] leading-relaxed text-text-secondary bg-black/10 px-2 py-1 max-h-[80px] overflow-y-auto whitespace-pre-wrap break-all">
                                {JSON.stringify(tc.input, null, 2)}
                            </pre>
                        </div>
                    )}
                    {tc.output && (
                        <div>
                            <div className="text-[9px] text-text-muted mb-0.5">Output</div>
                            <pre className="font-mono text-[9px] leading-relaxed text-text-secondary bg-black/10 px-2 py-1 max-h-[80px] overflow-y-auto whitespace-pre-wrap break-all">
                                {typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output, null, 2).slice(0, 500)}
                            </pre>
                        </div>
                    )}
                </div>
            );
    }
}

// ── ToolCallRow Component ──

export function ToolCallRow({
    tc,
    isExpanded,
    onToggle,
}: {
    tc: ToolCall;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const { icon, label, description, badge } = formatToolCall(tc);

    return (
        <div>
            <div
                className="flex items-center gap-2 py-1 px-1 cursor-pointer select-none group hover:bg-surface-card transition-colors"
                onClick={onToggle}
            >
                <span className="text-[10px] text-text-muted w-3.5 shrink-0 text-center transition-transform" style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}>▸</span>
                <span className={cn("w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[10px]",
                    tc.status === "running" ? "text-accent" : tc.status === "complete" ? "text-ok" : "text-danger"
                )}>
                    {tc.status === "running" ? <span className="inline-block w-3 h-3 border-2 border-transparent border-t-accent rounded-full animate-spin" /> : icon}
                </span>
                <span className="text-[11px] font-mono font-medium text-text-primary">{label}</span>
                <span className="text-[10px] font-mono text-text-tertiary truncate flex-1">{description}</span>
                {badge && <span className="text-[9px] font-mono text-text-muted shrink-0 tabular-nums uppercase">{badge}</span>}
            </div>
            {isExpanded && (tc.input || tc.output) && (
                <div className="ml-9 mr-2 mb-1 mt-0.5">
                    {renderToolDetails(tc)}
                </div>
            )}
        </div>
    );
}
