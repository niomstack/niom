/**
 * Card — HUD glass card primitive.
 * Reusable card component with glass overlay, edge glow, and corner accents.
 */

import { cn } from "@/lib/utils";

interface CardProps {
    /** Top-left ID label (e.g. "NX-0042") */
    id?: string;
    /** Card title */
    title: string;
    /** Short subtitle (shown on hover) */
    subtitle?: string;
    /** Description text (shown on hover) */
    description?: string;
    /** Additional className */
    className?: string;
    /** Click handler */
    onClick?: () => void;
    /** Children override — if provided, replaces default content layout */
    children?: React.ReactNode;
}

function Card({
    id,
    title,
    subtitle,
    description,
    className,
    onClick,
    children,
}: CardProps) {
    return (
        <div
            className={cn(
                "card group relative flex flex-col cursor-pointer",
                "min-h-[140px]",
                "border border-[rgba(91,63,230,0.08)]",
                "transition-all duration-400 ease-out",
                "hover:bg-[rgba(91,63,230,0.15)] hover:border-[rgba(91,63,230,0.3)]",
                "hover:shadow-[0_0_28px_rgba(91,63,230,0.25)]",
                "hover:scale-[1.03]",
                "overflow-hidden",
                className
            )}
            onClick={onClick}
        >
            {/* Frosty glass overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.08] via-white/[0.02] to-transparent pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-br from-[rgba(91,63,230,0.03)] via-transparent to-[rgba(91,63,230,0.02)] pointer-events-none" />
            <div className="absolute inset-px border border-white/[0.04] pointer-events-none" />

            {/* Edge glow on hover */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(91,63,230,0.6)] to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[rgba(91,63,230,0.25)] to-transparent" />
                <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-[rgba(91,63,230,0.25)] to-transparent" />
                <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[rgba(91,63,230,0.25)] to-transparent" />
            </div>

            {/* Content */}
            {children ? (
                <div className="relative flex flex-col h-full p-3.5">
                    {children}
                </div>
            ) : (
                <div className="relative flex flex-col h-full p-3.5">
                    {id && (
                        <span className="text-[9px] font-mono text-[rgba(91,63,230,0.4)] uppercase tracking-[0.2em] mb-1 group-hover:text-[rgba(91,63,230,0.7)] transition-colors">
                            {id}
                        </span>
                    )}
                    <h3 className="text-[12px] font-semibold text-text-primary/80 leading-tight tracking-wide uppercase group-hover:text-text-primary transition-colors">
                        {title}
                    </h3>

                    {subtitle && (
                        <span className="text-[9px] text-text-secondary/80 mt-1.5 leading-snug block opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            {subtitle}
                        </span>
                    )}

                    <div className="flex-1 min-h-2" />

                    {description && (
                        <>
                            <div className="h-px bg-[rgba(91,63,230,0.1)] mb-1.5 group-hover:bg-[rgba(91,63,230,0.25)] opacity-0 group-hover:opacity-100 transition-all duration-300" />
                            <p className="text-[8px] text-text-secondary/60 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                {description}
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* Corner accents */}
            <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-transparent group-hover:border-[rgba(91,63,230,0.5)] transition-colors duration-300" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-transparent group-hover:border-[rgba(91,63,230,0.5)] transition-colors duration-300" />
        </div>
    );
}

export { Card };
export type { CardProps };
