/**
 * Context Graph — Interactive React Flow visualization of NIOM's NCF.
 *
 * Renders memories, projects, and stats as an animated node graph.
 * Uses @xyflow/react for pan/zoom/interactions.
 *
 * Layout:
 *   Center: NIOM root node
 *   Left cluster: User memories (profile, preferences, entities, events)
 *   Right cluster: Agent memories (cases, patterns)
 *   Bottom cluster: Projects
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

// ─── Types ───────────────────────────────────────────────────────────

interface MemoryItem {
  path: string;
  name: string;
  category: string;
  scope: "user" | "agent";
  content: string;
  size: number;
  updatedAt: number;
}

interface ProjectItem {
  hash: string;
  name: string;
  rootPath: string;
  techStack: Array<{ name: string; version?: string }>;
  conventions: string[];
  analyzedAt: number;
}

interface NCFStats {
  nodeCount: number;
  totalMemories: number;
  projectCount: number;
  sessionCount: number;
  l0IndexSize: number;
  memoryCounts: Record<string, number>;
}

// ─── Category Styling ────────────────────────────────────────────────

const CATEGORY_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  profile:     { color: "#a78bfa", bg: "#a78bfa15", icon: "👤" },
  preferences: { color: "#818cf8", bg: "#818cf815", icon: "⚙️" },
  entities:    { color: "#6366f1", bg: "#6366f115", icon: "🏷️" },
  events:      { color: "#4f46e5", bg: "#4f46e515", icon: "📅" },
  cases:       { color: "#22d3ee", bg: "#22d3ee15", icon: "📋" },
  patterns:    { color: "#06b6d4", bg: "#06b6d415", icon: "🔄" },
};

const PROJECT_STYLE = { color: "#f59e0b", bg: "#f59e0b15", icon: "📁" };

// ─── Custom Node Components ──────────────────────────────────────────

/** Root node — NIOM center */
function RootNode({ data }: NodeProps) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)",
        borderRadius: "50%",
        width: 90,
        height: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        boxShadow: "0 0 30px rgba(99, 102, 241, 0.4), 0 0 60px rgba(99, 102, 241, 0.15)",
        border: "2px solid rgba(255,255,255,0.2)",
        animation: "pulse 3s ease-in-out infinite",
      }}
    >
      <span style={{ fontSize: 18, fontWeight: 700, color: "white", fontFamily: "monospace" }}>
        NCF
      </span>
      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}>
        {(data as Record<string, unknown>).nodeCount as number} nodes
      </span>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
    </div>
  );
}

