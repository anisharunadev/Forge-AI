/**
 * DependencyGraphCanvas — Plan 2 §3.3.
 *
 * Wrapper around {@link CanvasShell} configured for the Development Center.
 * Default layout: TB (top-to-bottom). Edge aggregation is applied inside
 * the provider when more than 500 edges are returned.
 */

import type { JSX } from "react";
import { CanvasShell } from "../canvas-shell";
import type { DependencyEdge, DependencyNode } from "../nodes";
import type { DependencyGraphProvider } from "../providers/dependency";

export interface DependencyGraphCanvasProps {
  readonly provider: DependencyGraphProvider;
  readonly onSelectNode?: ((id: string | null) => void) | undefined;
  readonly withoutLiveRegion?: boolean;
}

export function DependencyGraphCanvas({
  provider,
  onSelectNode,
  withoutLiveRegion = false,
}: DependencyGraphCanvasProps): JSX.Element {
  const shellProps: Parameters<typeof CanvasShell<DependencyNode, DependencyEdge>>[0] = {
    provider,
    direction: "TB",
    ariaLabel: "Dependency Graph",
    withoutLiveRegion,
  };
  if (onSelectNode) {
    (shellProps as { onSelectNode?: (id: string | null) => void }).onSelectNode = onSelectNode;
  }
  return <CanvasShell<DependencyNode, DependencyEdge> {...shellProps} />;
}
