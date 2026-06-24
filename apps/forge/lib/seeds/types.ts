/**
 * Seeds domain types — mirror `backend/app/schemas/seeds.py` (Plan F).
 *
 * The Pydantic DTOs in `backend/app/schemas/seeds.py` are the source of
 * truth. These TypeScript shapes track them 1:1 so server-rendered and
 * client-rendered surfaces (Plan G `DemoBanner`, Plan H `/admin/seeds`)
 * consume the same payload without re-mapping.
 *
 * Field names track the wire JSON exactly (snake_case). The union
 * literals are widened slightly to cover `status: 'drift_detected'`
 * (Plan G banner state) and `tenant_type: 'customer_seed'` (future
 * content packs) without locking us out of new variants the backend
 * adds later.
 */

// ---------------------------------------------------------------------------
// Manifest DTOs
// ---------------------------------------------------------------------------

export type SeedOperation = 'apply' | 'reset' | 'rollback' | 'status' | 'diff';

/** Backend `SeedRunRead.status` literal + a sentinel used by the UI. */
export type SeedRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'drift_detected';

/** Backend `SeedManifestSummary.tenant_type` + future content pack kind. */
export type SeedTenantType = 'demo' | 'reference' | 'production' | 'customer_seed';

export interface SeedManifestSummary {
  name: string;
  version: number;
  tenant_type: SeedTenantType;
  description: string | null;
  depends_on: string[];
}

export interface SeedDataFileRead {
  file: string;
  table: string;
  order: number;
  idempotency_key: string[];
  description: string | null;
}

export interface SeedManifestRead extends SeedManifestSummary {
  data_files: SeedDataFileRead[];
  row_counts_expected: Record<string, number>;
  /** Free-form knobs; today only `{ allow_in_prod: boolean }` is defined. */
  production_safety: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Run + inspection DTOs
// ---------------------------------------------------------------------------

export interface SeedRunRead {
  id: string;
  seed_name: string;
  manifest_version: number;
  operation: SeedOperation;
  status: SeedRunStatus;
  env: string;
  triggered_by: string;
  actor_id: string | null;
  tenant_id: string | null;
  row_counts: Record<string, number>;
  dropped_rows: Record<string, number>;
  checksum_after: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  /** Per-backend Pydantic: `dict[str, str]`. */
  error: Record<string, string>;
}

export type SeedDrift = 'none' | 'checksum' | 'row_count' | 'unknown';

export interface SeedStatusRead {
  seed_name: string;
  applied: boolean;
  applied_version: number | null;
  last_run_at: string | null;
  /** Backend exposes this as `str`; we narrow to the same union. */
  last_run_status: SeedRunStatus | null;
  checksum: string | null;
  checksum_match: boolean;
  drift: SeedDrift;
  row_counts: Record<string, number>;
  production_safe: boolean;
}

export interface SeedDiffRead {
  seed_name: string;
  checksum_match: boolean;
  /** Tuple-as-record from Pydantic `dict[str, tuple[int, int]]`. */
  row_count_changes: Record<string, [number, number]>;
  missing_files: string[];
  extra_rows: Record<string, number>;
  summary: string;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface SeedApplyRequest {
  allow_in_prod?: boolean;
}

export type SeedResetScope = 'demo_only' | 'all';

export interface SeedResetRequest {
  scope: SeedResetScope;
}

// ---------------------------------------------------------------------------
// UI view-model — consumed by `DemoBanner` (Plan G) and `/admin/seeds`
// (Plan H). Not a wire shape; derived from `SeedStatusRead`.
// ---------------------------------------------------------------------------

export type DemoChecksumStatus = 'match' | 'drift' | 'unknown';

export interface DemoSeedStatus {
  isDemoTenant: boolean;
  seedName: string;
  applied: boolean;
  rowCount: number;
  checksumStatus: DemoChecksumStatus;
  lastRunAt: string | null;
}
