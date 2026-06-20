/**
 * TypedArtifactNode — the single shared React Flow node component.
 *
 * Plan 2 §4.2: "All nodes are typed components (Plan 4 §3) — there are no
 * raw HTML nodes." This is the only node renderer every canvas uses. The
 * shape is generic over the underlying artifact type so each canvas keeps
 * its strongly-typed data payload.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { JSX } from "react";
import { FAMILY_BADGE, FAMILY_GLYPH, FAMILY_LABEL, FAMILY_TOKENS } from "./palette";
import type { GraphFamily } from "./provider";
import { cn } from "../tokens/cn";

export interface TypedArtifactNodeData<F extends GraphFamily, A = unknown> {
  readonly family: F;
  readonly label: string;
  readonly subtitle?: string;
  readonly kind: string;
  readonly artifact?: A;
  readonly selected?: boolean;
  readonly sizeHint?: number;
  readonly bucketStart?: string;
  readonly timestamp?: string;
}

export interface TypedArtifactNode<F extends GraphFamily, A = unknown> {
  readonly id: string;
  readonly data: TypedArtifactNodeData<F, A>;
}

/** Looser variant React Flow's `nodeTypes` registry accepts. */
export type AnyTypedArtifactNode = TypedArtifactNode<GraphFamily, unknown>;

/**
 * React Flow node renderer. Renders a card with:
 *  - leading glyph (Plan 3 §5 WCAG 1.4.1 — color paired with shape)
 *  - label
 *  - subtitle (optional)
 *  - family badge top-right
 *  - selected ring
 *  - two handles (left for inbound, right for outbound)
 */
export function TypedArtifactNodeComponent(
  props: NodeProps,
): JSX.Element {
  const { data, selected } = props as NodeProps & { data: TypedArtifactNodeData<GraphFamily> };
  const tokens = FAMILY_TOKENS[data.family];
  return (
    <div
      role="treeitem"
      aria-selected={selected ? "true" : "false"}
      aria-label={`${FAMILY_LABEL[data.family]} ${data.kind}: ${data.label}`}
      data-forge-graph-node={data.family}
      data-forge-graph-kind={data.kind}
      className={cn(
        "rounded-md border shadow-elev-1 transition-shadow",
        "min-w-[180px] max-w-[260px] px-3 py-2",
        tokens.bg,
        tokens.border,
        tokens.text,
        selected ? `ring-2 ${tokens.ring}` : "",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !bg-ink-muted"
        aria-hidden="true"
      />
      <header className="flex items-center gap-2">
        <span aria-hidden="true" className="font-mono text-base leading-none">
          {FAMILY_GLYPH[data.family]}
        </span>
        <span className="flex-1 truncate text-body-sm font-semibold">
          {data.label}
        </span>
        <span
          className={cn(
            "ml-2 inline-flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-mono",
            "bg-surface-overlay text-ink-muted",
          )}
          aria-label={`${FAMILY_LABEL[data.family]} family`}
        >
          {FAMILY_BADGE[data.family]}
        </span>
      </header>
      {data.subtitle ? (
        <p className="mt-1 truncate text-caption text-ink-muted">{data.subtitle}</p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !bg-ink-muted"
        aria-hidden="true"
      />
    </div>
  );
}
