/**
 * SkillTreeView.tsx — Main orchestrator for the Skill Tree feature.
 * 
 * Sub-components:
 *   - SkillTreeCanvas   — Force-directed graph visualization
 *   - SkillTreeMarketplace — Browse & install community skills
 *   - SkillTreeInstalled   — View installed packs and skills
 */

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
    TreePine, X, Power, Layers, Package, Download,
    Loader2, Activity, ArrowLeft,
} from "lucide-react";
import { useConfig } from "../../lib/useConfig";
import { SkillTreeCanvas } from "./skill-tree/SkillTreeCanvas";
import { SkillTreeMarketplace } from "./skill-tree/SkillTreeMarketplace";
import { SkillTreeInstalled } from "./skill-tree/SkillTreeInstalled";
import type {
    GraphNode, GraphEdge, SkillPack, InstalledSkill,
    LayoutNode, TreeStats,
} from "./skill-tree/types";
import { getDomainIcon } from "./skill-tree/types";

// ── Error Boundary (catches render crashes) ──

class SkillTreeErrorBoundary extends React.Component<
    { children: React.ReactNode; onReset?: () => void },
    { error: Error | null }
> {
    constructor(props: any) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error("[SkillTree] React crash:", error.message);
        console.error("[SkillTree] Component stack:", info.componentStack);
    }
    render() {
        if (this.state.error) {
            return (
                <div className="flex flex-col items-center justify-center h-full p-8 bg-surface-base text-center">
                    <div className="text-danger text-sm font-semibold mb-2">⚠ Skill Tree Crashed</div>
                    <pre className="text-[10px] text-text-muted bg-surface-card p-4 rounded max-w-lg overflow-auto mb-4 text-left whitespace-pre-wrap">
                        {this.state.error.message}
                        {"\n\n"}
                        {this.state.error.stack}
                    </pre>
                    <button
                        onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}
                        className="px-4 py-2 text-xs bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-all"
                    >
                        Reset & Try Again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// ── Exported wrapper ──

export function SkillTreeView(props: { onBack?: () => void }) {
    return (
        <SkillTreeErrorBoundary onReset={props.onBack}>
            <SkillTreeViewInner {...props} />
        </SkillTreeErrorBoundary>
    );
}

// ── Main Component ──

function SkillTreeViewInner({ onBack }: { onBack?: () => void }) {
    const { sidecarUrl } = useConfig();

    // Data
    const [nodes, setNodes] = useState<GraphNode[]>([]);
    const [edges, setEdges] = useState<GraphEdge[]>([]);
    const [packs, setPacks] = useState<SkillPack[]>([]);
    const [stats, setStats] = useState<TreeStats>({ ready: false, nodes: 0, edges: 0 });

    // Layout
    const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
    const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);
    const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

    // Tab
    const [tab, setTab] = useState<"tree" | "marketplace" | "installed">("tree");
    const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);

    // ── Fetch Data ──

    const fetchTreeData = useCallback(async () => {
        try {
            const [treeRes, packsRes, statsRes] = await Promise.all([
                fetch(`${sidecarUrl}/api/skills/tree`),
                fetch(`${sidecarUrl}/api/skills/packs`),
                fetch(`${sidecarUrl}/api/skills/stats`),
            ]);

            if (treeRes.ok) {
                const data = await treeRes.json();
                setNodes(data.nodes || []);
                setEdges(data.edges || []);
            }
            if (packsRes.ok) {
                const data = await packsRes.json();
                setPacks(data.packs || []);
            }
            if (statsRes.ok) {
                const data = await statsRes.json();
                setStats(data);
            }
        } catch (err) {
            console.warn("[SkillTree] Fetch failed:", err);
        }
    }, [sidecarUrl]);

    useEffect(() => {
        fetchTreeData();
    }, [fetchTreeData]);

    // ── Toggle Pack ──

    const togglePack = useCallback(async (domain: string, enabled: boolean) => {
        try {
            await fetch(`${sidecarUrl}/api/skills/${domain}/toggle`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled }),
            });
            await fetchTreeData();
        } catch (err) {
            console.error("[SkillTree] Toggle error:", err);
        }
    }, [sidecarUrl, fetchTreeData]);

    // ── Fetch Installed ──

    const fetchInstalled = useCallback(async () => {
        try {
            const res = await fetch(`${sidecarUrl}/api/skills/marketplace/installed`);
            if (res.ok) {
                const data = await res.json();
                setInstalledSkills(data.skills || []);
            }
        } catch { /* ignore */ }
    }, [sidecarUrl]);

    useEffect(() => {
        if (tab === "installed") fetchInstalled();
    }, [tab, fetchInstalled]);

    // ── Uninstall ──

    const uninstallSkill = useCallback(async (id: string) => {
        try {
            await fetch(`${sidecarUrl}/api/skills/marketplace/${encodeURIComponent(id)}`, {
                method: "DELETE",
            });
            await fetchInstalled();
            await fetchTreeData();
        } catch (err) {
            console.error("[marketplace] Uninstall failed:", err);
        }
    }, [sidecarUrl, fetchInstalled, fetchTreeData]);

    // ── Node Click Handler (from canvas) ──

    const handleNodeClick = useCallback((node: LayoutNode) => {
        if (node.type === "domain") {
            setExpandedDomains(prev => {
                const next = new Set(prev);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
            });
        }
        setSelectedNode(node);
    }, []);

    // Stable reference for install complete callback
    const handleInstallComplete = useCallback(() => {
        fetchTreeData();
        fetchInstalled();
    }, [fetchTreeData, fetchInstalled]);

    // ── Render ──

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-7 h-7 flex items-center justify-center bg-transparent border border-border-subtle/30 cursor-pointer hover:bg-[rgba(91,63,230,0.06)] hover:border-accent/30 transition-all text-text-tertiary hover:text-accent"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <TreePine className="w-4 h-4 text-accent" />
                    <span className="text-xs font-semibold tracking-wider uppercase text-text-primary">
                        Skill Tree
                    </span>
                    {stats.ready && (
                        <span className="text-[10px] text-text-tertiary ml-2">
                            {stats.nodes} nodes · {stats.edges} edges
                        </span>
                    )}
                </div>
                <div className="flex gap-1">
                    {(["tree", "marketplace", "installed"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-3 py-1 text-[10px] uppercase tracking-wider transition-all
                                ${tab === t
                                    ? "bg-accent/10 text-accent border border-accent/20"
                                    : "text-text-tertiary hover:text-text-primary hover:bg-surface-card-hover border border-transparent"
                                }`}
                        >
                            {t === "tree" && <Layers className="w-3 h-3 inline mr-1" />}
                            {t === "marketplace" && <Package className="w-3 h-3 inline mr-1" />}
                            {t === "installed" && <Download className="w-3 h-3 inline mr-1" />}
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden relative">
                <AnimatePresence mode="wait">
                    {tab === "tree" && (
                        <motion.div
                            key="tree"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full flex"
                        >
                            {/* Canvas */}
                            <SkillTreeCanvas
                                nodes={nodes}
                                edges={edges}
                                expandedDomains={expandedDomains}
                                selectedNode={selectedNode}
                                onNodeClick={handleNodeClick}
                                onDeselectNode={() => setSelectedNode(null)}
                                layoutNodes={layoutNodes}
                                setLayoutNodes={setLayoutNodes}
                            />

                            {/* Detail Panel */}
                            <AnimatePresence>
                                {selectedNode && (
                                    <motion.div
                                        initial={{ x: 200, opacity: 0 }}
                                        animate={{ x: 0, opacity: 1 }}
                                        exit={{ x: 200, opacity: 0 }}
                                        transition={{ type: "spring", damping: 25 }}
                                        className="w-64 border-l border-border-subtle bg-surface-elevated/50 p-4 overflow-y-auto"
                                    >
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                {selectedNode.type === "domain" && getDomainIcon(selectedNode.packId || "general")}
                                                <h3 className="text-sm font-semibold text-text-primary">
                                                    {selectedNode.name}
                                                </h3>
                                            </div>
                                            <button
                                                onClick={() => setSelectedNode(null)}
                                                className="text-text-muted hover:text-text-primary p-1"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>

                                        <p className="text-[11px] text-text-secondary mb-4 leading-relaxed">
                                            {selectedNode.description || "No description available."}
                                        </p>

                                        {/* Stats */}
                                        <div className="space-y-2 mb-4">
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-text-muted">Type</span>
                                                <span className="text-text-primary capitalize">{selectedNode.type}</span>
                                            </div>
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-text-muted">Usage Count</span>
                                                <span className="text-text-primary">{selectedNode.usageCount}</span>
                                            </div>
                                            {selectedNode.children.length > 0 && (
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-text-muted">Children</span>
                                                    <span className="text-text-primary">{selectedNode.children.length}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-text-muted">Status</span>
                                                <span className={selectedNode.enabled ? "text-ok" : "text-danger"}>
                                                    {selectedNode.enabled ? "Active" : "Disabled"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Toggle */}
                                        {selectedNode.type === "domain" && selectedNode.packId && (
                                            <button
                                                onClick={() => togglePack(
                                                    selectedNode.packId!,
                                                    !selectedNode.enabled,
                                                )}
                                                className={`w-full flex items-center justify-center gap-2 py-2 text-[10px]
                                                    uppercase tracking-wider transition-all border
                                                    ${selectedNode.enabled
                                                        ? "border-danger/20 text-danger hover:bg-danger/10"
                                                        : "border-ok/20 text-ok hover:bg-ok/10"
                                                    }`}
                                            >
                                                <Power className="w-3 h-3" />
                                                {selectedNode.enabled ? "Disable Pack" : "Enable Pack"}
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    )}

                    {tab === "marketplace" && (
                        <motion.div
                            key="marketplace"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="h-full"
                        >
                            <SkillTreeMarketplace
                                sidecarUrl={sidecarUrl}
                                onInstallComplete={handleInstallComplete}
                            />
                        </motion.div>
                    )}

                    {tab === "installed" && (
                        <motion.div
                            key="installed"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="h-full"
                        >
                            <SkillTreeInstalled
                                packs={packs}
                                nodes={nodes}
                                installedSkills={installedSkills}
                                onUninstall={uninstallSkill}
                                onSwitchToMarketplace={() => setTab("marketplace")}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Pack Status Bar */}
            <div className="px-4 py-2 border-t border-border-subtle flex items-center gap-3 text-[9px]">
                {packs.filter(p => p.source === "builtin").map(pack => (
                    <span
                        key={pack.id}
                        className={`flex items-center gap-1 px-2 py-0.5 transition-colors
                            ${pack.enabled ? "text-text-secondary" : "text-text-muted line-through opacity-50"}`}
                    >
                        {getDomainIcon(pack.domain)}
                        {pack.name}
                    </span>
                ))}
                <span className="ml-auto text-text-muted">
                    {stats.ready ? (
                        <span className="flex items-center gap-1">
                            <Activity className="w-2.5 h-2.5 text-ok" /> Graph Ready
                        </span>
                    ) : (
                        <span className="flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 text-warn animate-spin" /> Warming Up
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
}
