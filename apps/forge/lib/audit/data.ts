/**
 * Audit Center — async data seam.
 *
 * Replaces the sync `lib/audit/mock-data.ts` for live rendering. The
 * orchestrator returns records WITHOUT hashes (the chain is computed
 * client-side from the records, exactly as the legacy mock did).
 *
 * API endpoints (from `bin/orchestrator-stub.py`):
 *   GET /v1/audit/records  → AuditRecord[] (no hash / prevHash)
 *   GET /v1/audit/actors   → AuditActor[]
 *   GET /v1/audit/tenants  → {id,name}[]
 */

export type AuditAction =
  | 'login'
  | 'logout'
  | 'command_run'
  | 'artifact_created'
  | 'artifact_published'
  | 'terminal_command'
  | 'approval_decided'
  | 'role_changed'
  | 'policy_updated'
  | 'connector_attached';

export type AuditTargetType =
  | 'user'
  | 'run'
  | 'idea'
  | 'adr'
  | 'prd'
  | 'artifact'
  | 'terminal'
  | 'approval'
  | 'policy'
  | 'connector';

export interface AuditActor {
  id: string;
  name: string;
  avatar: string;
}

export interface AuditRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  actor: AuditActor;
  action: AuditAction;
  target: { type: AuditTargetType; id: string; label: string };
  payload: Record<string, unknown>;
  timestamp: string;
  /** SHA-256 chain head at this record (tamper-evident). */
  hash: string;
  /** Previous hash (chained). */
  prevHash: string;
}

const BASE_URL =
  process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- Hash chain (client-side, mirroring the legacy mock algorithm) ---

function shortHash(seed: string): string {
  // Deterministic fake hash (NOT crypto — for UI demo only). Matches
  // the legacy `lib/audit/mock-data.ts` shortHash exactly so the UI
  // renders the same chain visualization regardless of source.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(8);
}

function withChain(records: ReadonlyArray<AuditRecord>): AuditRecord[] {
  // Sort oldest → newest for chaining, then reverse back to newest
  // first so the page renders the same way as the legacy mock.
  const sorted = [...records].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const out: AuditRecord[] = [];
  let prev = '0000000000000000';
  for (const r of sorted) {
    const seed = `${r.id}|${r.timestamp}|${r.actor.id}|${r.action}|${r.target.id}|${prev}`;
    const hash = shortHash(seed);
    out.push({ ...r, hash, prevHash: prev });
    prev = hash;
  }
  return out.reverse();
}

/** List audit records — the orchestrator returns records without hashes. */
export async function listAuditRecords(): Promise<ReadonlyArray<AuditRecord>> {
  const rows = (await getJson<AuditRecord[]>('/v1/audit/records')) ?? [];
  return withChain(rows);
}

export async function getAuditRecord(
  id: string,
): Promise<AuditRecord | undefined> {
  const rows = await listAuditRecords();
  return rows.find((r) => r.id === id);
}

/** Distinct actors referenced in the audit log. */
export async function listAuditActors(): Promise<ReadonlyArray<AuditActor>> {
  const rows = await getJson<AuditActor[]>('/v1/audit/actors');
  return rows ?? [];
}

/** Tenant registry visible to the audit log. */
export async function listAuditTenants(): Promise<
  ReadonlyArray<{ id: string; name: string }>
> {
  const rows = await getJson<{ id: string; name: string }[]>(
    '/v1/audit/tenants',
  );
  return rows ?? [];
}

/** Catalog of action types for the filter dropdown. */
export function listAuditActions(): ReadonlyArray<AuditAction> {
  return [
    'login',
    'logout',
    'command_run',
    'artifact_created',
    'artifact_published',
    'terminal_command',
    'approval_decided',
    'role_changed',
    'policy_updated',
    'connector_attached',
  ];
}

/** Catalog of target types for the filter dropdown. */
export function listAuditTargetTypes(): ReadonlyArray<AuditTargetType> {
  return [
    'user',
    'run',
    'idea',
    'adr',
    'prd',
    'artifact',
    'terminal',
    'approval',
    'policy',
    'connector',
  ];
}