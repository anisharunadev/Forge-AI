'use client';

import * as React from 'react';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Loader2,
  Crosshair,
  Tag,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  createSimulation,
  radiusForNode,
  type CommunityInfo,
  type Simulation,
  type SimEdge,
} from './force-simulation';
import {
  ALL_KINDS,
  EDGE_COLOR,
  EDGE_LABEL,
  KIND_COLOR,
} from './graph-palette';
import type {
  EdgeKind,
  NodeKind,
  SampleNode,
} from '@/src/data/sample-graph';

export type Layout = 'force' | 'tb' | 'lr' | 'radial' | 'grid' | 'timeline';

export interface KnowledgeGraphCanvasProps {
  nodes: ReadonlyArray<SampleNode>;
  edges: ReadonlyArray<{ id: string; source: string; target: string; kind: EdgeKind; strength: 1 | 2 | 3 }>;
  /** Kinds the user has enabled in the filter bar. */
  visibleKinds: ReadonlyArray<NodeKind>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Double-click navigates to the underlying entity page. */
  onOpen: (node: SampleNode) => void;
  layout: Layout;
  /** Local graph view — show only nodes within `localHops` of the selection. */
  localActive: boolean;
  localHops: number;
  /** Edge types the user has disabled. */
  hiddenEdgeKinds: ReadonlyArray<EdgeKind>;
  /** Optional callback fired when a right-click context menu is requested. */
  onContextMenu?: (node: SampleNode, screenX: number, screenY: number) => void;
}

interface HoverState {
  id: string | null;
  /** Edges connected to the hovered node, for highlight dimming. */
  incidentEdgeIds: ReadonlySet<string>;
  /** Screen-space cursor position for the floating preview. */
  screenX: number;
  screenY: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

/**
 * Force-directed knowledge graph canvas.
 *
 * Step 39 polish — galaxy aesthetic:
 *   - Tuned force simulation (charge -900, rest 120, slow alpha decay)
 *   - Louvain community detection colors each cluster, draws halo behind it
 *   - Node radius scales with degree (hub/medium/leaf), glow on hover/select
 *   - Smart labels: only on hover, select, 2-hop neighbor, or zoom > 1.5
 *   - Star-field background + radial gradient mesh (galaxy)
 *   - Auto-fit on first paint + Reset View button
 *   - Edge thickness by strength, dashed by kind, color by kind
 *   - Minimap bottom-left, hover preview card top-right
 *   - Respects prefers-reduced-motion and idle-pause (4s)
 */
export function KnowledgeGraphCanvas({
  nodes,
  edges,
  visibleKinds,
  selectedId,
  onSelect,
  onOpen,
  layout,
  localActive,
  localHops,
  hiddenEdgeKinds,
  onContextMenu,
}: KnowledgeGraphCanvasProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState({ w: 800, h: 560 });
  const [zoom, setZoom] = React.useState(1);
  const [hover, setHover] = React.useState<HoverState>({
    id: null,
    incidentEdgeIds: new Set(),
    screenX: 0,
    screenY: 0,
  });
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [showAllLabels, setShowAllLabels] = React.useState(false);
  const [showMinimap, setShowMinimap] = React.useState(true);

  // Refs mirror state so the animation loop can read the latest values
  // without re-creating the rAF closure (which would miss the resize
  // events that happen after the loop was set up).
  const sizeRef = React.useRef(size);
  const zoomRef = React.useRef(zoom);
  const panRef = React.useRef(pan);
  React.useEffect(() => { sizeRef.current = size; }, [size]);
  React.useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  React.useEffect(() => { panRef.current = pan; }, [pan]);

  // ---- Filtering ---------------------------------------------------------

  const visibleKindSet = React.useMemo(() => new Set(visibleKinds), [visibleKinds]);
  const hiddenEdgeSet = React.useMemo(() => new Set(hiddenEdgeKinds), [hiddenEdgeKinds]);

  const filteredNodes = React.useMemo(
    () => nodes.filter((n) => visibleKindSet.has(n.kind)),
    [nodes, visibleKindSet],
  );

  // BFS down to localHops when local-graph is active.
  const localNodeIds = React.useMemo(() => {
    if (!localActive || !selectedId) return null;
    const hops = Math.max(1, Math.min(localHops, 4));
    const sim = simulationRef.current;
    if (!sim) return new Set([selectedId]);
    return new Set(sim.neighborhood(selectedId, hops));
  }, [localActive, localHops, selectedId, nodes, edges]);

  const displayNodes = React.useMemo(() => {
    if (!localNodeIds) return filteredNodes;
    return filteredNodes.filter((n) => localNodeIds.has(n.id));
  }, [filteredNodes, localNodeIds]);

  const displayEdges = React.useMemo(() => {
    const ids = localNodeIds;
    return edges
      .filter((e) => !hiddenEdgeSet.has(e.kind))
      .filter((e) =>
        ids ? ids.has(e.source) && ids.has(e.target) : true,
      );
  }, [edges, hiddenEdgeSet, localNodeIds]);

  // ---- Simulation lifecycle ---------------------------------------------

  const simulationRef = React.useRef<Simulation | null>(null);
  const animationRef = React.useRef<number | null>(null);
  const lastInteractionAt = React.useRef<number>(Date.now());
  // needsFit is set to true whenever the visible graph changed enough to
  // warrant a fresh auto-fit. The animation loop drains it once the
  // simulation has actually settled (alpha < 0.1), so we never capture
  // a transient layout.
  const needsFit = React.useRef(true);
  // Tracks whether the user has manually panned/zoomed since the last
  // auto-fit. When true, window resize keeps the current view (per spec).
  const userNavigated = React.useRef(false);

  // Rebuild simulation whenever the underlying node/edge set changes.
  React.useEffect(() => {
    if (filteredNodes.length === 0) {
      simulationRef.current = null;
      return;
    }
    simulationRef.current = createSimulation(
      filteredNodes.map((n) => ({ id: n.id, seedX: n.seedX, seedY: n.seedY })),
      displayEdges.map<SimEdge>((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        strength: e.strength,
      })),
      { width: size.w, height: size.h, maxNodes: 500 },
    );
    lastInteractionAt.current = Date.now();
    needsFit.current = true;
  }, [filteredNodes, displayEdges, size.w, size.h]);

