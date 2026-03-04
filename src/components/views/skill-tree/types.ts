/**
 * Shared types and constants for the Skill Tree feature.
 */

import React from "react";
import {
    Code2,
    Microscope,
    Briefcase,
    Palette,
    User,
    Globe,
} from "lucide-react";

// ── Types ──

export interface GraphNode {
    id: string;
    name: string;
    type: "root" | "domain" | "tool";
    description: string;
    parents: string[];
    children: string[];
    enabled: boolean;
    usageCount: number;
    lastUsed: number;
    packId?: string;
    toolName?: string;
}

export interface GraphEdge {
    from: string;
    to: string;
    type: "hierarchy" | "semantic" | "cooccurrence" | "pipeline";
    weight: number;
    reinforcements: number;
}

export interface SkillPack {
    id: string;
    name: string;
    description: string;
    domain: string;
    toolIds: string[];
    enabled: boolean;
    source: string;
    toolCount: number;
}

export interface MarketplaceResult {
    id: string;
    name: string;
    description: string;
    source: "skills.sh" | "mcp";
    identifier: string;
    installs?: number;
    author?: string;
    installed: boolean;
}

export interface InstalledSkill {
    id: string;
    name: string;
    description: string;
    domain: string;
    source: string;
    installedAt: string;
    identifier: string;
}

export interface InstallStepInfo {
    step: string;
    status: "pending" | "running" | "done" | "skipped" | "failed";
    detail?: string;
}

export interface TreeStats {
    ready: boolean;
    nodes: number;
    edges: number;
}

// ── Layout Node (with physics) ──

export type LayoutNode = GraphNode & {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    expanded: boolean;
    visible: boolean;
};

// ── Domain Colors & Icons ──

export const DOMAIN_COLORS: Record<string, string> = {
    code: "#5B3FE6",
    research: "#3b82f6",
    business: "#f59e0b",
    creative: "#ec4899",
    personal: "#10b981",
    general: "#6b7280",
};

/**
 * Returns a fresh icon element for the given domain.
 * Using a function instead of a static map avoids React's
 * "same element rendered in multiple places" crash.
 */
export function getDomainIcon(domain: string): React.ReactNode {
    switch (domain) {
        case "code": return React.createElement(Code2, { className: "w-4 h-4" });
        case "research": return React.createElement(Microscope, { className: "w-4 h-4" });
        case "business": return React.createElement(Briefcase, { className: "w-4 h-4" });
        case "creative": return React.createElement(Palette, { className: "w-4 h-4" });
        case "personal": return React.createElement(User, { className: "w-4 h-4" });
        case "general": return React.createElement(Globe, { className: "w-4 h-4" });
        default: return null;
    }
}

// ── Helpers ──

export function drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const hx = x + radius * Math.cos(angle);
        const hy = y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
}

export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}
