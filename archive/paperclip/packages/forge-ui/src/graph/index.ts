/**
 * @fora/forge-ui/graph — public surface (FORA-393 Plan 2).
 *
 * Subpath: `@fora/forge-ui/graph`. Re-exports the typed graph provider
 * contract, the four canvas components, the shared shell, the layout
 * adapter, the typed-artifact node renderer, and the text-equivalent list
 * view.
 */

export type {
  GraphDelta,
  GraphFamily,
  GraphFilter,
  GraphProvider,
  Unsubscribe,
} from "./provider";

export { filtersEqual } from "./provider";

export type {
  BaseGraphEdge,
  BaseGraphNode,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeNodeKind,
  ArchitectureEdge,
  ArchitectureNode,
  ArchitectureNodeKind,
  DependencyEdge,
  DependencyNode,
  DependencyNodeKind,
  AuditEdge,
  AuditNode,
  AuditNodeKind,
  GraphEdgeKind,
} from "./nodes";

export { TtlCache, SubscriberRegistry } from "./cache";
export type { TtlCacheOptions, CacheEntry, GraphDeltaNotification } from "./cache";

export {
  applyDagreLayout,
  applyAuditTimelineLayout,
  identityLayout,
} from "./layout";
export type { DagreDirection, DagreLayoutOptions, LayoutResult } from "./layout";

export {
  FAMILY_BADGE,
  FAMILY_GLYPH,
  FAMILY_LABEL,
  FAMILY_TOKENS,
  EDGE_KIND_STYLE,
  classifyEdgeKind,
} from "./palette";

export type { TypedArtifactNode, TypedArtifactNodeData } from "./typed-artifact-node";
export { TypedArtifactNodeComponent } from "./typed-artifact-node";

export { CanvasShell, VIRTUALIZE_THRESHOLD } from "./canvas-shell";
export type { CanvasShellProps, CanvasViewMode } from "./canvas-shell";

export { TextListView } from "./text-list-view";
export type { TextListViewProps } from "./text-list-view";

// Providers.
export {
  KnowledgeGraphProvider,
  InMemoryKnowledgeFetcher,
  JsonManifestKnowledgeFetcher,
  KNOWLEDGE_PROVIDER_ID,
} from "./providers/knowledge";
export type { KnowledgeFetcher } from "./providers/knowledge";

export {
  ArchitectureGraphProvider,
  InMemoryArchitectureFetcher,
  ARCHITECTURE_PROVIDER_ID,
} from "./providers/architecture";
export type { ArchitectureFetcher } from "./providers/architecture";

export {
  DependencyGraphProvider,
  InMemoryDependencyFetcher,
  aggregateEdges,
  EDGE_AGGREGATION_THRESHOLD,
  DEPENDENCY_PROVIDER_ID,
} from "./providers/dependency";
export type { DependencyFetcher } from "./providers/dependency";

export {
  AuditGraphProvider,
  InMemoryAuditFetcher,
  AUDIT_PROVIDER_ID,
  DEFAULT_AUDIT_POLL_MS,
} from "./providers/audit";
export type { AuditFetcher, AuditGraphProviderOptions } from "./providers/audit";

// Canvas components.
export { KnowledgeGraphCanvas } from "./canvases/knowledge";
export type { KnowledgeGraphCanvasProps } from "./canvases/knowledge";

export { ArchitectureGraphCanvas } from "./canvases/architecture";
export type { ArchitectureGraphCanvasProps } from "./canvases/architecture";

export { DependencyGraphCanvas } from "./canvases/dependency";
export type { DependencyGraphCanvasProps } from "./canvases/dependency";

export { AuditTimelineGraphCanvas } from "./canvases/audit-timeline";
export type { AuditTimelineGraphCanvasProps } from "./canvases/audit-timeline";
