/**
 * SkillTreeCanvas — Canvas-based force-directed graph visualization.
 * Handles: d3-force layout, canvas rendering, zoom/pan, click interaction.
 */

import React, { useEffect, useCallback, useRef, useState } from "react";
import {
    forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide,
    type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";
import { TreePine } from "lucide-react";
import type { GraphNode, GraphEdge, LayoutNode } from "./types";
import { DOMAIN_COLORS, drawHexagon, hexToRgba } from "./types";

// ── Simulation types ──

type SimNode = SimulationNodeDatum & {
    id: string; nodeType: string; visible: boolean;
    radius: number; expanded: boolean;
} & GraphNode;

type SimLink = SimulationLinkDatum<SimNode>;

interface SkillTreeCanvasProps {
    nodes: GraphNode[];
    edges: GraphEdge[];
    expandedDomains: Set<string>;
    selectedNode: LayoutNode | null;
    onNodeClick: (node: LayoutNode) => void;
    onDeselectNode: () => void;
    layoutNodes: LayoutNode[];
    setLayoutNodes: React.Dispatch<React.SetStateAction<LayoutNode[]>>;
}

export function SkillTreeCanvas({
    nodes, edges, expandedDomains, selectedNode,
    onNodeClick, onDeselectNode, layoutNodes, setLayoutNodes,
}: SkillTreeCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
    const simulationRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);

    // ── Force Layout ──

    useEffect(() => {
        if (nodes.length === 0) return;
        simulationRef.current?.stop();

        const cx = canvasSize.width / 2;
        const cy = canvasSize.height / 2;
        const domainNodes = nodes.filter(nn => nn.type === "domain");
        const domainCount = domainNodes.length;
        const domainRadius = Math.min(canvasSize.width, canvasSize.height) * 0.35;

        const simNodes: SimNode[] = nodes.map((n) => {
            const isDomain = n.type === "domain";
            const isRoot = n.type === "root";
            const isTool = n.type === "tool";
            const parentExpanded = n.parents.some(p => expandedDomains.has(p));
            const visible = isRoot || isDomain || (isTool && parentExpanded);

            let x = cx, y = cy;
            if (isDomain) {
                const idx = domainNodes.indexOf(n);
                const angle = (idx / domainCount) * Math.PI * 2 - Math.PI / 2;
                x = cx + Math.cos(angle) * domainRadius;
                y = cy + Math.sin(angle) * domainRadius;
            } else if (isTool) {
                const parent = nodes.find(nn => n.parents.includes(nn.id) && nn.type === "domain");
                if (parent) {
                    const parentIdx = domainNodes.indexOf(parent);
                    const parentAngle = (parentIdx / domainCount) * Math.PI * 2 - Math.PI / 2;
                    const px = cx + Math.cos(parentAngle) * domainRadius;
                    const py = cy + Math.sin(parentAngle) * domainRadius;
                    x = px + (Math.random() - 0.5) * 80;
                    y = py + (Math.random() - 0.5) * 80;
                }
            }

            const radius = isRoot ? 30 : isDomain ? 24 : 10;

            return {
                ...n,
                x, y,
                nodeType: n.type,
                visible,
                radius,
                expanded: expandedDomains.has(n.id),
                ...(isRoot ? { fx: cx, fy: cy } : {}),
            };
        });

        const hierarchyEdges = edges.filter(e => e.type === "hierarchy");
        const simLinks: SimLink[] = hierarchyEdges.map(e => ({
            source: e.from,
            target: e.to,
        }));

        const simulation = forceSimulation<SimNode>(simNodes)
            .force("charge", forceManyBody<SimNode>()
                .strength((d) => d.nodeType === "root" ? -1800 : d.nodeType === "domain" ? -1200 : -300)
            )
            .force("link", forceLink<SimNode, SimLink>(simLinks)
                .id(d => d.id)
                .distance((link) => {
                    const s = link.source as SimNode;
                    const t = link.target as SimNode;
                    if (s.nodeType === "root" && t.nodeType === "domain") return domainRadius;
                    if (s.nodeType === "domain" && t.nodeType === "tool") return 120;
                    return 150;
                })
                .strength(0.4)
            )
            .force("x", forceX<SimNode>(cx).strength(0.03))
            .force("y", forceY<SimNode>(cy).strength(0.03))
            .force("collide", forceCollide<SimNode>().radius(d => d.radius + (d.nodeType === "tool" ? 22 : 35)))
            .alphaDecay(0.015)
            .on("tick", () => {
                const updated: LayoutNode[] = simNodes.map(sn => ({
                    ...sn,
                    x: sn.x ?? cx,
                    y: sn.y ?? cy,
                    vx: sn.vx ?? 0,
                    vy: sn.vy ?? 0,
                    radius: sn.radius,
                    expanded: sn.expanded,
                    visible: sn.visible,
                }));
                setLayoutNodes(updated);
            });

        simulationRef.current = simulation;
        return () => { simulation.stop(); };
    }, [nodes, edges, canvasSize, expandedDomains, setLayoutNodes]);

    // ── Canvas Resize ──

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setCanvasSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // ── Canvas Rendering ──

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasSize.width * dpr;
        canvas.height = canvasSize.height * dpr;
        ctx.scale(dpr, dpr);

        const W = canvasSize.width;
        const H = canvasSize.height;

        const rootStyles = getComputedStyle(document.documentElement);
        const surfaceBase = rootStyles.getPropertyValue("--color-surface-base").trim() || "#DCDAD5";
        const textPrimary = rootStyles.getPropertyValue("--color-text-primary").trim() || "#1a1a2e";
        const borderSubtle = rootStyles.getPropertyValue("--color-border-subtle").trim() || "rgba(26,26,46,0.12)";

        ctx.fillStyle = surfaceBase;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = borderSubtle;
        const gridSize = 30;
        for (let gx = gridSize; gx < W; gx += gridSize) {
            for (let gy = gridSize; gy < H; gy += gridSize) {
                ctx.beginPath();
                ctx.arc(gx, gy, 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.save();
        ctx.translate(camera.x, camera.y);
        ctx.scale(camera.scale, camera.scale);

        const visibleNodes = layoutNodes.filter(n => n.visible);
        const visibleIds = new Set(visibleNodes.map(n => n.id));
        const nodeMap = new Map(layoutNodes.map(n => [n.id, n]));

        const getNodeColor = (node: LayoutNode): string => {
            if (node.type === "root") return "#5B3FE6";
            if (node.type === "domain") return DOMAIN_COLORS[node.packId || "general"] || "#5B3FE6";
            const parentId = node.parents.find(p => p.startsWith("domain:"));
            if (parentId) {
                const parentNode = nodeMap.get(parentId);
                if (parentNode) return DOMAIN_COLORS[parentNode.packId || "general"] || "#5B3FE6";
            }
            return "#6b7280";
        };

        // Edges
        for (const edge of edges) {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to || !visibleIds.has(from.id) || !visibleIds.has(to.id)) continue;
            if (edge.type !== "hierarchy") continue;

            const color = getNodeColor(to);
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const cpx = mx - dy * 0.08;
            const cpy = my + dx * 0.08;

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.quadraticCurveTo(cpx, cpy, to.x, to.y);
            const alpha = from.type === "root" ? 0.08 : 0.15;
            ctx.strokeStyle = hexToRgba(color, alpha);
            ctx.lineWidth = from.type === "root" ? 0.8 : 1.2;
            ctx.setLineDash([]);
            ctx.stroke();
        }

        // Nodes
        for (const node of visibleNodes) {
            const color = getNodeColor(node);
            const isSelected = selectedNode?.id === node.id;

            if (node.type === "domain" || node.type === "root") {
                const glowRadius = node.radius * 2.5;
                const glow = ctx.createRadialGradient(
                    node.x, node.y, node.radius * 0.5,
                    node.x, node.y, glowRadius,
                );
                glow.addColorStop(0, hexToRgba(color, 0.1));
                glow.addColorStop(1, hexToRgba(color, 0));
                ctx.beginPath();
                ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
                ctx.fillStyle = glow;
                ctx.fill();
            }

            ctx.beginPath();
            if (node.type === "domain") {
                drawHexagon(ctx, node.x, node.y, node.radius);
            } else {
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            }

            if (!node.enabled) {
                ctx.fillStyle = hexToRgba(color, 0.04);
            } else if (isSelected) {
                ctx.fillStyle = color;
            } else if (node.type === "root" || node.type === "domain") {
                ctx.fillStyle = hexToRgba(color, 0.1);
            } else {
                ctx.fillStyle = hexToRgba(color, 0.25);
            }
            ctx.fill();

            ctx.strokeStyle = node.enabled ? hexToRgba(color, isSelected ? 0.9 : 0.45) : hexToRgba(color, 0.1);
            ctx.lineWidth = node.type === "tool" ? 1 : (isSelected ? 2.5 : 1.5);
            ctx.stroke();

            if (node.type === "root") {
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius * 0.65, 0, Math.PI * 2);
                ctx.strokeStyle = hexToRgba(color, 0.2);
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            if (!node.enabled && node.type === "domain") {
                ctx.beginPath();
                ctx.moveTo(node.x - node.radius * 0.5, node.y - node.radius * 0.5);
                ctx.lineTo(node.x + node.radius * 0.5, node.y + node.radius * 0.5);
                ctx.strokeStyle = hexToRgba("#ff3d71", 0.35);
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Labels
        for (const node of visibleNodes) {
            const color = getNodeColor(node);
            const label = node.type === "tool"
                ? (node.name.length > 14 ? node.name.slice(0, 12) + "…" : node.name)
                : node.name;

            const fontSize = node.type === "root" ? 11 : node.type === "domain" ? 10 : 8;
            const fontWeight = node.type === "tool" ? "500" : "bold";
            ctx.font = `${fontWeight} ${fontSize}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const labelY = node.y + node.radius + (node.type === "tool" ? 10 : 14);

            if (!node.enabled) {
                ctx.fillStyle = hexToRgba(color, 0.25);
            } else if (node.type === "tool") {
                ctx.fillStyle = textPrimary;
                ctx.globalAlpha = 0.6;
            } else {
                ctx.fillStyle = textPrimary;
            }
            ctx.fillText(label, node.x, labelY);
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }, [layoutNodes, edges, canvasSize, selectedNode, camera]);

    // ── Click Handler ──

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isPanningRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const mx = (screenX - camera.x) / camera.scale;
        const my = (screenY - camera.y) / camera.scale;

        const visibleNodes = layoutNodes.filter(n => n.visible);
        for (const node of visibleNodes) {
            const dx = mx - node.x;
            const dy = my - node.y;
            if (dx * dx + dy * dy < (node.radius + 4) * (node.radius + 4)) {
                onNodeClick(node);
                return;
            }
        }
        onDeselectNode();
    }, [layoutNodes, camera, onNodeClick, onDeselectNode]);

    // ── Wheel Zoom ──

    const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.stopPropagation();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        setCamera(prev => {
            const newScale = Math.max(0.15, Math.min(4, prev.scale * zoomFactor));
            const scaleChange = newScale / prev.scale;
            return {
                scale: newScale,
                x: mouseX - (mouseX - prev.x) * scaleChange,
                y: mouseY - (mouseY - prev.y) * scaleChange,
            };
        });
    }, []);

    // ── Mouse Pan ──

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        isPanningRef.current = false;
        panStartRef.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };

        const handleMouseMove = (me: MouseEvent) => {
            const dx = me.clientX - panStartRef.current.x;
            const dy = me.clientY - panStartRef.current.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                isPanningRef.current = true;
            }
            setCamera(prev => ({
                ...prev,
                x: panStartRef.current.cx + dx,
                y: panStartRef.current.cy + dy,
            }));
        };

        const handleMouseUp = () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            setTimeout(() => { isPanningRef.current = false; }, 10);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    }, [camera]);

    return (
        <div ref={containerRef} className="flex-1 relative">
            {nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
                    <TreePine className="w-12 h-12 mb-3 opacity-20" />
                    <p className="text-xs">Skill Tree is warming up...</p>
                    <p className="text-[10px] mt-1 text-text-muted">
                        The embedding model loads in the background
                    </p>
                </div>
            ) : (
                <canvas
                    ref={canvasRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    onClick={handleCanvasClick}
                    onMouseDown={handleMouseDown}
                    onWheel={handleWheel}
                    className="cursor-grab active:cursor-grabbing"
                    style={{ width: canvasSize.width, height: canvasSize.height }}
                />
            )}

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex gap-3 text-[9px] text-text-secondary bg-surface-base/90 rounded px-3 py-1.5 backdrop-blur-sm border border-border-subtle">
                <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 border border-accent/50" style={{ clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)" }} /> Domain
                </span>
                <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-accent/40 rounded-full" /> Tool
                </span>
                <span className="text-text-muted">|</span>
                <span className="text-text-tertiary">Scroll to zoom · Drag to pan</span>
            </div>
        </div>
    );
}
