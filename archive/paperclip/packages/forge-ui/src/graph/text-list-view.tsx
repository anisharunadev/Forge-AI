/**
 * Text-equivalent list view — Plan 2 §6 final bullet.
 *
 * "A text equivalent view is present (the same data as a structured list,
 *  one node per row) — it is the screen-reader default and the keyboard nav
 *  alternative."
 *
 * This is the alternative render mode. It's mounted alongside every canvas
 * (as a visually-hidden list for screen readers, and as a real list for the
 * "List view" toggle). The data shape is the same — one node per row, with
 * the edges listed under each source.
 */

import type { JSX } from "react";
import type { BaseGraphEdge, BaseGraphNode } from "./nodes";
import { FAMILY_LABEL, FAMILY_TOKENS } from "./palette";
import { cn } from "../tokens/cn";

export interface TextListViewProps<N extends BaseGraphNode, E extends BaseGraphEdge> {
  readonly nodes: ReadonlyArray<N>;
  readonly edges: ReadonlyArray<E>;
  /** Accessible label for the surrounding list region. */
  readonly ariaLabel: string;
  /** When `true`, the list is visually hidden — only the screen reader sees it. */
  readonly visuallyHidden?: boolean;
  /** When provided, called with the clicked node id. */
  readonly onSelectNode?: ((id: string) => void) | undefined;
  /** When provided, called with the clicked edge id. */
  readonly onSelectEdge?: ((id: string) => void) | undefined;
}

function kindOf<N extends BaseGraphNode>(node: N): string {
  return (node as unknown as { kind?: string }).kind ?? "node";
}

export function TextListView<N extends BaseGraphNode, E extends BaseGraphEdge>({
  nodes,
  edges,
  ariaLabel,
  visuallyHidden = false,
  onSelectNode,
  onSelectEdge,
}: TextListViewProps<N, E>): JSX.Element {
  const edgesBySource = groupEdgesBySource(edges);
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      data-forge-graph-text-list=""
      className={cn(
        "w-full",
        visuallyHidden ? "sr-only" : "rounded-md border border-surface-border bg-surface p-3",
      )}
    >
      <ol className="space-y-2" role="list">
        {nodes.map((node) => {
          const tokens = FAMILY_TOKENS[node.family];
          const outgoing = edgesBySource.get(node.id) ?? [];
          const nodeKind = kindOf(node);
          return (
            <li
              key={node.id}
              role="listitem"
              data-forge-graph-text-list-item={node.id}
              className="rounded-sm border border-surface-border bg-surface-overlay p-2"
            >
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left",
                  "hover:bg-surface focus:outline-none focus-visible:ring-2",
                  tokens.text,
                )}
                onClick={onSelectNode ? () => onSelectNode(node.id) : undefined}
                aria-label={`${FAMILY_LABEL[node.family]} ${nodeKind}: ${node.label}`}
              >
                <span className={cn("inline-block h-2 w-2 rounded-full", tokens.bg)} aria-hidden="true" />
                <span className="text-body-sm font-semibold">{node.label}</span>
                <span className="ml-auto text-caption text-ink-muted">
                  {FAMILY_LABEL[node.family]} · {nodeKind}
                </span>
              </button>
              {node.subtitle ? (
                <p className="ml-4 mt-1 text-caption text-ink-muted">{node.subtitle}</p>
              ) : null}
              {outgoing.length > 0 ? (
                <ul className="ml-4 mt-1 space-y-0.5" role="list">
                  {outgoing.map((edge) => {
                    const target = nodes.find((n) => n.id === edge.target);
                    return (
                      <li key={edge.id} role="listitem" className="text-caption text-ink-muted">
                        <button
                          type="button"
                          className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
                          onClick={onSelectEdge ? () => onSelectEdge(edge.id) : undefined}
                          aria-label={`Edge ${edge.kind} from ${node.label} to ${target?.label ?? edge.target}`}
                        >
                          ↳ {edge.kind} → {target?.label ?? edge.target}
                          {edge.annotation ? ` (${edge.annotation})` : ""}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function groupEdgesBySource<E extends BaseGraphEdge>(edges: ReadonlyArray<E>): Map<string, E[]> {
  const m = new Map<string, E[]>();
  for (const edge of edges) {
    const arr = m.get(edge.source);
    if (arr) arr.push(edge);
    else m.set(edge.source, [edge]);
  }
  return m;
}
