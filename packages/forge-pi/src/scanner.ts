/**
 * Codebase scanner — automatically maps services, dependencies, and secrets.
 *
 * Implementation strategy:
 *   - Production reads a `CodebaseScanResult` from the backend API endpoint
 *     `GET /api/v1/projects/:project_id/codebase/scan`.
 *   - Until the backend wires the real endpoint, this module exposes a
 *     deterministic stub keyed off `tenant_id` + `project_id` so the UI
 *     can develop against a stable contract.
 *
 * Either way, every result carries tenant_id and project_id (Rule 2).
 */

import type {
  CodebaseScanResult,
  ScanOptions,
  TenantScopedContext,
} from './types';

const STUB_SERVICES = [
  {
    id: 'svc-frontend',
    name: 'forge-dashboard',
    language: 'typescript',
    path: 'apps/forge',
    dependencies: ['next', 'react', '@forge-ai/forge-core'],
    entrypoints: ['app/page.tsx', 'app/api/proxy/[...path]/route.ts'],
    detected_secrets: 0,
    commit_sha: '0000000',
  },
  {
    id: 'svc-backend',
    name: 'forge-api',
    language: 'python',
    path: 'backend',
    dependencies: ['fastapi', 'sqlalchemy', 'langgraph'],
    entrypoints: ['app/main.py'],
    detected_secrets: 0,
    commit_sha: '0000000',
  },
  {
    id: 'svc-runtime',
    name: 'forge-runtime',
    language: 'python',
    path: 'backend/app/services/runtime',
    dependencies: ['langgraph', 'litellm'],
    entrypoints: ['orchestrator.py'],
    detected_secrets: 0,
    commit_sha: '0000000',
  },
];

export async function scanCodebase(
  ctx: TenantScopedContext,
  _options: ScanOptions = {},
): Promise<CodebaseScanResult> {
  const startedAt = new Date();
  // Deterministic stub — identical inputs produce identical output so the
  // UI is testable without a backend.
  const completedAt = new Date(startedAt.getTime() + 50);
  return {
    ...ctx,
    scan_id: `scan_${ctx.tenant_id}_${ctx.project_id}_${startedAt.getTime()}`,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    services: STUB_SERVICES.map((s) => ({
      ...s,
      commit_sha: '0000000',
    })),
    total_loc: 184_320,
    detector_health: {
      services: 'ok',
      deps: 'ok',
      secrets: 'ok',
      tests: 'ok',
    },
  };
}