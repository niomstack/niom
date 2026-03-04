/**
 * Settings shared types and sub-components.
 *
 * Used by all three settings sections (Models, Memory, About).
 */

import { cn } from "../../../lib/utils";
import {
    Item,
    ItemContent,
    ItemTitle,
    ItemDescription,
    ItemMedia,
} from "../../ui/item";

// ── Types ──

export interface BrainData {
    facts: string[];
    preferences: Record<string, string>;
    patterns: string[];
    updatedAt: number;
}

export interface SidecarStatus {
    model: string | null;
    provider: string | null;
    workspace: string | null;
    version: string;
    status: "online" | "offline";
}

// ── Sub-components ──

export function SectionHeader({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-3 mb-3 mt-1">
            <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-[0.25em]">
                {title}
            </span>
            <div className="h-px flex-1 bg-border-subtle opacity-20" />
        </div>
    );
}

export function SettingRow({
    icon,
    title,
    description,
    action,
    onClick,
    danger,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    action?: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
}) {
    return (
        <Item
            variant="default"
            size="sm"
            className={cn(
                "cursor-pointer",
                danger
                    ? "hover:bg-red-500/5 hover:border-red-500/20"
                    : "hover:bg-[rgba(91,63,230,0.04)]"
            )}
            onClick={onClick}
        >
            <ItemMedia variant="icon" className={cn(
                "size-7",
                danger
                    ? "border-red-500/20 bg-red-500/8"
                    : "border-[rgba(91,63,230,0.12)] bg-[rgba(91,63,230,0.06)]"
            )}>
                {icon}
            </ItemMedia>
            <ItemContent>
                <ItemTitle className={cn("text-[11px]", danger && "text-red-400")}>{title}</ItemTitle>
                <ItemDescription className="text-[10px] text-text-tertiary">
                    {description}
                </ItemDescription>
            </ItemContent>
            {action && <div className="shrink-0">{action}</div>}
        </Item>
    );
}
