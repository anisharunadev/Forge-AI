/**
 * Knowledge Graph — wire → canvas adapter (Step 57 zone 3).
 *
 * The backend (`backend/app/schemas/project_intelligence.KGNodeRead`)
 * returns a generic, properties-bag shape:
 *
 *   {
 *     id: string,
 *     node_type: string,            // lowercase: 'service' | 'adr' | 'doc' | ...
 *     name: string,
 *     properties: Record<string, unknown>,
 *     freshness_at: string | null,
 *     updated_at: string,
 *     ...
 *   }
 *
 * The Knowledge Graph canvas, list view, outline view, inspector panel,
 * and minimap all consume the richer, locally-defined `SampleNode`
 * shape (with seed coordinates, author profile, kind-specific colours,
 * tag lists, status, href). The adapter bridges the two so the page
 * can drop straight into the existing UI without rewriting the canvas.
 *
 * MAPPING RULES (per step-57-v2.md zone 3):
 *
 *   id           ← node.id
 *   label        ← name (truncated to 80 chars if missing)
 *   kind         ← pascalCase(node_type) if it matches the UI palette,
 *                  else fall back to a derived PascalCase
 *   summary      ← first 200 chars of name
 *   preview      ← properties.preview ?? properties.summary ?? summary
 *   tags         ← properties.tags[] ?? properties.category ?? properties.format
 *                  (always wrapped in a ReadonlyArray<string>)
 *   author.name  ← properties.owner ?? 'system'
 *   author.role  ← properties.owner_role ?? ''
 *   author.initials ← initials(properties.owner) ?? 'SY'
 *   href         ← properties.url ?? '/knowledge-center'
 *   status       ← properties.status ?? undefined
 *   seedX / seedY ← hash of id mapped to [-600, 600] / [-400, 400]
 *   updatedAt    ← updated_at ?? freshness_at ?? created_at
 *
 * The adapter is intentionally pure — no React hooks, no API calls.
 * Callers map over the TanStack Query results in a single pass.
 */

import type { KGNode, KGEdge } from '@/lib/knowledge-graph/types';
import {
  type SampleNode,
  type SampleEdge,
  type NodeKind,
} from '@/src/data/sample-graph';

// ---------------------------------------------------------------------------
// NodeKind bridge — wire (lowercase) → UI (PascalCase)
// ---------------------------------------------------------------------------

/**
 * The full set of UI node kinds the Knowledge Center currently renders.
 * Sourced from the existing palette so the adapter stays in sync if the
 * palette grows.
 */
const UI_KIND_SET: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'Repo',
  'Service',
  'Component',
  'ADR',
  'Idea',
  'Risk',
  'Task',
  'Test',
  'Agent',
  'Run',
  'Story',
  'Epic',
  'Command',
  'PRD',
]);

/**
 * Maps the wire-format lowercase kind to the UI PascalCase kind.
 * Anything we don't recognise gets pascal-cased so the palette still
 * has a colour (the palette gracefully handles unknown kinds via the
 * fallback colour in `graph-palette.ts`).
 */
