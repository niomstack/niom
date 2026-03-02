/**
 * Orb — The central NIOM visual element.
 * Ported from www/app/components/orb.tsx for the Tauri overlay.
 */

import { useId, useMemo } from "react";
import { cn } from "../lib/utils";
import "./orb.css";

/* ═══════════════════════════════════════════
   State types & color palettes
   ═══════════════════════════════════════════ */

export type OrbState = "idle" | "processing" | "error" | "warning" | "display";

interface ColorPalette {
    core: { offset: string; color: string }[];
    rim: { offset: string; color: string; opacity: number }[];
    border: { offset: string; color: string; opacity: number }[];
    glow: string;
    specHighlight: string;
}

const PALETTES: Record<OrbState, ColorPalette> = {
    idle: {
        core: [
            { offset: "0%", color: "#a78bfa" },
            { offset: "35%", color: "#5B3FE6" },
            { offset: "70%", color: "#1a0a4a" },
            { offset: "100%", color: "#0a0520" },
        ],
        rim: [
            { offset: "60%", color: "white", opacity: 0 },
            { offset: "80%", color: "#c4b5fd", opacity: 0.2 },
            { offset: "90%", color: "#8b5cf6", opacity: 0.35 },
            { offset: "95%", color: "#a78bfa", opacity: 0.5 },
            { offset: "100%", color: "#ffffff", opacity: 0.6 },
        ],
        border: [
            { offset: "0%", color: "#a78bfa", opacity: 0.5 },
            { offset: "30%", color: "#5B3FE6", opacity: 0.8 },
            { offset: "60%", color: "#7c3aed", opacity: 0.6 },
            { offset: "100%", color: "#6d28d9", opacity: 0.4 },
        ],
        glow: "#2a1070",
        specHighlight: "#a78bfa",
    },
    processing: {
        core: [
            { offset: "0%", color: "#67e8f9" },
            { offset: "35%", color: "#06b6d4" },
            { offset: "70%", color: "#0e4f6a" },
            { offset: "100%", color: "#042f3e" },
        ],
        rim: [
            { offset: "60%", color: "white", opacity: 0 },
            { offset: "80%", color: "#a5f3fc", opacity: 0.2 },
            { offset: "90%", color: "#22d3ee", opacity: 0.35 },
            { offset: "95%", color: "#67e8f9", opacity: 0.5 },
            { offset: "100%", color: "#ffffff", opacity: 0.6 },
        ],
        border: [
            { offset: "0%", color: "#67e8f9", opacity: 0.5 },
            { offset: "30%", color: "#06b6d4", opacity: 0.8 },
            { offset: "60%", color: "#22d3ee", opacity: 0.6 },
            { offset: "100%", color: "#0891b2", opacity: 0.4 },
        ],
        glow: "#083344",
        specHighlight: "#67e8f9",
    },
    error: {
        core: [
            { offset: "0%", color: "#fca5a5" },
            { offset: "35%", color: "#ef4444" },
            { offset: "70%", color: "#6a0a0a" },
            { offset: "100%", color: "#300505" },
        ],
        rim: [
            { offset: "60%", color: "white", opacity: 0 },
            { offset: "80%", color: "#fecaca", opacity: 0.2 },
            { offset: "90%", color: "#f87171", opacity: 0.35 },
            { offset: "95%", color: "#fca5a5", opacity: 0.5 },
            { offset: "100%", color: "#ffffff", opacity: 0.6 },
        ],
        border: [
            { offset: "0%", color: "#fca5a5", opacity: 0.5 },
            { offset: "30%", color: "#ef4444", opacity: 0.8 },
            { offset: "60%", color: "#dc2626", opacity: 0.6 },
            { offset: "100%", color: "#b91c1c", opacity: 0.4 },
        ],
        glow: "#500a0a",
        specHighlight: "#fca5a5",
    },
    warning: {
        core: [
            { offset: "0%", color: "#fde68a" },
            { offset: "35%", color: "#f59e0b" },
            { offset: "70%", color: "#6a4a0a" },
            { offset: "100%", color: "#302005" },
        ],
        rim: [
            { offset: "60%", color: "white", opacity: 0 },
            { offset: "80%", color: "#fef3c7", opacity: 0.2 },
            { offset: "90%", color: "#fbbf24", opacity: 0.35 },
            { offset: "95%", color: "#fde68a", opacity: 0.5 },
            { offset: "100%", color: "#ffffff", opacity: 0.6 },
        ],
        border: [
            { offset: "0%", color: "#fde68a", opacity: 0.5 },
            { offset: "30%", color: "#f59e0b", opacity: 0.8 },
            { offset: "60%", color: "#d97706", opacity: 0.6 },
            { offset: "100%", color: "#b45309", opacity: 0.4 },
        ],
        glow: "#503a0a",
        specHighlight: "#fde68a",
    },
    display: {
        core: [
            { offset: "0%", color: "#86efac" },
            { offset: "35%", color: "#22c55e" },
            { offset: "70%", color: "#0a5a2a" },
            { offset: "100%", color: "#052e16" },
        ],
        rim: [
            { offset: "60%", color: "white", opacity: 0 },
            { offset: "80%", color: "#bbf7d0", opacity: 0.2 },
            { offset: "90%", color: "#4ade80", opacity: 0.35 },
            { offset: "95%", color: "#86efac", opacity: 0.5 },
            { offset: "100%", color: "#ffffff", opacity: 0.6 },
        ],
        border: [
            { offset: "0%", color: "#86efac", opacity: 0.5 },
            { offset: "30%", color: "#22c55e", opacity: 0.8 },
            { offset: "60%", color: "#16a34a", opacity: 0.6 },
            { offset: "100%", color: "#15803d", opacity: 0.4 },
        ],
        glow: "#0a3d1a",
        specHighlight: "#86efac",
    },
};