/** Category cluster node */
function CategoryNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const style = CATEGORY_STYLE[d.category as string] || { color: "#888", bg: "#88888815", icon: "📄" };
  return (
    <div
      style={{
        background: style.bg,
        border: `1.5px solid ${style.color}40`,
        borderRadius: 12,
        padding: "8px 14px",
        minWidth: 100,
        backdropFilter: "blur(8px)",
        boxShadow: `0 0 20px ${style.color}15`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{style.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: style.color, fontFamily: "monospace" }}>
          {d.label as string}
        </span>
        <span
          style={{
            fontSize: 9,
            color: style.color,
            opacity: 0.6,
            fontFamily: "monospace",
            marginLeft: "auto",
          }}
        >
          {d.count as number}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

/** Individual memory node */
function MemoryNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const style = CATEGORY_STYLE[d.category as string] || { color: "#888", bg: "#88888810" };
  return (
    <div
      style={{
        background: style.bg,
        border: `1px solid ${style.color}25`,
        borderRadius: 8,
        padding: "5px 10px",
        maxWidth: 140,
        backdropFilter: "blur(4px)",
        transition: "all 0.2s ease",
        cursor: "pointer",
      }}
      title={d.content as string}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ fontSize: 9, fontWeight: 500, color: style.color, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {d.label as string}
      </div>
      <div style={{ fontSize: 7, color: `${style.color}80`, fontFamily: "monospace", marginTop: 2 }}>
        ~{d.tokens as number} tok · {d.timeAgo as string}
      </div>
    </div>
  );
}

/** Project node */
function ProjectNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const techStack = d.techStack as string[];
  return (
    <div
      style={{
        background: PROJECT_STYLE.bg,
        border: `1.5px solid ${PROJECT_STYLE.color}40`,
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 110,
        maxWidth: 180,
        backdropFilter: "blur(8px)",
        boxShadow: `0 0 15px ${PROJECT_STYLE.color}10`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 12 }}>{PROJECT_STYLE.icon}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: PROJECT_STYLE.color, fontFamily: "monospace" }}>
          {d.label as string}
        </span>
      </div>
      {techStack && techStack.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
          {techStack.slice(0, 4).map((tech, i) => (
            <span
              key={i}
              style={{
                fontSize: 7,
                padding: "1px 4px",
                borderRadius: 4,
                background: `${PROJECT_STYLE.color}20`,
                color: PROJECT_STYLE.color,
                fontFamily: "monospace",
              }}
            >
              {tech}
            </span>
          ))}
          {techStack.length > 4 && (
            <span style={{ fontSize: 7, color: `${PROJECT_STYLE.color}60`, fontFamily: "monospace" }}>
              +{techStack.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Node type registry ──────────────────────────────────────────────

const nodeTypes = {
  root: RootNode,
  category: CategoryNode,
  memory: MemoryNode,
  project: ProjectNode,
};

// ─── Helpers ─────────────────────────────────────────────────────────

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Node dimensions for dagre ───────────────────────────────────────

const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  root:     { width: 90,  height: 90 },
  category: { width: 130, height: 40 },
  memory:   { width: 140, height: 38 },
  project:  { width: 170, height: 55 },
};

// ─── Dagre layout engine ─────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 40,
    ranksep: 70,
    marginx: 30,
    marginy: 30,
  });

  for (const node of nodes) {
    const dim = NODE_DIMENSIONS[node.type || "memory"] || NODE_DIMENSIONS.memory;
    g.setNode(node.id, { width: dim.width, height: dim.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const dim = NODE_DIMENSIONS[node.type || "memory"] || NODE_DIMENSIONS.memory;
    return {
      ...node,
      position: {
        x: pos.x - dim.width / 2,
        y: pos.y - dim.height / 2,
      },
    };
  });
}

// ─── Graph Builder ───────────────────────────────────────────────────

function buildGraph(
  memories: Record<string, MemoryItem[]>,
  projects: ProjectItem[],
  stats: NCFStats,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const allCategories = ["profile", "preferences", "entities", "events", "cases", "patterns"];
  const catLabels: Record<string, string> = {
    profile: "Profile", preferences: "Preferences", entities: "Entities",
    events: "Events", cases: "Cases", patterns: "Patterns",
  };

  // Root node
  nodes.push({
    id: "root",
    type: "root",
    position: { x: 0, y: 0 },
    data: { nodeCount: stats.nodeCount },
  });

  // Category + memory nodes
  for (const cat of allCategories) {
    const catId = `cat-${cat}`;
    const items = memories[cat] || [];

    nodes.push({
      id: catId,
      type: "category",
      position: { x: 0, y: 0 },
      data: { label: catLabels[cat], category: cat, count: items.length },
    });

    edges.push({
      id: `root-${catId}`,
      source: "root",
      target: catId,
      animated: true,
      style: { stroke: CATEGORY_STYLE[cat]?.color || "#888", strokeWidth: 1.5, opacity: 0.4 },
    });

    items.forEach((mem, j) => {
      const memId = `mem-${cat}-${j}`;

      nodes.push({
        id: memId,
        type: "memory",
        position: { x: 0, y: 0 },
        data: {
          label: mem.name,
          category: cat,
          tokens: estimateTokens(mem.content),
          timeAgo: timeAgo(mem.updatedAt),
          content: mem.content.slice(0, 200),
        },
      });

      edges.push({
        id: `${catId}-${memId}`,
        source: catId,
        target: memId,
        style: { stroke: CATEGORY_STYLE[cat]?.color || "#888", strokeWidth: 1, opacity: 0.25 },
      });
    });
  }

  // Project nodes
  for (const proj of projects) {
    const projId = `proj-${proj.hash}`;

    nodes.push({
      id: projId,
      type: "project",
      position: { x: 0, y: 0 },
      data: {
        label: proj.name,
        techStack: proj.techStack.map((t) => t.name),
      },
    });

    edges.push({
      id: `root-${projId}`,
      source: "root",
      target: projId,
      animated: true,
      style: { stroke: PROJECT_STYLE.color, strokeWidth: 1.5, opacity: 0.3 },
    });
  }

  // Apply dagre layout
  const layoutNodes = applyDagreLayout(nodes, edges);

  return { nodes: layoutNodes, edges };
}

// ─── Component ───────────────────────────────────────────────────────

interface ContextGraphProps {
  height?: number | string;
}

export function ContextGraph({ height = 500 }: ContextGraphProps) {
  const isFullscreen = height === "100%";
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [memoriesData, projectsData, statsData] = await Promise.all([
        window.niom.memory.list(),
        window.niom.memory.projects(),
        window.niom.memory.stats(),
      ]);

      const { nodes: graphNodes, edges: graphEdges } = buildGraph(
        memoriesData as Record<string, MemoryItem[]>,
        projectsData as ProjectItem[],
        statsData as NCFStats,
      );

      setNodes(graphNodes);
      setEdges(graphEdges);
    } catch (error) {
      console.error("[ContextGraph] Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Custom minimap colors
  const minimapNodeColor = useCallback((node: Node) => {
    if (node.type === "root") return "#6366f1";
    if (node.type === "project") return PROJECT_STYLE.color;
    const d = node.data as Record<string, unknown>;
    const cat = d.category as string;
    return CATEGORY_STYLE[cat]?.color || "#888";
  }, []);

  if (loading) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted-foreground)",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        Building context graph...
      </div>
    );
  }

  return (
    <div style={{ height, borderRadius: isFullscreen ? 0 : 12, overflow: "hidden", border: isFullscreen ? "none" : "1px solid var(--border)" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 30px rgba(99, 102, 241, 0.4), 0 0 60px rgba(99, 102, 241, 0.15); }
          50% { box-shadow: 0 0 40px rgba(99, 102, 241, 0.6), 0 0 80px rgba(99, 102, 241, 0.25); }
        }
        .react-flow__edge.animated path {
          animation-duration: 2s !important;
        }
        .react-flow__attribution { display: none !important; }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        style={{ background: "var(--background)" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--muted-foreground)" style={{ opacity: 0.15 }} />
        <Controls
          showInteractive={false}
          style={{
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(0,0,0,0.6)"
          style={{
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            opacity: 0.8,
          }}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
