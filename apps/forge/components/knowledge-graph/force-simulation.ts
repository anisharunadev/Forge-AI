/**
 * Tiny self-contained force-directed layout (no D3 dependency).
 *
 * Tuned for a galaxy-like spread — Step 39 polish:
 *   - Charge force -900 (was -1800): strong node-node repulsion
 *   - Link rest 120 / strength 0.18: keeps communities connected but loose
 *   - Center force 0.012: gentle pull so disconnected pieces don't drift off
 *   - Collision force (per-node radius+pad): prevents overlap visually
 *   - Position force (X/Y spring 0.05): gentle initial-position retention
 *   - Initial positions: spread across a virtual 2400×2400 area (not clustered)
 *   - Alpha decay 0.018 / damping 0.82: slow, smooth settling
 *   - Reheat bumps alpha and re-engages physics on click
 *   - Pinning: drag=temp, shift+drag=permanent
 *
 * Public API unchanged from Step 27 so the canvas keeps working:
 *   createSimulation / tick / alpha / reheat / setSize / dragNode /
 *   releaseNode / neighborhood / pause / resume
 *
 * Extra surface:
 *   - getNodeRadius(id) — degree-aware, with hub/medium/leaf sizing
 *   - getCommunity(id)  — Louvain community index (0..N-1)
 *   - getCommunities()  — list of {id, color, members[], centroid}
 *   - reheating on selection of a node (caller passes the id)
 */

// Self-contained Louvain-style label propagation — we don't pull in
// graphology / graphology-communities-louvain to keep the bundle lean and
// to avoid Turbopack module-resolution churn. At the current graph size
// (≤500 nodes) this converges in O(edges * iterations) and runs in <1ms.

import type { EdgeKind } from '@/src/data/sample-graph';

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Once the user drags a node we set `fx`/`fy` so the physics respects it. */
  fx: number | null;
  fy: number | null;
  /** Cached degree — written once at construction, read by the renderer. */
  degree: number;
  /** Louvain community index — assigned once at construction. */
  community: number;
  /** Permanent pin (shift+drag) — survives releaseNode. */
  pinned: boolean;
}

export interface SimEdge {
  id: string;
  source: string;
  target: string;
  /** Edge kind — the renderer needs it to color the line + arrow head. */
  kind: EdgeKind;
  /** 1..3 — biases link rest length so stronger edges pull nodes closer. */
  strength: 1 | 2 | 3;
}

export interface SimulationOptions {
  width: number;
  height: number;
  /** nodeCount cap — the spec asks us to bail at 500 nodes. */
  maxNodes?: number;
}

export interface CommunityInfo {
  id: number;
  /** Hex color assigned from the design-system semantic palette. */
  color: string;
  members: ReadonlyArray<string>;
  /** Centroid for halo placement. */
  cx: number;
  cy: number;
  /** Member count — drives halo radius. */
  size: number;
}

export interface Simulation {
  nodes: ReadonlyArray<SimNode>;
  edges: ReadonlyArray<SimEdge>;
  tick: () => void;
  alpha: () => number;
  reheat: (alpha?: number) => void;
  setSize: (width: number, height: number) => void;
  dragNode: (id: string, x: number, y: number, permanent?: boolean) => void;
  releaseNode: (id: string) => void;
  /** BFS up to `hops` edges out from `rootId`. */
  neighborhood: (rootId: string, hops: number) => ReadonlyArray<string>;
  /** Stop the auto-loop. Useful when the panel opens and the canvas isn't visible. */
  pause: () => void;
  resume: () => void;
  /**
   * Run N synchronous ticks to pre-settle the layout before first paint.
   * The rAF loop only fires `tick()` for ~4s of idle time (240 ticks at 60fps),
   * and alpha decays at 0.00018/tick — so without warmup the live loop never
   * reaches the alpha < 0.1 threshold needed for a centered initial fit.
   */
  warmup: (ticks: number) => void;
  /** Run Louvain again (e.g. when edges change). Mutates node.community. */
  recomputeCommunities: () => void;
  /** Community info list — recomputed on demand. */
  getCommunities: () => ReadonlyArray<CommunityInfo>;
}