  // Respect prefers-reduced-motion.
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Resize observer — keeps the canvas filling its wrapper.
  React.useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(280, height) });
      simulationRef.current?.setSize(width, height);
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  // Reset needsFit whenever the visible node set changes (filtered nodes,
  // local-graph toggled, search applied, etc.). The animation loop drains
  // it when the simulation has settled.
  React.useEffect(() => {
    needsFit.current = true;
    userNavigated.current = false;
  }, [filteredNodes.length, displayEdges.length, localNodeIds?.size ?? 0]);

  // ---- Star field (deterministic per session) ----------------------------

  const stars = React.useMemo<ReadonlyArray<Star>>(() => {
    const out: Star[] = [];
    // Seed with a constant so re-renders don't jitter the field.
    let seed = 0xC0FFEE;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 140; i += 1) {
      out.push({
        x: rand() * 100,
        y: rand() * 100,
        size: rand() < 0.85 ? 1 : 2,
        alpha: 0.15 + rand() * 0.35,
      });
    }
    return out;
  }, []);

  // ---- Animation loop. Honors reduced-motion + 4s idle pause. ------------

  React.useEffect(() => {
    let mounted = true;
    const loop = () => {
      if (!mounted) return;
      const sim = simulationRef.current;
      if (!sim) {
        animationRef.current = requestAnimationFrame(loop);
        return;
      }
      const idleMs = Date.now() - lastInteractionAt.current;
      const shouldStep = !reducedMotion && (sim.alpha() > 0.005 || idleMs < 4000);
      if (shouldStep) sim.tick();
      // Auto-fit once the simulation has settled below 0.1 alpha.
      // Doing it inside the loop (vs setTimeout) means we always run
      // against the actual settled positions, not a transient layout.
      if (needsFit.current && sim.alpha() < 0.1) {
        needsFit.current = false;
        fit();
      }
      draw();
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, size.w, size.h, hover.id, selectedId, displayNodes, displayEdges]);

  // ---- Layout overrides (TB / LR / Radial / Grid / Timeline) ------------

  React.useEffect(() => {
    const sim = simulationRef.current;
    if (!sim) return;
    if (layout === 'force') {
      sim.reheat(0.6);
      return;
    }
    const cx = size.w / 2;
    const cy = size.h / 2;
    const n = sim.nodes.length;
    sim.nodes.forEach((node, i) => {
      if (layout === 'tb' || layout === 'lr') {
        const cols = layout === 'lr' ? Math.ceil(Math.sqrt(n)) : 1;
        const rows = layout === 'tb' ? Math.ceil(Math.sqrt(n)) : 1;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = ((col + 0.5) / cols) * size.w;
        const y = ((row + 0.5) / Math.max(1, rows)) * size.h;
        node.fx = x;
        node.fy = y;
      } else if (layout === 'radial') {
        const r = 220;
        const ang = (i / Math.max(1, n)) * Math.PI * 2;
        node.fx = cx + Math.cos(ang) * r;
        node.fy = cy + Math.sin(ang) * r;
      } else if (layout === 'grid') {
        const cols = Math.ceil(Math.sqrt(n));
        const cellW = size.w / cols;
        const rows = Math.ceil(n / cols);
        const cellH = size.h / Math.max(1, rows);
        node.fx = (i % cols) * cellW + cellW / 2;
        node.fy = Math.floor(i / cols) * cellH + cellH / 2;
      } else if (layout === 'timeline') {
        const sorted = [...sim.nodes].sort((a, b) => a.id.localeCompare(b.id));
        const idx = sorted.findIndex((s) => s.id === node.id);
        node.fx = ((idx + 0.5) / Math.max(1, n)) * size.w;
        node.fy = cy;
      }
    });
    draw();
  }, [layout, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Zoom-to-fit ------------------------------------------------------

  const fit = React.useCallback(() => {
    const sim = simulationRef.current;
    if (!sim || sim.nodes.length === 0) return;
    // Read the LATEST size from the ref so this never captures a stale
    // closure (the old setTimeout-based fit used to capture the size from
    // the render where the effect was set up, not the current canvas).
    const { w: W, h: H } = sizeRef.current;
    if (W < 100 || H < 100) return;
    const xs = sim.nodes.map((n) => n.x);
    const ys = sim.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const padding = 80;
    // Clamp zoom: never below 0.2 (full galaxy visible), never above 1.5
    // (no point zooming in past readable label size at this node count).
    const zx = (W - padding * 2) / w;
    const zy = (H - padding * 2) / h;
    const z = Math.min(1.5, Math.max(0.2, Math.min(zx, zy)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setZoom(z);
    setPan({
      x: W / 2 - cx * z,
      y: H / 2 - cy * z,
    });
    lastInteractionAt.current = Date.now();
    userNavigated.current = false;
  }, []);

  // ---- Drawing ----------------------------------------------------------

  const draw = React.useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simulationRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Node positions lookup.
    const posById = new Map<string, { x: number; y: number; r: number; degree: number; community: number }>();
    sim.nodes.forEach((n) => posById.set(n.id, {
      x: n.x,
      y: n.y,
      r: radiusForNode(n.degree),
      degree: n.degree,
      community: n.community,
    }));

    // ---- Community halos (drawn first, behind everything) ----------------
    const communities = sim.getCommunities();
    for (const c of communities) {
      // Halo radius scales with sqrt of member count.
      const haloR = 80 + Math.sqrt(c.size) * 60;
      const a = posById.get(c.members[0] ?? '');
      if (!a) continue;
      // Compute the community bounding box in node space, then halo = bbox + pad
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of c.members) {
        const p = posById.get(id);
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      if (!isFinite(minX)) continue;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rw = (maxX - minX) / 2 + 80;
      const rh = (maxY - minY) / 2 + 80;

      // Radial halo
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rw, rh));
      grad.addColorStop(0, hexToRgba(c.color, 0.10));
      grad.addColorStop(1, hexToRgba(c.color, 0.0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rw, rh), Math.max(rw, rh), 0, 0, Math.PI * 2);
      ctx.fill();

      // Cluster label (faded, only when zoomed in past 1.2)
      if (zoom > 1.2) {
        ctx.font = `600 ${Math.max(11, 14 / Math.max(0.7, zoom))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hexToRgba(c.color, 0.65);
        ctx.fillText(`cluster ${c.id + 1}`, cx, cy - Math.max(rw, rh) * 0.55);
      }
    }

    // ---- Edges (drawn before nodes) ------------------------------------
    for (const e of sim.edges) {
      const a = posById.get(e.source);
      const b = posById.get(e.target);
      if (!a || !b) continue;

      const isHighlighted =
        hover.id === e.source ||
        hover.id === e.target ||
        selectedId === e.source ||
        selectedId === e.target;

      const isLocalVisible =
        !localNodeIds ||
        (localNodeIds.has(e.source) && localNodeIds.has(e.target));

      // Ghost dim when something else is hovered; otherwise normal alpha.
      let alpha: number;
      if (!isLocalVisible) alpha = 0.12;
      else if (isHighlighted) alpha = 0.95;
      else if (hover.id) alpha = 0.18;
      else if (selectedId) alpha = 0.35;
      else alpha = 0.55;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = EDGE_COLOR[e.kind];
      // Thickness: scale by strength (1=1px, 2=1.5px, 3=2px) + highlight boost.
      ctx.lineWidth = (e.strength === 3 ? 2 : e.strength === 2 ? 1.5 : 1) * (isHighlighted ? 1.4 : 1);
      // Dash pattern: structural=solid, contextual=dashed, weak=dotted.
      const dash = e.kind === 'supersedes' ? [6, 4]
        : e.kind === 'related_to' ? [4, 4]
        : e.kind === 'references' ? [] // solid — primary relation
        : e.kind === 'depends_on' ? [] // solid — directional dependency
        : [];
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Arrow head — only on highlight.
      if (isHighlighted) {
        drawArrowHead(ctx, a, b, EDGE_COLOR[e.kind]);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // ---- Nodes ---------------------------------------------------------
    // Compute 2-hop neighborhood of selected node for label highlighting.
    const selectedNeighborhood = selectedId
      ? new Set(sim.neighborhood(selectedId, 2))
      : new Set<string>();

    for (const n of sim.nodes) {
      const meta = nodes.find((orig) => orig.id === n.id);
      if (!meta) continue;
      const r = radiusForNode(n.degree);
      const isSelected = selectedId === n.id;
      const isHovered = hover.id === n.id;
      const isInNeighborhood = selectedNeighborhood.has(n.id);
      const isGhost =
        localNodeIds != null &&
        !localNodeIds.has(n.id) &&
        (selectedId === meta.id || localNodeIds.has(meta.id));

      // Unconnected nodes fade when something is hovered.
      const connectedToHoverOrSelect =
        hover.id == null && selectedId == null
          ? true
          : hover.id != null
            ? hover.id === n.id ||
              sim.edges.some(
                (e) =>
                  (e.source === hover.id && e.target === n.id) ||
                  (e.target === hover.id && e.source === n.id),
              )
            : selectedId === n.id || isInNeighborhood;

      ctx.globalAlpha = isGhost ? 0.18 : connectedToHoverOrSelect ? 1 : 0.30;

      // Outer glow — selected node gets a bright halo, hub nodes get a soft one.
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.22)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.10)';
        ctx.fill();
      } else if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fill();
      } else if (n.degree >= 10) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(KIND_COLOR[meta.kind], 0.16);
        ctx.fill();
      }

      // Node body.
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLOR[meta.kind];
      ctx.fill();

      // Outline (selected: indigo + 2px; hovered: white; default: subtle).
      ctx.lineWidth = isSelected ? 2 : isHovered ? 1.5 : 0.5;
      ctx.strokeStyle = isSelected
        ? '#6366F1'
        : isHovered
          ? '#FAFAFA'
          : 'rgba(255, 255, 255, 0.18)';
      ctx.stroke();

      // Smart labels: only on hover, selection, 2-hop neighbor, zoom > 1.5, or
      // explicit "show all labels" toggle.
      const showLabel =
        isHovered ||
        isSelected ||
        isInNeighborhood ||
        zoom > 1.5 ||
        showAllLabels;
      if (showLabel) {
        const fontSize = 11 / Math.max(0.7, zoom);
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // Pill background.
        const labelText = meta.label;
        const metrics = ctx.measureText(labelText);
        const padX = 5;
        const padY = 2;
        const labelW = metrics.width + padX * 2;
        const labelH = fontSize + padY * 2;
        const labelX = n.x - labelW / 2;
        const labelY = n.y + r + 5;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        roundRect(ctx, labelX, labelY, labelW, labelH, 3);
        ctx.fill();
        ctx.fillStyle = isHovered || isSelected ? '#FAFAFA' : 'rgba(250, 250, 250, 0.85)';
        ctx.fillText(labelText, n.x, labelY + padY);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }, [nodes, hover.id, selectedId, zoom, pan.x, pan.y, size.w, size.h, localNodeIds, showAllLabels]);

  // ---- Hit testing + pointer events ------------------------------------

  const findNodeAt = React.useCallback(
    (sx: number, sy: number): SampleNode | null => {
      const sim = simulationRef.current;
      if (!sim) return null;
      const cx = (sx - pan.x) / zoom;
      const cy = (sy - pan.y) / zoom;
      for (let i = sim.nodes.length - 1; i >= 0; i -= 1) {
        const n = sim.nodes[i];
        if (!n) continue;
        const r = radiusForNode(n.degree) + 4;
        const dx = cx - n.x;
        const dy = cy - n.y;
        if (dx * dx + dy * dy <= r * r) {
          return nodes.find((orig) => orig.id === n.id) ?? null;
        }
      }
      return null;
    },
    [pan.x, pan.y, zoom, nodes],
  );

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = findNodeAt(sx, sy);
    const incident = new Set<string>();
    if (hit) {
      for (const edge of edges) {
        if (edge.source === hit.id || edge.target === hit.id) incident.add(edge.id);
      }
    }
    setHover({ id: hit?.id ?? null, incidentEdgeIds: incident, screenX: sx, screenY: sy });
    lastInteractionAt.current = Date.now();
  };

  const onMouseLeave = () => setHover({ id: null, incidentEdgeIds: new Set(), screenX: 0, screenY: 0 });

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    onSelect(hit?.id ?? null);
    if (hit) simulationRef.current?.reheat(0.4);
    lastInteractionAt.current = Date.now();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) onOpen(hit);
  };

  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onContextMenu) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      e.preventDefault();
      onContextMenu(hit, e.clientX, e.clientY);
    }
  };

  // ---- Drag handling -----------------------------------------------------

  const dragRef = React.useRef<{
    id: string | null;
    startX: number;
    startY: number;
    moved: boolean;
    permanent: boolean;
  }>({ id: null, startX: 0, startY: 0, moved: false, permanent: false });

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    dragRef.current = {
      id: hit.id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      permanent: e.shiftKey,
    };
    lastInteractionAt.current = Date.now();
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.id) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left - pan.x) / zoom;
      const cy = (e.clientY - rect.top - pan.y) / zoom;
      simulationRef.current?.dragNode(d.id, cx, cy, d.permanent);
      d.moved = true;
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d.id && d.moved && !d.permanent) {
        // Release the pin so physics resumes (unless it was shift+drag).
        simulationRef.current?.releaseNode(d.id);
      }
      dragRef.current = { id: null, startX: 0, startY: 0, moved: false, permanent: false };
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pan.x, pan.y, zoom]);

  // ---- Wheel zoom -------------------------------------------------------

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const next = Math.min(3, Math.max(0.2, zoom - e.deltaY * 0.0015));
    setZoom(next);
    lastInteractionAt.current = Date.now();
  };

  // ---- Loading + empty states ------------------------------------------

  if (filteredNodes.length === 0) {
    return (
      <div
        ref={wrapperRef}
        data-testid="knowledge-graph-canvas"
        className="relative flex h-full min-h-[400px] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]"
      >
        <div className="flex flex-col items-center gap-2 text-[var(--fg-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <p className="text-xs">Graph is rendering…</p>
        </div>
      </div>
    );
  }

  // ---- Hover preview data ----------------------------------------------

  const hoveredNode = hover.id ? nodes.find((n) => n.id === hover.id) ?? null : null;
  const hoveredConnected = hoveredNode
    ? Array.from(
        new Set(
          edges
            .filter((e) => e.source === hoveredNode.id || e.target === hoveredNode.id)
            .map((e) => (e.source === hoveredNode.id ? e.target : e.source)),
        ),
      )
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is SampleNode => Boolean(n))
        .slice(0, 3)
    : [];

  return (
    <div
      ref={wrapperRef}
      data-testid="knowledge-graph-canvas"
      className="relative h-full min-h-[480px] w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]"
    >
      {/* Galaxy background — radial gradient mesh + star field */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 18% 22%, rgba(34, 211, 238, 0.06) 0%, transparent 45%)',
            'radial-gradient(circle at 82% 78%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)',
            'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.03) 0%, transparent 60%)',
          ].join(', '),
        }}
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        {stars.map((s, i) => (
          <circle
            key={i}
            cx={`${s.x}%`}
            cy={`${s.y}%`}
            r={s.size}
            fill="white"
            opacity={s.alpha * 0.6}
          />
        ))}
      </svg>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: hover.id ? 'pointer' : 'grab' }}
        role="img"
        aria-label={`Knowledge graph with ${filteredNodes.length} nodes and ${displayEdges.length} edges`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContext}
        onWheel={onWheel}
        data-nodes={filteredNodes.length}
        data-edges={displayEdges.length}
        data-zoom={zoom.toFixed(2)}
      />

      {/* Zoom controls + label toggle — bottom-left cluster. */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/90 p-1 shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => { userNavigated.current = true; setZoom((z) => Math.max(0.2, z - 0.15)); }}
          aria-label="Zoom out"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
        >
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => { userNavigated.current = true; setZoom(1); }}
          aria-label={`Reset zoom — current ${Math.round(zoom * 100)}%`}
          className={cn(
            'inline-flex h-8 min-w-[3.5rem] items-center justify-center rounded-[var(--radius-sm)] px-2 font-mono text-xs',
            'text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]',
          )}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => { userNavigated.current = true; setZoom((z) => Math.min(3, z + 0.15)); }}
          aria-label="Zoom in"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={fit}
          aria-label="Fit graph to viewport"
          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
          data-testid="reset-view"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setShowAllLabels((v) => !v)}
          aria-label={showAllLabels ? 'Hide all labels' : 'Show all labels'}
          aria-pressed={showAllLabels}
          className={cn(
            'ml-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
            showAllLabels
              ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
              : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]',
          )}
          data-testid="toggle-labels"
        >
          <Tag className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Stats overlay — top-left. */}
      <div className="pointer-events-none absolute left-4 top-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 px-2.5 py-1.5 font-mono text-[11px] text-[var(--fg-tertiary)] backdrop-blur">
        {filteredNodes.length} nodes · {displayEdges.length} edges · {simulationRef.current?.getCommunities().length ?? 0} clusters
        {localNodeIds && ` · local ${localNodeIds.size}/${filteredNodes.length}`}
      </div>

      {/* Bottom-right hint — fades after the first interaction. */}
      <div
        className={cn(
          'pointer-events-none absolute bottom-4 right-4 max-w-[280px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 px-3 py-2 text-[11px] text-[var(--fg-tertiary)] backdrop-blur transition-opacity duration-500',
          hover.id ? 'opacity-0' : 'opacity-100',
        )}
      >
        Drag to pan · ⌘+scroll to zoom · Click to inspect · Double-click to open · Shift+drag to pin
      </div>

      {/* Minimap — bottom-left under zoom controls */}
      {showMinimap && (
        <Minimap
          simRef={simulationRef}
          zoom={zoom}
          pan={pan}
          size={size}
          nodes={filteredNodes}
          onToggle={() => setShowMinimap(false)}
        />
      )}
      {!showMinimap && (
        <button
          type="button"
          onClick={() => setShowMinimap(true)}
          className="absolute bottom-4 left-[280px] inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/80 px-2 text-[10px] text-[var(--fg-tertiary)] backdrop-blur hover:text-[var(--fg-primary)]"
        >
          <Crosshair className="h-3 w-3" aria-hidden="true" /> Minimap
        </button>
      )}

      {/* Floating hover preview — appears near cursor when hovering a node */}
      {hoveredNode && (
        <div
          className="pointer-events-none absolute z-20 w-[280px] -translate-x-1/2 -translate-y-full rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 p-3 text-xs shadow-[var(--shadow-lg)] backdrop-blur"
          style={{
            left: Math.max(150, Math.min(size.w - 20, hover.screenX)),
            top: Math.max(120, hover.screenY - 12),
            animation: 'kg-fade-in 150ms ease-out',
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: KIND_COLOR[hoveredNode.kind] }}
            />
            <span className="font-semibold text-[var(--fg-primary)]">{hoveredNode.label}</span>
            <span className="ml-auto rounded-full bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
              {hoveredNode.kind}
            </span>
          </div>
          <p className="line-clamp-2 text-[11px] leading-snug text-[var(--fg-secondary)]">
            {hoveredNode.preview}
          </p>
          {hoveredConnected.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {hoveredConnected.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)]"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: KIND_COLOR[c.kind] }}
                  />
                  {c.label}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-[var(--fg-tertiary)]">Click to open full details →</p>
        </div>
      )}

      <style jsx>{`
        @keyframes kg-fade-in {
          from { opacity: 0; transform: translate(-50%, calc(-100% + 4px)); }
          to { opacity: 1; transform: translate(-50%, -100%); }
        }
      `}</style>
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = 8;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-len, -len / 2);
  ctx.lineTo(-len, len / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(m[1] ?? 'ff', 16);
  const g = parseInt(m[2] ?? 'ff', 16);
  const b = parseInt(m[3] ?? 'ff', 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Minimap -------------------------------------------------------------

function Minimap({
  simRef,
  zoom,
  pan,
  size,
  nodes,
  onToggle,
}: {
  simRef: React.MutableRefObject<Simulation | null>;
  zoom: number;
  pan: { x: number; y: number };
  size: { w: number; h: number };
  nodes: ReadonlyArray<SampleNode>;
  onToggle: () => void;
}) {
  const W = 200;
  const H = 150;
  const sim = simRef.current;
  if (!sim || sim.nodes.length === 0) return null;

  const xs = sim.nodes.map((n) => n.x);
  const ys = sim.nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const pad = 8;
  const sx = (x: number) => pad + ((x - minX) / w) * (W - pad * 2);
  const sy = (y: number) => pad + ((y - minY) / h) * (H - pad * 2);

  // Current viewport rectangle in graph space (inverse of pan/zoom).
  const viewLeft = (0 - pan.x) / zoom;
  const viewTop = (0 - pan.y) / zoom;
  const viewRight = (size.w - pan.x) / zoom;
  const viewBottom = (size.h - pan.y) / zoom;

  return (
    <div
      className="absolute bottom-4 left-[250px] flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/90 p-2 shadow-md backdrop-blur"
      style={{ width: W + 8 }}
      data-testid="minimap"
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block rounded-sm">
        <rect x={0} y={0} width={W} height={H} fill="rgba(15, 23, 42, 0.6)" />
        {sim.nodes.map((n) => {
          const meta = nodes.find((m) => m.id === n.id);
          if (!meta) return null;
          return (
            <circle
              key={n.id}
              cx={sx(n.x)}
              cy={sy(n.y)}
              r={Math.max(1.5, Math.min(3, n.degree / 4))}
              fill={communityOrKindColor(sim, n.id, meta.kind)}
              opacity={0.85}
            />
          );
        })}
        <rect
          x={sx(viewLeft)}
          y={sy(viewTop)}
          width={Math.max(8, sx(viewRight) - sx(viewLeft))}
          height={Math.max(8, sy(viewBottom) - sy(viewTop))}
          fill="rgba(99, 102, 241, 0.15)"
          stroke="rgba(99, 102, 241, 0.85)"
          strokeWidth={1.5}
        />
      </svg>
      <button
        type="button"
        onClick={onToggle}
        className="text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
      >
        Hide minimap
      </button>
    </div>
  );
}

function communityOrKindColor(sim: Simulation, id: string, kind: NodeKind): string {
  const node = sim.nodes.find((n) => n.id === id);
  if (!node) return KIND_COLOR[kind];
  const c = sim.getCommunities().find((cm) => cm.id === node.community);
  return c?.color ?? KIND_COLOR[kind];
}

// Suppress unused-export warnings while keeping the helpers importable.
export { ALL_KINDS, EDGE_LABEL };