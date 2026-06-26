/**
 * Project Intelligence → @forge-ai/forge-pi integration (Step 45, ZONE 4-B).
 *
 * Powers:
 *   - "Artifact tree" — driven by `scanCodebase`
 *   - Knowledge graph — driven by `buildKnowledgeGraph` / `queryKnowledgeGraph`
 *   - "Project at a glance" — uses scan metrics
 *
 * Graceful degradation: returns null when the package is not installed.
 */

import type {
  CodebaseScanResult,
  KnowledgeGraph,
} from '@forge-ai/forge-pi';

import { DEV_TENANT_UUID } from '../../config/dev-seeds';

const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';

let _pi: typeof import('@forge-ai/forge-pi') | null = null;
async function getPi(): Promise<typeof import('@forge-ai/forge-pi') | null> {
  if (_pi) return _pi;
  try {
    _pi = await import('@forge-ai/forge-pi');
    return _pi;
  } catch {
    return null;
  }
}

function ctx() {
  return { tenant_id: DEV_TENANT_UUID, project_id: DEV_PROJECT_UUID };
}

/** Run a codebase scan via forge-pi. Returns null when not installed. */
export async function runCodebaseScan(): Promise<CodebaseScanResult | null> {
  const pi = await getPi();
  if (!pi) return null;
  return pi.scanCodebase(ctx());
}

/** Build / refresh the knowledge graph. */
export async function refreshKnowledgeGraph(): Promise<KnowledgeGraph | null> {
  const pi = await getPi();
  if (!pi) return null;
  return pi.buildKnowledgeGraph(ctx());
}

/**
 * Query the knowledge graph — used by the Project Intelligence
 * "artifact tree" and by Co-pilot's `@entity` mention resolver.
 */
export async function queryGraph(
  query: Parameters<typeof import('@forge-ai/forge-pi').queryKnowledgeGraph>[1] = {},
): Promise<KnowledgeGraph | null> {
  const pi = await getPi();
  if (!pi) return null;
  return pi.queryKnowledgeGraph(ctx(), query);
}