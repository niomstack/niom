/**
 * SkillTreeMarketplace — Browse & install community skills from Skills.sh and MCP Registry.
 */

import { useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
    Search, Package, Plug, Download, Loader2, Globe, Zap,
    CheckCircle, XCircle, SkipForward,
} from "lucide-react";
import type { MarketplaceResult, InstallStepInfo } from "./types";

// ── Result Card (stable, top-level — must NOT be defined inside the parent component) ──

function ResultCard({
    result, installing, onInstall,
}: {
    result: MarketplaceResult;
    installing: string | null;
    onInstall: (r: MarketplaceResult) => void;
}) {
    return (
        <div
            className="p-3 border border-border-subtle hover:border-accent/15
                hover:bg-surface-card-hover transition-all group"
        >
            <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                    <span className={`text-[8px] uppercase px-1.5 py-0.5 font-medium
                        ${result.source === "skills.sh"
                            ? "bg-accent/10 text-accent"
                            : "bg-info/10 text-info"
                        }`}
                    >
                        {result.source === "skills.sh" ? "SKILL" : "MCP"}
                    </span>
                    <span className="text-xs font-medium text-text-primary">
                        {result.name}
                    </span>
                </div>
                {result.installed ? (
                    <span className="text-[9px] text-ok flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5" /> Installed
                    </span>
                ) : (
                    <button
                        onClick={() => onInstall(result)}
                        disabled={installing !== null}
                        className="text-[9px] px-2.5 py-1 bg-accent/10 text-accent
                            hover:bg-accent/20 transition-all flex items-center gap-1
                            border border-accent/15 disabled:opacity-50"
                    >
                        {installing === result.id ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                            <Download className="w-2.5 h-2.5" />
                        )}
                        Install
                    </button>
                )}
            </div>
            <p className="text-[10px] text-text-secondary line-clamp-2">
                {result.description || "No description available."}
            </p>
            {(result.author || result.installs) && (
                <div className="flex gap-3 mt-1.5 text-[9px] text-text-muted">
                    {result.author && <span>by {result.author}</span>}
                    {result.installs ? <span>{result.installs.toLocaleString()} installs</span> : null}
                </div>
            )}
        </div>
    );
}

// ── Marketplace Component ──

interface SkillTreeMarketplaceProps {
    sidecarUrl: string;
    onInstallComplete: () => void;
}