/* ═══════════════════════════════════════════
   Particle generation
   ═══════════════════════════════════════════ */

interface Particle {
    cx: number; cy: number; r: number;
    duration: number;
    dx1: number; dy1: number;
    dx2: number; dy2: number;
    dx3: number; dy3: number;
    delay: number;
}

function seededRandom(seed: number) {
    let s = seed;
    return () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generateParticles(count: number): Particle[] {
    const rand = seededRandom(42);
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = 10 + rand() * 75;
        particles.push({
            cx: 150 + Math.cos(angle) * dist,
            cy: 150 + Math.sin(angle) * dist,
            r: 0.3 + rand() * 0.8,
            duration: 1.5 + rand() * 3,
            dx1: -12 + rand() * 24, dy1: -12 + rand() * 24,
            dx2: -18 + rand() * 36, dy2: -18 + rand() * 36,
            dx3: -10 + rand() * 20, dy3: -10 + rand() * 20,
            delay: rand() * 2,
        });
    }
    return particles;
}

interface OrbitalParticle {
    angle: number; radius: number; r: number;
    duration: number; delay: number;
}

function generateOrbitalParticles(count: number): OrbitalParticle[] {
    const rand = seededRandom(99);
    const particles: OrbitalParticle[] = [];
    for (let i = 0; i < count; i++) {
        particles.push({
            angle: (360 / count) * i + rand() * 15,
            radius: 65 + rand() * 25,
            r: 0.3 + rand() * 0.7,
            duration: 6 + rand() * 4,
            delay: rand() * -10,
        });
    }
    return particles;
}

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

interface OrbProps {
    state?: OrbState;
    size?: string;
    className?: string;
    glowOpacity?: number;
    borderOpacity?: number;
    coreBlur?: number;
    children?: React.ReactNode;
}

