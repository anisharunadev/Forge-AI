/**
 * Typed REST fetchers for the Architecture Center (F-301..F-310 + M5-G4).
 *
 * Thin wrappers around the `api` transport in `lib/api/client.ts` so the
 * hooks in `useArchitecture.ts` stay declarative. Mirrors the contract
 * declared in `backend/app/api/v1/architecture/*` plus the new
 * `security_reports.py` router added in M5.
 *
 * Conventions:
 *   - **snake_case wire shapes** — same as `lib/architecture/types.ts`.
 *     Callers convert to camelCase in components (rule 4: typed artifacts
 *     never leak).
 *   - **Filter → querystring** — `buildQuery()` strips undefined / null
 *     so the backend only sees the constraints the caller set.
 *   - **Tenant scoping (Rule 2)** — every list takes `project_id`
 *     (or tenant header is implicit via the auth token); callers must
 *     pass it explicitly when the API requires it.
 */

import { api } from '@/lib/api/client';
import type {
  SecurityPosture,
  SecurityReport,
  SecurityReportCreateInput,
  SecurityReportFilter,
  SecurityReportListResponse,
  SecurityReportStatusUpdateInput,
} from '@/lib/architecture/types';

// ---------------------------------------------------------------------------
// Internal: querystring builder (mirrors useArchitecture's buildQuery).
// ---------------------------------------------------------------------------

function buildQuery(filter?: Record<string, unknown>): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Security Reports (M5-G4) — list / getById / create / updateStatus / posture.
// ---------------------------------------------------------------------------

/**
 * `GET /architecture/security-reports?…`
 * Filterable by severity, category, status, project_id.
 */
export async function listSecurityReports(
  filter?: SecurityReportFilter,
): Promise<SecurityReportListResponse> {
  return api.get<SecurityReportListResponse>(
    `/architecture/security-reports${buildQuery({ ...(filter ?? {}) })}`,
  );
}

/**
 * `GET /architecture/security-reports/{id}` — single record.
 */
export async function getSecurityReportById(id: string): Promise<SecurityReport> {
  return api.get<SecurityReport>(`/architecture/security-reports/${id}`);
}

/**
 * `POST /architecture/security-reports` — create a new finding. The
 * backend may auto-link the source ADR via `source_adr_id` so the
 * `SecurityFindingList` can pivot into the ADR viewer.
 */
export async function createSecurityReport(
  input: SecurityReportCreateInput,
): Promise<SecurityReport> {
  return api.post<SecurityReport>('/architecture/security-reports', input);
}

/**
 * `PATCH /architecture/security-reports/{id}/status` — status workflow
 * (open → mitigating → closed / accepted).
 */
export async function updateSecurityReportStatus(
  id: string,
  input: SecurityReportStatusUpdateInput,
): Promise<SecurityReport> {
  return api.patch<SecurityReport>(
    `/architecture/security-reports/${id}/status`,
    input,
  );
}

/**
 * `GET /architecture/security-reports/posture` — aggregate posture for
 * the project. Powers the SecurityPostureCard KPI strip.
 */
export async function getSecurityPosture(
  project_id?: string,
): Promise<SecurityPosture> {
  return api.get<SecurityPosture>(
    `/architecture/security-reports/posture${buildQuery({ project_id })}`,
  );
}