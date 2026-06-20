/**
 * CycleExplainerPanel — Plan 2 §3.3 cycle click affordance.
 *
 * Renders a side panel that names each module in the cycle, the path the
 * analyzer traced, and the reason. The Dependency Graph highlights the
 * cycle with a red dashed boundary (the canvas owns the visual; the panel
 * owns the explanation).
 *
 * The panel is keyboard reachable (Plan 3 §5) and announces the cycle id
 * to screen readers via the heading.
 */

import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { DependencyCycle, GraphTarget } from "./development";
import { ShowInGraph } from "./show-in-graph";

export interface CycleExplainerPanelProps {
  readonly cycle: DependencyCycle | null;
  readonly onClose?: () => void;
  readonly onNavigateToGraph?: (target: GraphTarget) => void;
  readonly className?: string;
}

export function CycleExplainerPanel({
  cycle,
  onClose,
  onNavigateToGraph,
  className,
}: CycleExplainerPanelProps): JSX.Element {
  if (cycle === null) {
    return (
      <aside
        role="status"
        aria-label="Cycle explainer"
        data-testid="cycle-explainer-empty"
        className={cn(
          "rounded-md border border-surface-border bg-surface-raised px-4 py-3 text-body-sm text-ink-muted",
          className,
        )}
      >
        Select a cycle on the Dependency Graph to see the analyzer's trace.
      </aside>
    );
  }

  return (
    <aside
      role="region"
      aria-labelledby={`cycle-${cycle.id}-title`}
      data-testid={`cycle-explainer-${cycle.id}`}
      className={cn(
        "rounded-md border border-brand-danger bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-caption uppercase tracking-wider text-brand-danger">
            Cycle detected
          </p>
          <h3
            id={`cycle-${cycle.id}-title`}
            className="text-heading-3 font-semibold text-ink-default"
          >
            {cycle.id}
          </h3>
        </div>
        <Badge tone="danger">{cycle.modules.length} modules</Badge>
      </header>

      {cycle.reason && (
        <p className="mt-3 text-body-sm text-ink-default">{cycle.reason}</p>
      )}

      <section className="mt-4" aria-label="Modules in cycle">
        <h4 className="text-body-sm font-medium text-ink-muted">Modules in cycle</h4>
        <ol className="mt-2 space-y-1 font-mono text-caption">
          {cycle.modules.map((m, i) => (
            <li
              key={`${i}-${m}`}
              className="flex items-center gap-2 rounded-sm border border-surface-border bg-surface-raised px-2 py-1"
            >
              <span className="text-ink-subtle">{i + 1}.</span>
              <span className="text-ink-default">{m}</span>
              {onNavigateToGraph && (
                <ShowInGraph
                  target={{ canvas: "dependency", nodeId: m }}
                  onNavigate={onNavigateToGraph}
                  label="Show"
                  className="ml-auto"
                />
              )}
            </li>
          ))}
        </ol>
      </section>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cycle explainer"
          className="mt-4 text-body-sm text-ink-muted underline hover:text-ink-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Close
        </button>
      )}
    </aside>
  );
}
