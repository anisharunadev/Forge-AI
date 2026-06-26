/**
 * Architecture Center → @forge-ai/forge-pi integration (Step 45, ZONE 4-E).
 *
 * Powers the "Diagrams" tab and auto-discovered API contracts via the
 * forge-pi codebase scan. When the package is missing, returns null
 * so the Architecture Center renders its locally-authored diagrams.
 */

import type { CodebaseScanResult } from '@forge-ai/forge-pi';

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

export interface DiscoveredApiContract {
  service: string;
  endpoint_count: number;
  /** OpenAPI snippet (text) when available. */
  openapi_excerpt?: string;
}

/**
 * Generate a system diagram seed from the codebase scan.
 * Returns `null` when forge-pi is not installed.
 */
export async function generateDiagramSeed(): Promise<{
  scan: CodebaseScanResult;
  contracts: DiscoveredApiContract[];
} | null> {
  const pi = await getPi();
  if (!pi) return null;
  const scan = await pi.scanCodebase(ctx());
  const contracts: DiscoveredApiContract[] = scan.services.map((s) => ({
    service: s.name,
    endpoint_count: s.entrypoints.length,
  }));
  return { scan, contracts };
}