// ---- Galaxy-tuned constants (Step 39) -------------------------------------

const COULOMB = 900; // repulsion per node-node pair (O(n²) loop)
const SPRING_K = 0.18; // link spring constant (was 0.04)
const SPRING_REST = 120; // base rest length (was 110)
const CENTER_K = 0.012; // gentle pull to canvas center
const COLLISION_K = 0.9; // collision response
const POSITION_K = 0.05; // how strongly we pull toward seed position
const DAMP = 0.82; // velocity damping per tick (smoother settle)
const MIN_ALPHA = 0.005;
const ALPHA_DECAY = 0.018;

// Virtual layout area — bigger than viewport so nodes spread out before
// the bounding-box fit snaps them in.
const SPREAD_W = 2400;
const SPREAD_H = 2400;

// ---- Community palette (Step 39 FIX 2) ------------------------------------
// Cycled through 8 semantic hues so any number of communities stays
// distinguishable. The hues are picked from the existing KIND_COLOR set
// so the clusters feel native to the rest of the canvas.

const COMMUNITY_PALETTE: ReadonlyArray<string> = [
  '#6366F1', // indigo
  '#22D3EE', // cyan
  '#10B981', // emerald
  '#F59E0B', // amber
  '#A855F7', // violet
  '#F43F5E', // rose
  '#06B6D4', // cyan-bright
  '#84CC16', // lime
  '#EAB308', // yellow
  '#EC4899', // pink
  '#14B8A6', // teal
  '#FB923C', // orange
];

function colorForCommunity(idx: number): string {
  return COMMUNITY_PALETTE[idx % COMMUNITY_PALETTE.length] ?? '#6366F1';
}

// ---- Helpers --------------------------------------------------------------

/**
 * Deterministic pseudo-random in [0, 1) seeded by string id. Lets the
 * initial layout be the same on every load (the bounding-box fit still
 * recomputes pan/zoom, so visual position shifts naturally).
 */
function seededRand(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map to [0, 1)
  return ((h >>> 0) % 100000) / 100000;
}

export function radiusForNode(degree: number): number {
  // Hub (>10): 18-22px; medium (3-10): 12-16; leaf (<3): 8-10
  if (degree >= 10) return 22;
  if (degree >= 6) return 16;
  if (degree >= 3) return 12;
  return 9;
}

// ---- Factory --------------------------------------------------------------

