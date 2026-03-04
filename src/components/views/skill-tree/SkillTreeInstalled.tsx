/**
 * SkillTreeInstalled — View installed packs and community skills with accordion.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
    Download, ChevronDown, Layers, Trash2,
} from "lucide-react";
import type { SkillPack, InstalledSkill, GraphNode } from "./types";
import { getDomainIcon, DOMAIN_COLORS } from "./types";

interface SkillTreeInstalledProps {
    packs: SkillPack[];
    nodes: GraphNode[];
    installedSkills: InstalledSkill[];
    onUninstall: (id: string) => void;
    onSwitchToMarketplace: () => void;
}

export function SkillTreeInstalled({
    packs, nodes, installedSkills,
    onUninstall, onSwitchToMarketplace,
}: SkillTreeInstalledProps) {
    const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());

    const togglePack = (packId: string) => {
        setExpandedPacks(prev => {
            const next = new Set(prev);
            if (next.has(packId)) next.delete(packId);
            else next.add(packId);
            return next;
        });
    };

    return (
        <div className="h-full flex flex-col p-4 overflow-y-auto">
            <h3 className="text-xs font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-accent" />
                Installed Community Skills
            </h3>

            {/* Built-in Packs with Accordion */}
            <div className="mb-4">
                <p className="text-[9px] uppercase tracking-wider text-text-muted mb-2">
                    Built-in Packs
                </p>
                <div className="space-y-1">
                    {packs.filter(p => p.source === "builtin").map(pack => {
                        const isExpanded = expandedPacks.has(pack.id);
                        const tids = Array.isArray(pack.toolIds) ? pack.toolIds : [];
                        const packTools = nodes.filter(n =>
                            n.type === "tool" && tids.some(tid => n.id === tid || n.id === `tool:${tid}`)
                        );
                        const packColor = DOMAIN_COLORS[pack.domain] || "#5B3FE6";

                        return (
                            <div key={pack.id} className="border border-border-subtle">
                                {/* Header */}
                                <button
                                    onClick={() => togglePack(pack.id)}
                                    className="w-full flex items-center justify-between p-2.5
                                        hover:bg-surface-card-hover transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        {getDomainIcon(pack.domain) || <Layers className="w-3.5 h-3.5" />}
                                        <span className="text-[11px] font-medium text-text-primary">
                                            {pack.name}
                                        </span>
                                        <span className="text-[9px] text-text-muted">
                                            {pack.toolCount} tools
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${pack.enabled ? "bg-ok" : "bg-danger/50"}`} />
                                        <ChevronDown
                                            className={`w-3 h-3 text-text-muted transition-transform duration-200
                                                ${isExpanded ? "rotate-180" : ""}`}
                                        />
                                    </div>
                                </button>

                                {/* Expandable tools */}
                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="px-3 pb-2.5 pt-1 border-t border-border-subtle">
                                                {pack.description && (
                                                    <p className="text-[10px] text-text-secondary mb-2">
                                                        {pack.description}
                                                    </p>
                                                )}
                                                <div className="grid grid-cols-2 gap-1">
                                                    {packTools.map(tool => (
                                                        <div
                                                            key={tool.id}
                                                            className="flex items-center gap-1.5 px-2 py-1
                                                                text-[10px] text-text-secondary
                                                                hover:bg-surface-card transition-colors"
                                                        >
                                                            <span
                                                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                                                style={{ backgroundColor: packColor }}
                                                            />
                                                            {tool.name}
                                                        </div>
                                                    ))}
                                                    {packTools.length === 0 && (
                                                        <p className="text-[9px] text-text-muted col-span-2">No tools loaded</p>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Community Skills */}
            <div>
                <p className="text-[9px] uppercase tracking-wider text-text-muted mb-2">
                    Community
                </p>
                {installedSkills.length === 0 ? (
                    <div className="text-center py-6 text-text-muted text-[11px]">
                        No community skills installed yet.
                        <br />
                        <button
                            onClick={onSwitchToMarketplace}
                            className="mt-2 text-accent hover:underline text-[10px]"
                        >
                            Browse marketplace →
                        </button>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {installedSkills.map(skill => (
                            <div key={skill.id} className="flex items-center justify-between p-2 border border-border-subtle">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[8px] uppercase px-1 py-0.5
                                            ${skill.source === "skills.sh"
                                                ? "bg-accent/10 text-accent"
                                                : "bg-info/10 text-info"
                                            }`}
                                        >
                                            {skill.source === "skills.sh" ? "SKILL" : "MCP"}
                                        </span>
                                        <span className="text-[11px] text-text-primary">{skill.name}</span>
                                    </div>
                                    <p className="text-[9px] text-text-muted mt-0.5">{skill.description}</p>
                                </div>
                                <button
                                    onClick={() => onUninstall(skill.id)}
                                    className="text-text-muted hover:text-danger transition-colors p-1"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
