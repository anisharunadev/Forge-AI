/**
 * BlastRadiusPanel — Plan 2 §3.3 blast-radius affordance + Plan 1 §3.7 #6.
 *
 * Shows the selected source modules and the modules transitively reached
 * via `imports` edges. The list is computed via {@link computeBlastRadius}
 * (pure, cycle-safe). The "Show in graph" affordance is wired per source.
 */

import { useMemo, type JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { DependencyEdge, DependencyNode } from "../graph/nodes";
import type { GraphTarget } from "./development";
import { ShowInGraph } from "./show-in-graph";
import { computeBlastRadius, collectImportGraph } from "./blast-radius";

export interface BlastRadiusPanelProps {
  readonly sources: ReadonlyArray<string>;
  readonly nodes: ReadonlyArray<DependencyNode>;
  readonly edges: ReadonlyArray<DependencyEdge>;
  readonly onNavigate?: (target: GraphTarget) => void;
  readonly className?: string;
}

export function BlastRadiusPanel({
  sources,
  nodes,
  edges,
  onNavigate,
  className,
}: BlastRadiusPanelProps): JSX.Element {
  const { moduleCount, edgeCount } = useMemo(() => {
    const { edges: importEdges } = collectImportGraph(nodes, edges);
    return {
      moduleCount: nodes.filter((n) => n.kind === "module").length,
      edgeCount: importEdges.length,
    };
  }, [nodes, edges]);

  const result = useMemo(
    () => computeBlastRadius(sources, nodes, edges),
    [sources, nodes, edges],
  );

  if (sources.length === 0) {
    return (
      <aside
        role="status"
        aria-label="Blast radius"
        data-testid="blast-radius-empty"
        className={cn(
          "rounded-md border border-surface-border bg-surface-raised px-4 py-3 text-body-sm text-ink-muted",
          className,
        )}
      >
        Select a module on the Dependency Graph to compute its blast radius.
        Graph has {moduleCount} modules and {edgeCount} import edges.
      </aside>
    );
  }

  return (
    <aside
      role="region"
      aria-labelledby="blast-radius-title"
      data-testid="blast-radius"
      className={cn("rounded-md border border-surface-border bg-surface p-4 shadow-elev-1", className)}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-caption uppercase tracking-wider text-ink-muted">Blast radius</p>
          <h3 id="blast-radius-title" className="text-heading-3 font-semibold text-ink-default">
            {result.reachable.length} module{result.reachable.length === 1 ? "" : "s"} reachable
          </h3>
        </div>
        <Badge tone="primary">
          {result.traversedEdges.length} edge{result.traversedEdges.length === 1 ? "" : "s"}
        </Badge>
      </header>

      <section className="mt-3" aria-label="Sources">
        <h4 className="text-body-sm font-medium text-ink-muted">Sources</h4>
        <ul className="mt-1 space-y-1 font-mono text-caption">
          {result.sources.map((s) => (
            <li key={s} className="flex items-center gap-2 rounded-sm border border-surface-border bg-surface-raised px-2 py-1">
              <span className="text-ink-default">{s}</span>
              {onNavigate && (
                <ShowInGraph
                  target={{ canvas: "dependency", nodeId: s }}
                  onNavigate={onNavigate}
                  label="Show"
                  className="ml-auto"
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-3" aria-label="Reachable">
        <h4 className="text-body-sm font-medium text-ink-muted">Reachable</h4>
        {result.reachable.length === 0 ? (
          <p className="mt-1 text-body-sm text-ink-muted">No transitive imports.</p>
        ) : (
          <ul className="mt-1 grid grid-cols-1 gap-1 font-mono text-caption sm:grid-cols-2">
            {result.reachable.map((m) => (
              <li
                key={m}
                className="flex items-center gap-2 rounded-sm border border-surface-border bg-surface-raised px-2 py-1"
              >
                <span className="text-ink-default">{m}</span>
                {onNavigate && (
                  <ShowInGraph
                    target={{ canvas: "dependency", nodeId: m }}
                    onNavigate={onNavigate}
                    label="Show"
                    className="ml-auto"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