function pascalCase(s: string): string {
  if (!s) return 'Unknown';
  const parts = s.replace(/[_-]+/g, ' ').split(/\s+/);
  return parts
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

/** Translate wire node_type → UI NodeKind. Falls back to PascalCase. */
function toNodeKind(wireType: string): NodeKind {
  if (!wireType) return 'Repo';
  const pascal = pascalCase(wireType);
  if (UI_KIND_SET.has(pascal as NodeKind)) {
    return pascal as NodeKind;
  }
  // Some wire kinds pluralise the noun (e.g. 'repos', 'services').
  // Strip a trailing 's' before pascal-casing so common ones still hit.
  const singular = wireType.endsWith('s') ? wireType.slice(0, -1) : wireType;
  const singularPascal = pascalCase(singular);
  if (UI_KIND_SET.has(singularPascal as NodeKind)) {
    return singularPascal as NodeKind;
  }
  // Unknown kind — still return a NodeKind so the canvas does not crash.
  // The palette's colour lookup uses an unknown-kind fallback colour.
  return (UI_KIND_SET.has(pascal as NodeKind) ? pascal : 'Repo') as NodeKind;
}

// ---------------------------------------------------------------------------
// Property bag helpers
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function asStringArray(v: unknown): ReadonlyArray<string> {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .map((x) => x);
  }
  if (typeof v === 'string' && v.length > 0) {
    // Accept comma-separated tags as a convenience for ingestion payloads.
    return v
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function initialsFromName(name: string): string {
  if (!name) return 'SY';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'SY';
  if (parts.length === 1) {
    const first = parts[0] ?? '';
    return first.slice(0, 2).toUpperCase() || 'SY';
  }
  const a = parts[0]?.[0] ?? '';
  const b = parts[parts.length - 1]?.[0] ?? '';
  return (a + b).toUpperCase() || 'SY';
}

/** Clamp and truncate a label. The canvas prefers short, single-line text. */
function buildLabel(name: string, fallback: string): string {
  const trimmed = (name || fallback || '').trim();
  if (!trimmed) return 'Untitled';
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 77) + '…';
}

/**
 * Deterministic, hash-based seed coordinate so the force simulation
 * has a stable starting layout for backend nodes (which don't ship
 * seedX/seedY like the offline sample does).
 */
function seedFromId(id: string): { x: number; y: number } {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Map to [-600, 600] x [-400, 400] — roughly mirrors the sample spread.
  const x = ((h >>> 0) % 1201) - 600;
  const y = (((h * 2654435761) >>> 0) % 801) - 400;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Public API — toSampleNode + toSampleEdge
// ---------------------------------------------------------------------------

/**
 * Adapter namespace — exposing the two mapping functions.
 * The page does `nodes.map(adapter.toSampleNode)`.
 */
export const adapter = {
  /**
   * Map a backend KGNode to the canvas's SampleNode shape.
   */
  toSampleNode(node: KGNode): SampleNode {
    const props = (node.properties ?? {}) as Record<string, unknown>;
    const owner = asString(props.owner) || 'system';
    const ownerRole = asString(props.owner_role);
    const kind = toNodeKind(node.node_type);

    // Tag resolution: explicit tags[] > category > format > []
    let tags: ReadonlyArray<string> = asStringArray(props.tags);
    if (tags.length === 0) {
      const cat = asString(props.category);
      if (cat) tags = [cat];
    }
    if (tags.length === 0) {
      const fmt = asString(props.format);
      if (fmt) tags = [fmt];
    }

    // Preview resolution: properties.preview > properties.summary > name slice.
    const preview =
      asString(props.preview) ||
      asString(props.summary) ||
      node.name.slice(0, 200);

    // href — direct URL on the node if ingestion populated one, else
    // route to the dedicated Knowledge Center page.
    const href = asString(props.url) || '/knowledge-center';

    // updatedAt — prefer updated_at, fall back to freshness_at / created_at.
    const updatedAt =
      node.updated_at || node.freshness_at || node.created_at || '';

    // label — keep full name when ≤80 chars, otherwise truncate.
    const label = buildLabel(node.name, asString(props.summary));

    // Stable seed coordinates from the id.
    const seed = seedFromId(node.id);

    // status — only set if the property is a non-empty string.
    const status = asString(props.status) || undefined;

    return {
      id: node.id,
      label,
      kind,
      seedX: seed.x,
      seedY: seed.y,
      author: {
        name: owner,
        role: ownerRole,
        initials: initialsFromName(owner),
      },
      updatedAt,
      tags,
      ...(status ? { status } : {}),
      preview,
      href,
    };
  },

  /**
   * Map a backend KGEdge to the canvas's SampleEdge shape.
   * The canvas needs `source` + `target` (not `from_node_id` /
   * `to_node_id`); we translate + cast `edge_type` to the closed-set
   * EdgeKind union, falling back to 'related_to' for unknowns (matches
   * the visual treatment for weak / contextual links).
   */
  toSampleEdge(edge: KGEdge): SampleEdge {
    const props = (edge.properties ?? {}) as Record<string, unknown>;
    // Strength is 1–3; the canvas renders thickness from it.
    const rawStrength = props.strength;
    let strength: 1 | 2 | 3 = 2;
    if (typeof rawStrength === 'number') {
      const s = Math.max(1, Math.min(3, Math.round(rawStrength))) as 1 | 2 | 3;
      strength = s;
    }
    return {
      id: edge.id,
      source: edge.from_node_id,
      target: edge.to_node_id,
      kind: edge.edge_type as SampleEdge['kind'],
      strength,
    };
  },
} as const;