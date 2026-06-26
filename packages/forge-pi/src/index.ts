/**
 * @forge-ai/forge-pi — Forge Product Intelligence
 *
 * The intelligence layer of the Forge AI Agent OS. Every export is a typed
 * surface that carries `tenant_id` and `project_id` (Forge Rule 2).
 *
 * This package is OPTIONAL — every Forge consumer degrades gracefully to
 * in-memory stubs when @forge-ai/forge-pi is not installed.
 */

export type {
  TenantScopedContext,
  ScannedService,
  CodebaseScanResult,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  KnowledgeGraph,
  IdeaScore,
  IdeaScoreReasoning,
  CustomerCluster,
  MarketSignal,
  PrdDraft,
  ScanOptions,
} from './types';

// Re-export every capability as a named function so consumers can do
//   import { scanCodebase, scoreIdea } from '@forge-ai/forge-pi';
export { scanCodebase } from './scanner';
export { buildKnowledgeGraph, queryKnowledgeGraph } from './knowledge-graph';
export { scoreIdea } from './idea-scorer';
export { clusterCustomerVoice } from './customer-voice';
export { extractMarketSignals } from './market-signals';
export { generatePrd } from './prd-generator';

/**
 * Default feature flag — true when the package is wired into the consuming
 * Forge surface. Consumers can read this to decide whether to invoke the
 * real implementation or fall back to local stub data.
 */
export const FORGE_PI_INSTALLED = true as const;