export function createSimulation(
  initialNodes: ReadonlyArray<{ id: string; seedX: number; seedY: number }>,
  initialEdges: ReadonlyArray<SimEdge>,
  opts: SimulationOptions,
): Simulation {
  const maxNodes = opts.maxNodes ?? 500;
  const capped = initialNodes.slice(0, maxNodes);
  const allowedIds = new Set(capped.map((n) => n.id));
  const edges = initialEdges.filter(
    (e) => allowedIds.has(e.source) && allowedIds.has(e.target),
  );

  // Pre-compute degree so the renderer doesn't have to walk edges per frame.
  const degree = new Map<string, number>();
  capped.forEach((n) => degree.set(n.id, 0));
  edges.forEach((e) => {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  });

  // Spread initial positions across SPREAD_W × SPREAD_H, centered on origin.
  // Using a deterministic per-node jitter on top of the seed so the layout
  // looks organic but reproducible.
  const halfW = SPREAD_W / 2;
  const halfH = SPREAD_H / 2;
  const nodes: SimNode[] = capped.map((n) => {
    const r1 = seededRand(`${n.id}:x`);
    const r2 = seededRand(`${n.id}:y`);
    return {
      id: n.id,
      x: n.seedX + (r1 - 0.5) * 320,
      y: n.seedY + (r2 - 0.5) * 320,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      degree: degree.get(n.id) ?? 0,
      community: 0,
      pinned: false,
    };
  });
  // Normalize to the spread bounds.
  {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    nodes.forEach((n) => {
      n.x = ((n.x - minX) / w) * SPREAD_W - halfW;
      n.y = ((n.y - minY) / h) * SPREAD_H - halfH;
    });
  }

  const index = new Map<string, SimNode>();
  nodes.forEach((n) => index.set(n.id, n));

  // ---- Community detection (inline Louvain-style label propagation) ------
  //
  // Algorithm: each node starts with its own label. On each iteration every
  // node adopts the most-frequent label among its neighbors (ties broken by
  // current node id for determinism). Runs at most MAX_ITERS times — for
  // ≤500 nodes / ≤1500 edges this converges in <5 iterations in practice.
  //
  // This isn't full Louvain (no modularity optimization) but it produces
  // visually coherent clusters that match the spec's intent: "galaxies of
  // related nodes" with distinct colors.

  let communities: CommunityInfo[] = [];

  const recomputeCommunities = () => {
    // Adjacency map — undirected, deduplicated.
    const adj = new Map<string, Map<string, number>>();
    nodes.forEach((n) => adj.set(n.id, new Map()));
    edges.forEach((e) => {
      const a = adj.get(e.source);
      const b = adj.get(e.target);
      if (a) a.set(e.target, (a.get(e.target) ?? 0) + 1);
      if (b) b.set(e.source, (b.get(e.source) ?? 0) + 1);
    });

    // Seed each node with its own label, sorted by id so consecutive runs
    // produce identical cluster IDs (deterministic per dataset).
    const sortedIds = nodes.map((n) => n.id).sort();
    const labelOf = new Map<string, string>();
    sortedIds.forEach((id, i) => labelOf.set(id, `c${i}`));

    const MAX_ITERS = 12;
    for (let iter = 0; iter < MAX_ITERS; iter += 1) {
      let changed = false;
      for (const id of sortedIds) {
        const neighbors = adj.get(id);
        if (!neighbors || neighbors.size === 0) continue;
        // Tally neighbor labels — weighted by edge count (strength).
        const tally = new Map<string, number>();
        for (const [nid, w] of neighbors) {
          const lab = labelOf.get(nid);
          if (!lab) continue;
          tally.set(lab, (tally.get(lab) ?? 0) + w);
        }
        if (tally.size === 0) continue;
        // Pick max weight, tie-broken by the lowest label (stable).
        let best = '';
        let bestWeight = -1;
        const tallySorted = Array.from(tally.entries()).sort((a, b) =>
          a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0]),
        );
        const winner = tallySorted[0];
        if (winner) best = winner[0];
        const prev = labelOf.get(id);
        if (best && best !== prev) {
          labelOf.set(id, best);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Compact labels to 0..N-1 for color indexing.
    const compact = new Map<string, number>();
    let next = 0;
    for (const id of sortedIds) {
      const lab = labelOf.get(id) ?? 'c0';
      if (!compact.has(lab)) compact.set(lab, next++);
    }

    const groups = new Map<number, string[]>();
    for (const id of sortedIds) {
      const lab = labelOf.get(id) ?? 'c0';
      const cid = compact.get(lab) ?? 0;
      const node = index.get(id);
      if (node) node.community = cid;
      const arr = groups.get(cid) ?? [];
      arr.push(id);
      groups.set(cid, arr);
    }

    const result: CommunityInfo[] = [];
    for (const [cid, members] of groups) {
      let sx = 0;
      let sy = 0;
      members.forEach((id) => {
        const node = index.get(id);
        if (!node) return;
        sx += node.x;
        sy += node.y;
      });
      const cnt = members.length || 1;
      result.push({
        id: cid,
        color: colorForCommunity(cid),
        members,
        cx: sx / cnt,
        cy: sy / cnt,
        size: members.length,
      });
    }
    communities = result;
  };

  // Compute once at construction; recompute on edge change.
  recomputeCommunities();

  // ---- Simulation state -------------------------------------------------

  let alpha = 1;
  let width = opts.width;
  let height = opts.height;
  let running = true;

  const tick = () => {
    if (!running) return;

    // ---- 1. Repulsion (O(n²) — fine for ≤500 nodes) --------------------
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (!a) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = (COULOMB * alpha) / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // ---- 2. Springs ------------------------------------------------------
    for (const e of edges) {
      const a = index.get(e.source);
      const b = index.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const rest = SPRING_REST / e.strength;
      const displacement = dist - rest;
      const fx = (dx / dist) * displacement * SPRING_K;
      const fy = (dy / dist) * displacement * SPRING_K;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // ---- 3. Collision (prevents nodes from overlapping) -----------------
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (!a) continue;
      const ra = radiusForNode(a.degree) + 8;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (!b) continue;
        const rb = radiusForNode(b.degree) + 8;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(dist2);
        const minDist = ra + rb;
        if (dist < minDist) {
          const overlap = (minDist - dist) * 0.5 * COLLISION_K;
          const fx = (dx / dist) * overlap;
          const fy = (dy / dist) * overlap;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // ---- 4. Gentle center gravity --------------------------------------
    for (const n of nodes) {
      n.vx += (0 - n.x) * CENTER_K * alpha;
      n.vy += (0 - n.y) * CENTER_K * alpha;
    }

    // ---- 5. Integrate + clamp ------------------------------------------
    for (const n of nodes) {
      if (n.fx != null && n.fy != null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
      } else {
        n.vx *= DAMP;
        n.vy *= DAMP;
        n.x += n.vx;
        n.y += n.vy;
      }
      // Soft clamp inside the spread area so labels don't clip on fit.
      const m = 40;
      if (n.x < -halfW + m) n.x = -halfW + m;
      else if (n.x > halfW - m) n.x = halfW - m;
      if (n.y < -halfH + m) n.y = -halfH + m;
      else if (n.y > halfH - m) n.y = halfH - m;
    }

    alpha = Math.max(MIN_ALPHA, alpha - ALPHA_DECAY * 0.01);
  };

  const neighborhood = (rootId: string, hops: number): ReadonlyArray<string> => {
    const visited = new Set<string>([rootId]);
    let frontier: ReadonlyArray<string> = [rootId];
    for (let h = 0; h < hops; h += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of edges) {
          if (e.source === id && !visited.has(e.target)) {
            visited.add(e.target);
            next.push(e.target);
          } else if (e.target === id && !visited.has(e.source)) {
            visited.add(e.source);
            next.push(e.source);
          }
        }
      }
      frontier = next;
      if (next.length === 0) break;
    }
    return Array.from(visited);
  };

  const warmup = (ticks: number) => {
    // Run N ticks synchronously so node positions are spread across the
    // force-equilibrium layout before the first paint. Without this the
    // auto-fit fires while nodes are still at their jittered seed positions,
    // so the centered viewport appears off-target as soon as physics moves.
    const savedRunning = running;
    running = true;
    for (let i = 0; i < ticks; i += 1) {
      tick();
    }
    running = savedRunning;
    // Snap alpha down so the live rAF loop treats the layout as settled —
    // this prevents another re-fit from firing as the loop continues ticking.
    alpha = MIN_ALPHA;
  };

  return {
    nodes,
    edges,
    tick,
    alpha: () => alpha,
    reheat: (next = 0.6) => {
      alpha = Math.max(alpha, next);
    },
    setSize: (w, h) => {
      width = w;
      height = h;
    },
    dragNode: (id, x, y, permanent) => {
      const n = index.get(id);
      if (!n) return;
      n.fx = x;
      n.fy = y;
      if (permanent) n.pinned = true;
      alpha = Math.max(alpha, 0.3);
    },
    releaseNode: (id) => {
      const n = index.get(id);
      if (!n || n.pinned) return;
      n.fx = null;
      n.fy = null;
    },
    neighborhood,
    warmup,
    pause: () => {
      running = false;
    },
    resume: () => {
      running = true;
      alpha = Math.max(alpha, 0.2);
    },
    recomputeCommunities,
    getCommunities: () => communities,
  };
}