/**
 * Command Center → forge-pi entry points (Step 45, ZONE 4-G).
 *
 * "Run pi scan" → codebase scan
 * "Cluster feedback" → customer voice clustering
 *
 * Both are exposed as named actions on the Command Center action bar so
 * they appear alongside the existing forge-core commands.
 */

import type { CodebaseScanResult, CustomerCluster } from '@forge-ai/forge-pi';

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

export interface PiScanOutput {
  scan: CodebaseScanResult | null;
  ran: boolean;
}

/** "Run pi scan" — triggers a codebase scan from the Command Center. */
export async function runPiScan(): Promise<PiScanOutput> {
  const pi = await getPi();
  if (!pi) return { scan: null, ran: false };
  const scan = await pi.scanCodebase(ctx());
  return { scan, ran: true };
}

export interface ClusterFeedbackInput {
  ticket_id: string;
  body: string;
  severity: number;
}

export interface ClusterFeedbackOutput {
  clusters: CustomerCluster[];
  ran: boolean;
}

/** "Cluster feedback" — invokes the customer voice clustering. */
export async function clusterFeedback(
  tickets: ClusterFeedbackInput[],
): Promise<ClusterFeedbackOutput> {
  const pi = await getPi();
  if (!pi) return { clusters: [], ran: false };
  const clusters = await pi.clusterCustomerVoice(ctx(), tickets);
  return { clusters, ran: true };
}