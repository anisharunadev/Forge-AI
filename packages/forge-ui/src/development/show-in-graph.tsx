/**
 * ShowInGraph — Plan 1 §3.7 acceptance criterion #9.
 *
 * "Show in graph" affordance: a button rendered next to any ADR / Patch /
 * Component that, when activated, switches the active canvas and centers on
 * the target node. The actual canvas swap + center-on-node is the host's
 * responsibility; the affordance is a typed event emitter.
 *
 * The button is keyboard accessible (Plan 3 §5): Enter / Space activate.
 * The label includes the destination canvas so screen readers announce it
 * (e.g. "Show ADR-12 in Architecture Graph").
 */

import { useCallback, type JSX } from "react";
import { Button } from "../primitives/button";
import type { GraphTarget } from "./development";

export interface ShowInGraphProps {
  readonly target: GraphTarget;
  readonly onNavigate: (target: GraphTarget) => void;
  /** Override the visible label; default = "Show in <Canvas> Graph". */
  readonly label?: string;
  readonly className?: string;
}

function defaultLabel(target: GraphTarget): string {
  return `Show in ${target.canvas === "architecture" ? "Architecture" : "Dependency"} Graph`;
}

export function ShowInGraph({
  target,
  onNavigate,
  label,
  className,
}: ShowInGraphProps): JSX.Element {
  const handleClick = useCallback(() => onNavigate(target), [onNavigate, target]);
  const visible = label ?? defaultLabel(target);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      aria-label={`${visible} (target node ${target.nodeId})`}
      data-testid={`show-in-graph-${target.canvas}-${target.nodeId}`}
      className={className}
    >
      {visible}
    </Button>
  );
}
