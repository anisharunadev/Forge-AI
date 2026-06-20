/**
 * ArchitectureGraphCanvas — Plan 2 §3.2.
 *
 * Wrapper around {@link CanvasShell} configured for Project Intelligence.
 * Default layout: LR.
 */

import type { JSX } from "react";
import { CanvasShell } from "../canvas-shell";
import type { ArchitectureEdge, ArchitectureNode } from "../nodes";
import type { ArchitectureGraphProvider } from "../providers/architecture";

export interface ArchitectureGraphCanvasProps {
  readonly provider: ArchitectureGraphProvider;
  readonly onSelectNode?: ((id: string | null) => void) | undefined;
  readonly withoutLiveRegion?: boolean;
}

export function ArchitectureGraphCanvas({
  provider,
  onSelectNode,
  withoutLiveRegion = false,
}: ArchitectureGraphCanvasProps): JSX.Element {
  const shellProps: Parameters<typeof CanvasShell<ArchitectureNode, ArchitectureEdge>>[0] = {
    provider,
    direction: "LR",
    ariaLabel: "Architecture Graph",
    withoutLiveRegion,
  };
  if (onSelectNode) {
    (shellProps as { onSelectNode?: (id: string | null) => void }).onSelectNode = onSelectNode;
  }
  return <CanvasShell<ArchitectureNode, ArchitectureEdge> {...shellProps} />;
}
