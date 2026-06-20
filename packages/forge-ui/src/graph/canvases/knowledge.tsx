/**
 * KnowledgeGraphCanvas — Plan 2 §3.1.
 *
 * Wrapper around {@link CanvasShell} configured for the Knowledge Center.
 * Default layout: LR. Reads from a {@link KnowledgeGraphProvider}.
 */

import type { JSX } from "react";
import { CanvasShell } from "../canvas-shell";
import type { KnowledgeEdge, KnowledgeNode } from "../nodes";
import type { KnowledgeGraphProvider } from "../providers/knowledge";

export interface KnowledgeGraphCanvasProps {
  readonly provider: KnowledgeGraphProvider;
  readonly onSelectNode?: ((id: string | null) => void) | undefined;
  readonly withoutLiveRegion?: boolean;
}

export function KnowledgeGraphCanvas({
  provider,
  onSelectNode,
  withoutLiveRegion = false,
}: KnowledgeGraphCanvasProps): JSX.Element {
  const shellProps: Parameters<typeof CanvasShell<KnowledgeNode, KnowledgeEdge>>[0] = {
    provider,
    direction: "LR",
    ariaLabel: "Knowledge Graph",
    withoutLiveRegion,
  };
  if (onSelectNode) {
    (shellProps as { onSelectNode?: (id: string | null) => void }).onSelectNode = onSelectNode;
  }
  return <CanvasShell<KnowledgeNode, KnowledgeEdge> {...shellProps} />;
}