export function SkillTreeMarketplace({ sidecarUrl, onInstallComplete }: SkillTreeMarketplaceProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<MarketplaceResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [installing, setInstalling] = useState<string | null>(null);
    const [installSteps, setInstallSteps] = useState<InstallStepInfo[]>([]);
    const [installError, setInstallError] = useState<string | null>(null);
    const [featuredResults, setFeaturedResults] = useState<MarketplaceResult[]>([]);
    const [loadingFeatured, setLoadingFeatured] = useState(false);

    // ── Search ──

    const searchMarketplace = useCallback(async (q: string) => {
        if (q.length < 2) {
            setSearchResults([]);
            return;
        }
        setSearching(true);
        try {
            const res = await fetch(`${sidecarUrl}/api/skills/marketplace/search?q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data.results || []);
            }
        } catch (err) {
            console.warn("[marketplace] Search failed:", err);
        } finally {
            setSearching(false);
        }
    }, [sidecarUrl]);

    // Debounced search
    useEffect(() => {
        if (searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }
        const timer = setTimeout(() => searchMarketplace(searchQuery), 400);
        return () => clearTimeout(timer);
    }, [searchQuery, searchMarketplace]);

    // Fetch featured on mount
    useEffect(() => {
        if (featuredResults.length > 0) return;
        setLoadingFeatured(true);
        fetch(`${sidecarUrl}/api/skills/marketplace/featured`)
            .then(res => res.ok ? res.json() : { results: [] })
            .then(data => setFeaturedResults(data.results || []))
            .catch(() => { })
            .finally(() => setLoadingFeatured(false));
    }, [sidecarUrl, featuredResults.length]);

    // ── Install ──

    const installSkill = useCallback(async (result: MarketplaceResult) => {
        setInstalling(result.id);
        setInstallSteps([{ step: "Connecting", status: "running", detail: `Downloading ${result.name}...` }]);
        setInstallError(null);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const res = await fetch(`${sidecarUrl}/api/skills/marketplace/install`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source: result.source, identifier: result.identifier }),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            let data: any;
            try {
                data = await res.json();
            } catch {
                setInstallError(`Server returned invalid response (HTTP ${res.status})`);
                return;
            }

            if (data.steps) setInstallSteps(data.steps);
            if (data.success) {
                try { onInstallComplete(); } catch { /* ignore */ }
                setSearchResults(prev => prev.map(r =>
                    r.id === result.id ? { ...r, installed: true } : r
                ));
                setFeaturedResults(prev => prev.map(r =>
                    r.id === result.id ? { ...r, installed: true } : r
                ));
            } else {
                setInstallError(data.error || data.message || "Installation failed");
            }
        } catch (err: any) {
            if (err?.name === "AbortError") {
                setInstallError("Install request timed out (30s). The server may still be processing.");
            } else {
                setInstallError(String(err?.message || err));
            }
        } finally {
            setTimeout(() => { setInstalling(null); setInstallSteps([]); setInstallError(null); }, 4000);
        }
    }, [sidecarUrl, onInstallComplete]);

    // Active results
    const activeResults = searchQuery.length >= 2 ? searchResults : [];

    return (
        <div className="h-full flex flex-col p-4">
            {/* Search */}
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Skills.sh & MCP Registry..."
                    className="w-full pl-9 pr-4 py-2 bg-surface-card border border-border-subtle
                        text-xs text-text-primary placeholder:text-text-muted
                        focus:border-accent/30 focus:outline-none transition-all"
                />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted animate-spin" />}
            </div>

            {/* Source badges */}
            <div className="flex gap-2 mb-3 text-[9px]">
                <span className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent border border-accent/15">
                    <Package className="w-2.5 h-2.5" /> Skills.sh
                </span>
                <span className="flex items-center gap-1 px-2 py-0.5 bg-info/10 text-info border border-info/15">
                    <Plug className="w-2.5 h-2.5" /> MCP Registry
                </span>
            </div>

            {/* Install Progress */}
            <AnimatePresence>
                {installing && installSteps.length > 0 && (
                    <motion.div
                        key="install-progress"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mb-3 border border-accent/15 bg-accent/[0.03] overflow-hidden"
                    >
                        <div className="p-3">
                            <p className="text-[10px] uppercase tracking-wider text-accent mb-2 font-medium">
                                Installing...
                            </p>
                            <div className="space-y-1.5">
                                {installSteps.map((step, idx) => (
                                    <div key={`${step.step}-${idx}`} className="flex items-center gap-2 text-[10px]">
                                        {step.status === "running" && <Loader2 className="w-3 h-3 text-accent animate-spin shrink-0" />}
                                        {step.status === "done" && <CheckCircle className="w-3 h-3 text-ok shrink-0" />}
                                        {step.status === "failed" && <XCircle className="w-3 h-3 text-danger shrink-0" />}
                                        {step.status === "skipped" && <SkipForward className="w-3 h-3 text-text-muted shrink-0" />}
                                        {step.status === "pending" && <div className="w-3 h-3 border border-border-subtle rounded-full shrink-0" />}
                                        <span className="text-text-secondary font-medium">{step.step}</span>
                                        {step.detail && <span className="text-text-muted truncate">{step.detail}</span>}
                                    </div>
                                ))}
                            </div>
                            {installError && (
                                <div className="mt-2 p-2 bg-danger/10 border border-danger/20 text-[10px] text-danger">
                                    {installError}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Results */}
            <div className="flex-1 overflow-y-auto overlay-scrollbar space-y-2">
                {activeResults.length === 0 && searchQuery.length >= 2 && !searching && (
                    <div className="text-center py-8 text-text-muted text-xs">
                        No results found for &quot;{searchQuery}&quot;
                    </div>
                )}
                {activeResults.length === 0 && searchQuery.length < 2 && (
                    <>
                        {loadingFeatured ? (
                            <div className="flex flex-col items-center py-12 text-text-muted">
                                <Loader2 className="w-6 h-6 mb-3 animate-spin opacity-30" />
                                <p className="text-[10px]">Loading featured skills...</p>
                            </div>
                        ) : featuredResults.length > 0 ? (
                            <>
                                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2 font-medium">
                                    Featured &middot; {featuredResults.length} skills
                                </p>
                                {featuredResults.map(result => (
                                    <ResultCard
                                        key={result.id}
                                        result={result}
                                        installing={installing}
                                        onInstall={installSkill}
                                    />
                                ))}
                            </>
                        ) : (
                            <div className="flex flex-col items-center py-12 text-text-muted">
                                <Globe className="w-10 h-10 mb-3 opacity-15" />
                                <p className="text-xs">Search for community skills</p>
                                <p className="text-[10px] mt-1">
                                    Powered by Skills.sh + MCP Registry
                                </p>
                            </div>
                        )}
                    </>
                )}
                {activeResults.map(result => (
                    <ResultCard
                        key={result.id}
                        result={result}
                        installing={installing}
                        onInstall={installSkill}
                    />
                ))}
            </div>
        </div>
    );
}
