/**
 * InFlightPatches — Plan 1 §3.7 acceptance criterion #2.
 *
 * Wraps `PatchRenderer` for the per-Story Patch list. Each patch is shown
 * in the `summary` variant by default, with a "View diff" toggle that
 * flips to `panel`. The "Show in graph" affordance points at the
 * Dependency Graph node of the first touched module (per Plan 4 §3.5
 * "Show in graph → Dependency Graph, centered on the affected modules").
 */

import { useCallback, useState, type JSX } from "react";
import { Button } from "../primitives/button";
import { PatchRenderer } from "../typed-artifacts/patch";
import type { Patch } from "../typed-artifacts/types";
import { cn } from "../tokens/cn";
import type { GraphTarget } from "./development";
import { ShowInGraph } from "./show-in-graph";

export interface InFlightPatchesProps {
  readonly patches: ReadonlyArray<Patch>;
  readonly onNavigate?: (target: GraphTarget) => void;
  readonly className?: string;
}

export function InFlightPatches({
  patches,
  onNavigate,
  className,
}: InFlightPatchesProps): JSX.Element {
  if (patches.length === 0) {
    return (
      <div
        role="status"
        data-testid="in-flight-patches-empty"
        className={cn(
          "rounded-md border border-surface-border bg-surface-raised px-4 py-6 text-center text-body-sm text-ink-muted",
          className,
        )}
      >
        No in-flight patches. The Developer stage is caught up.
      </div>
    );
  }
  return (
    <ul
      aria-label="In-flight patches"
      data-testid="in-flight-patches"
      className={cn("space-y-3", className)}
    >
      {patches.map((p) => (
        <li key={p.id}>
          <PatchRow patch={p} {...(onNavigate ? { onNavigate } : {})} />
        </li>
      ))}
    </ul>
  );
}

function PatchRow({
  patch,
  onNavigate,
}: {
  patch: Patch;
  onNavigate?: (target: GraphTarget) => void;
}): JSX.Element {
  const [showDiff, setShowDiff] = useState(false);
  const handleToggle = useCallback(() => setShowDiff((v) => !v), []);
  const targetModuleId = patch.files?.[0]?.path ?? patch.id;
  return (
    <div data-testid={`in-flight-patch-${patch.id}`} className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleToggle}
          aria-pressed={showDiff}
          data-testid={`in-flight-patch-toggle-${patch.id}`}
        >
          {showDiff ? "Hide diff" : "View diff"}
        </Button>
        {onNavigate && (
          <ShowInGraph
            target={{ canvas: "dependency", nodeId: targetModuleId }}
            onNavigate={onNavigate}
            label="Show in Dependency Graph"
          />
        )}
      </div>
      <PatchRenderer artifact={patch} variant={showDiff ? "panel" : "summary"} />
    </div>
  );
}