export function Orb({
    state = "idle",
    size = "w-[400px] h-[400px]",
    className,
    glowOpacity = 0.12,
    borderOpacity = 0.6,
    coreBlur = 6,
    children,
}: OrbProps) {
    const uid = useId().replace(/:/g, "");
    const palette = PALETTES[state];

    const particles = useMemo(() => generateParticles(150), []);
    const orbitalParticles = useMemo(() => generateOrbitalParticles(120), []);

    const isIdle = state === "idle";
    const isProcessing = state === "processing";
    const isCube = state === "error" || state === "warning";
    const isDisplay = state === "display";

    return (
        <div className={cn("orb-container", size, className)} data-state={state}>
            <svg className="orb-svg" viewBox="0 0 300 300">
                <defs>
                    <radialGradient id={`core-${uid}`} cx="45%" cy="40%" r="55%">
                        {palette.core.map((s) => (
                            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
                        ))}
                    </radialGradient>

                    <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
                        {palette.rim.map((s) => (
                            <stop key={s.offset} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                        ))}
                    </radialGradient>

                    <radialGradient id={`spec1-${uid}`} cx="35%" cy="30%" r="35%">
                        <stop offset="0%" stopColor="white" stopOpacity="0.5" />
                        <stop offset="50%" stopColor="white" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                    </radialGradient>

                    <radialGradient id={`spec2-${uid}`} cx="70%" cy="70%" r="30%">
                        <stop offset="0%" stopColor={palette.specHighlight} stopOpacity="0.2" />
                        <stop offset="100%" stopColor={palette.specHighlight} stopOpacity="0" />
                    </radialGradient>

                    <linearGradient id={`border-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        {palette.border.map((s) => (
                            <stop key={s.offset} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                        ))}
                    </linearGradient>

                    <filter id={`blur-${uid}`}><feGaussianBlur in="SourceGraphic" stdDeviation={coreBlur} /></filter>
                    <filter id={`glow-${uid}`}><feGaussianBlur in="SourceGraphic" stdDeviation="8" /></filter>
                    <filter id={`pblur-${uid}`}><feGaussianBlur in="SourceGraphic" stdDeviation="1" /></filter>

                    <clipPath id={`clip-${uid}`}><circle cx="150" cy="150" r="100" /></clipPath>
                </defs>

                {/* Outer glow */}
                <circle className="orb-glow" cx="150" cy="150" r="100" fill={palette.glow} opacity={glowOpacity} filter={`url(#glow-${uid})`} />

                {/* Inner shapes */}
                <g clipPath={`url(#clip-${uid})`}>
                    <ellipse className="orb-blob orb-state-layer" cx="145" cy="148" rx="90" ry="85" fill={`url(#core-${uid})`} filter={`url(#blur-${uid})`} opacity={isIdle ? 1 : 0} />
                    <g className="orb-state-layer" opacity={isProcessing ? 1 : 0} filter={`url(#pblur-${uid})`}>
                        {particles.map((p, i) => (
                            <circle key={i} className="orb-particle" cx={p.cx} cy={p.cy} r={p.r} fill={palette.core[1].color}
                                style={{ animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`, "--dx1": `${p.dx1}px`, "--dy1": `${p.dy1}px`, "--dx2": `${p.dx2}px`, "--dy2": `${p.dy2}px`, "--dx3": `${p.dx3}px`, "--dy3": `${p.dy3}px` } as React.CSSProperties}
                            />
                        ))}
                    </g>
                </g>

                {/* Glass rim + border + specular */}
                <circle cx="150" cy="150" r="100" fill={`url(#rim-${uid})`} />
                <circle className="orb-border" cx="150" cy="150" r="100" fill="none" stroke={`url(#border-${uid})`} strokeWidth="1" opacity={borderOpacity} />
                <circle cx="150" cy="150" r="100" fill={`url(#spec1-${uid})`} />
                <circle cx="150" cy="150" r="100" fill={`url(#spec2-${uid})`} />
            </svg>

            {/* 3D Cube (error/warning) */}
            <div className="orb-state-layer" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: isCube ? 1 : 0, clipPath: "circle(33% at center)", perspective: "400px" }}>
                <div className="orb-cube-3d" style={{ "--cube-color": palette.core[1].color } as React.CSSProperties}>
                    <div className="orb-cube-face orb-cube-front" />
                    <div className="orb-cube-face orb-cube-back" />
                    <div className="orb-cube-face orb-cube-left" />
                    <div className="orb-cube-face orb-cube-right" />
                    <div className="orb-cube-face orb-cube-top" />
                    <div className="orb-cube-face orb-cube-bottom" />
                </div>
            </div>

            {/* Display: orbital particles */}
            <div className="orb-state-layer" style={{ position: "absolute", inset: 0, opacity: isDisplay ? 1 : 0 }}>
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 300">
                    <g filter={`url(#pblur-${uid})`}>
                        {orbitalParticles.map((p, i) => (
                            <circle key={i} className="orb-orbital" cx="150" cy="150" r={p.r} fill={palette.core[1].color}
                                style={{ "--orbit-radius": `${p.radius}px`, "--orbit-start": `${p.angle}deg`, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` } as React.CSSProperties}
                            />
                        ))}
                    </g>
                </svg>
            </div>

            {/* Children content overlay (display state) */}
            {children && (
                <div className="orb-state-layer absolute inset-0 z-10 flex items-center justify-center" style={{ opacity: isDisplay ? 1 : 0, clipPath: "circle(33% at center)", pointerEvents: "none" }}>
                    {children}
                </div>
            )}
        </div>
    );
}
