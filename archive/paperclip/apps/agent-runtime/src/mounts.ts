/**
 * Workspace output mount resolver + store.
 *
 * Per FORA-152 (10.4a — wire workspace/{artifacts,sessions,audit} to the
 * runtime). The three contract documents under
 * `workspace/{artifacts,sessions,audit}/README.md` describe what each
 * folder holds; this module is the runtime hook that:
 *
 *   1. Resolves the three paths for a (tenant, run) pair so the path is
 *      tenant-scoped by construction (no accidental cross-tenant write).
 *   2. Reads/writes one artifact record against the resolved artifacts
 *      mount, appending to the catalog index and writing the payload
 *      under `by-stage/<stage>/<artifact_id>.json`.
 *   3. Emits one audit event against the resolved audit mount, fanning
 *      out to the per-tenant, per-run, and global indexes per the
 *      audit/README.md layout.
 *
 * Conventions mirror the rest of the runtime (see `run-record.ts`):
 * pluggable interfaces, an in-memory implementation for tests, and a
 * filesystem-backed implementation for production. The resolver returns
 * absolute paths; the caller is responsible for passing them to a
 * WorkspaceStore. Splitting resolve from write means the Master
 * Orchestrator can hold the resolver once per run and create per-stage
 * stores without re-reading env on every call.
 *
 * Out of scope (deferred to a follow-up):
 *   - SessionStore (sessions/). The v1.0 sessions/README.md is the
 *     contract; the runtime hook is symmetric to this one but ships
 *     when the Session Agent lands. Tracked under Epic 0.7.
 *   - S3-backed mounts. The FilesystemMountResolver is the production
 *     v0.1; an S3 mount is a `MountResolver` impl swap once FORA-30.4
 *     (storage adapter) lands.
 *   - The redaction filter (audit/README.md §7). The store writes
 *     `args_redacted: null` and trusts the caller to redact before
 *     emit. A follow-up wires the redaction filter from
 *     `packages/secrets/`.
 */

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import type { RunId } from './types.js';
import type { TenantId } from './orchestrator/index.js';

// ---------------------------------------------------------------------------
// Types — match the v1.0 contract docs but kept minimal so the test surface
// stays small. Field names mirror the docs verbatim (snake_case).
// ---------------------------------------------------------------------------

/** Resolved, tenant-scoped paths for the three workspace output mounts. */
export interface TenantMounts {
  readonly tenantId: TenantId;
  readonly runId: RunId;
  /** Absolute path to `workspace/artifacts/by-tenant/<tenant>/`. */
  readonly artifactsRoot: string;
  /** Absolute path to `workspace/sessions/by-tenant/<tenant>/`. */
  readonly sessionsRoot: string;
  /** Absolute path to `workspace/audit/by-tenant/<tenant>/`. */
  readonly auditRoot: string;
  /** Absolute path to `<artifactsRoot>/catalog.jsonl`. */
  readonly catalogIndex: string;
  /** Absolute path to `<auditRoot>/index.jsonl`. */
  readonly auditIndex: string;
}

/** Pluggable mount resolver. The runtime holds one per tenant; tests use the in-memory variant. */
export interface MountResolver {
  resolve(input: { tenantId: TenantId; runId: RunId }): TenantMounts;
}

/** A single artifact record. Mirrors `workspace/artifacts/README.md` §3, with the minimum fields the runtime needs to write/read. */
export interface ArtifactRecord {
  readonly artifact_id: string;
  readonly schema_version: '1.0.0';
  readonly tenant_id: string;
  readonly run_id: string;
  readonly issue_id: string;
  readonly stage: string;
  readonly kind: string;
  readonly title: string;
  readonly status: 'draft' | 'review' | 'approved' | 'rejected' | 'superseded' | 'cancelled';
  readonly produced_by: string;
  /** SHA-256 of the canonical JSON of the payload, prefixed with `sha256:`. */
  readonly payload_sha256: string;
  /** Relative path to the payload file under `artifactsRoot/`. */
  readonly storage_path: string;
  /** ISO 8601. */
  readonly created_at: string;
  /** ISO 8601. */
  readonly expires_at: string;
}

/** A single audit event. Mirrors `workspace/audit/README.md` §3 (minimal). */
export interface AuditEvent {
  readonly event_id: string;
  readonly schema_version: '1.0.0';
  readonly ts: string;
  readonly tenant_id: string;
  readonly run_id: string;
  readonly stage: string;
  readonly actor: string;
  readonly on_behalf_of: string;
  readonly tool: string;
  /** SHA-256 of the canonical JSON of the original (pre-redaction) args. */
  readonly args_hash: string;
  readonly result: 'success' | 'failure' | 'denied';
  readonly duration_ms: number;
  readonly trace_id: string;
  /** Always null at runtime write time; the audit-account shipper fills these. */
  readonly shipped_at: null;
  readonly shipped_to: null;
}

/** Pluggable store. The in-memory impl is for tests; the filesystem impl is for production. */
export interface WorkspaceStore {
  /** Append the record to `catalogIndex` and write the payload under `by-stage/<stage>/`. */
  writeArtifact(input: {
    mounts: TenantMounts;
    record: Omit<
      ArtifactRecord,
      'payload_sha256' | 'storage_path' | 'schema_version' | 'created_at' | 'expires_at'
    > & { schema_version?: ArtifactRecord['schema_version'] };
    payload: unknown;
  }): Promise<ArtifactRecord>;

  /** Read the payload + record back. Throws if the artifact is missing or the tenant prefix mismatches. */
  readArtifact(input: {
    mounts: TenantMounts;
    artifactId: string;
  }): Promise<{ record: ArtifactRecord; payload: unknown }>;

  /** Append the event to `auditIndex`, `by-tenant/<tenant>/<YYYY>-<MM>.jsonl`, and `by-run/<run>/<YYYY>-<MM>-<DD>.jsonl`. */
  emitAuditEvent(input: {
    mounts: TenantMounts;
    event: Omit<AuditEvent, 'schema_version' | 'shipped_at' | 'shipped_to'>;
  }): Promise<AuditEvent>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable JSON for SHA-256 hashing. Object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  );
}

/** SHA-256 of the canonical JSON of `payload`, hex-encoded, prefixed with `sha256:`. */
export function hashPayload(payload: unknown): string {
  const hex = createHash('sha256').update(canonicalJson(payload), 'utf-8').digest('hex');
  return `sha256:${hex}`;
}

function ym(ts: string): string {
  // ISO 8601 -> YYYY-MM. Tolerate Z or +HH:MM offsets; we only need the date.
  return ts.slice(0, 7);
}

function ymd(ts: string): string {
  return ts.slice(0, 10);
}

// ---------------------------------------------------------------------------
// MountResolver implementations
// ---------------------------------------------------------------------------

/**
 * Filesystem-backed resolver. The base directory is `process.env.FORA_WORKSPACE`
 * if set, else `<cwd>/workspace`. Tenant paths are nested under `by-tenant/`
 * so a runtime compromise that escapes one tenant's root cannot reach another's.
 */
export class FileSystemMountResolver implements MountResolver {
  constructor(private readonly baseDir?: string) {}

  resolve(input: { tenantId: TenantId; runId: RunId }): TenantMounts {
    const base = resolve(this.baseDir ?? process.env.FORA_WORKSPACE ?? join(process.cwd(), 'workspace'));
    const tenantBase = join(base, 'by-tenant', input.tenantId);
    const artifactsRoot = join(tenantBase, 'artifacts');
    const sessionsRoot = join(tenantBase, 'sessions');
    const auditRoot = join(tenantBase, 'audit');
    return {
      tenantId: input.tenantId,
      runId: input.runId,
      artifactsRoot,
      sessionsRoot,
      auditRoot,
      catalogIndex: join(artifactsRoot, 'catalog.jsonl'),
      auditIndex: join(auditRoot, 'index.jsonl'),
    };
  }
}

/** In-memory resolver for tests. Holds the base directory as a string; no I/O. */
export class InMemoryMountResolver implements MountResolver {
  private readonly resolved = new Map<string, TenantMounts>();
  constructor(public readonly baseDir: string) {}

  resolve(input: { tenantId: TenantId; runId: RunId }): TenantMounts {
    const key = `${input.tenantId}::${input.runId}`;
    const existing = this.resolved.get(key);
    if (existing) return existing;

    const tenantBase = join(this.baseDir, 'by-tenant', input.tenantId);
    const artifactsRoot = join(tenantBase, 'artifacts');
    const sessionsRoot = join(tenantBase, 'sessions');
    const auditRoot = join(tenantBase, 'audit');
    const mounts: TenantMounts = {
      tenantId: input.tenantId,
      runId: input.runId,
      artifactsRoot,
      sessionsRoot,
      auditRoot,
      catalogIndex: join(artifactsRoot, 'catalog.jsonl'),
      auditIndex: join(auditRoot, 'index.jsonl'),
    };
    this.resolved.set(key, mounts);
    return mounts;
  }

  /** Tests: every resolved mount so far. */
  all(): readonly TenantMounts[] {
    return [...this.resolved.values()];
  }
}

// ---------------------------------------------------------------------------
// WorkspaceStore implementations
// ---------------------------------------------------------------------------

/**
 * Filesystem-backed store. Honors the contract docs:
 *   - Catalog index is append-only JSONL (one record per line).
 *   - Artifact payload is written under `by-stage/<stage>/<id>.json`.
 *   - Audit events fan out to three locations (global index, per-tenant
 *     by month, per-run by day).
 *   - The `storage_path` on the record is RELATIVE to `artifactsRoot` so
 *     the record stays portable across hosts.
 */
export class FileSystemWorkspaceStore implements WorkspaceStore {
  async writeArtifact(input: {
    mounts: TenantMounts;
    record: Omit<
      ArtifactRecord,
      'payload_sha256' | 'storage_path' | 'schema_version' | 'created_at' | 'expires_at'
    > & { schema_version?: ArtifactRecord['schema_version'] };
    payload: unknown;
  }): Promise<ArtifactRecord> {
    const { mounts, record, payload } = input;
    const sha = hashPayload(payload);
    const schemaVersion = record.schema_version ?? '1.0.0';
    const createdAt = new Date().toISOString();
    // Hot retention is 13 months per artifacts/README.md §6.
    const expiresAt = new Date(Date.parse(createdAt) + 395 * 24 * 3600 * 1000).toISOString();
    const stage = record.stage;
    const relPath = join('by-stage', stage, `${record.artifact_id}.json`);
    const absPath = join(mounts.artifactsRoot, relPath);

    const full: ArtifactRecord = {
      artifact_id: record.artifact_id,
      schema_version: schemaVersion,
      tenant_id: record.tenant_id,
      run_id: record.run_id,
      issue_id: record.issue_id,
      stage,
      kind: record.kind,
      title: record.title,
      status: record.status,
      produced_by: record.produced_by,
      payload_sha256: sha,
      storage_path: relPath,
      created_at: createdAt,
      expires_at: expiresAt,
    };

    await mkdir(dirname(absPath), { recursive: true });
    await mkdir(dirname(mounts.catalogIndex), { recursive: true });
    await writeFile(absPath, JSON.stringify({ record: full, payload }, null, 2) + '\n', 'utf-8');
    await appendFile(mounts.catalogIndex, JSON.stringify(full) + '\n', 'utf-8');
    return full;
  }

  async readArtifact(input: {
    mounts: TenantMounts;
    artifactId: string;
  }): Promise<{ record: ArtifactRecord; payload: unknown }> {
    const { mounts, artifactId } = input;
    // We have to find the stage from the catalog (the index is append-only).
    const catalog = await readFile(mounts.catalogIndex, 'utf-8').catch(() => '');
    const match = catalog
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ArtifactRecord)
      .find((r) => r.artifact_id === artifactId);
    if (!match) {
      throw new Error(`artifact not found: ${artifactId}`);
    }
    if (match.tenant_id !== mounts.tenantId) {
      // Cross-tenant read is a P0 per artifacts/README.md §5 — refuse rather than return.
      throw new Error(`cross-tenant read rejected: ${mounts.tenantId} != ${match.tenant_id}`);
    }
    const absPath = join(mounts.artifactsRoot, match.storage_path);
    const body = JSON.parse(await readFile(absPath, 'utf-8')) as {
      record: ArtifactRecord;
      payload: unknown;
    };
    return { record: body.record, payload: body.payload };
  }

  async emitAuditEvent(input: {
    mounts: TenantMounts;
    event: Omit<AuditEvent, 'schema_version' | 'shipped_at' | 'shipped_to'>;
  }): Promise<AuditEvent> {
    const { mounts, event } = input;
    const full: AuditEvent = {
      schema_version: '1.0.0',
      shipped_at: null,
      shipped_to: null,
      ...event,
    };
    const tenantMonth = ym(full.ts);
    const runDay = ymd(full.ts);

    const tenantShard = join(mounts.auditRoot, 'by-tenant', mounts.tenantId, `${tenantMonth}.jsonl`);
    const runShard = join(mounts.auditRoot, 'by-run', full.run_id, `${runDay}.jsonl`);
    const line = JSON.stringify(full) + '\n';

    await mkdir(dirname(mounts.auditIndex), { recursive: true });
    await mkdir(dirname(tenantShard), { recursive: true });
    await mkdir(dirname(runShard), { recursive: true });
    await appendFile(mounts.auditIndex, line, 'utf-8');
    await appendFile(tenantShard, line, 'utf-8');
    await appendFile(runShard, line, 'utf-8');
    return full;
  }
}

/** In-memory store for tests. Mirrors the filesystem layout in a Map. */
export class InMemoryWorkspaceStore implements WorkspaceStore {
  readonly artifacts = new Map<string, ArtifactRecord>();
  readonly payloads = new Map<string, unknown>();
  readonly events: AuditEvent[] = [];

  async writeArtifact(input: {
    mounts: TenantMounts;
    record: Omit<
      ArtifactRecord,
      'payload_sha256' | 'storage_path' | 'schema_version' | 'created_at' | 'expires_at'
    > & { schema_version?: ArtifactRecord['schema_version'] };
    payload: unknown;
  }): Promise<ArtifactRecord> {
    const sha = hashPayload(input.payload);
    const full: ArtifactRecord = {
      artifact_id: input.record.artifact_id,
      schema_version: input.record.schema_version ?? '1.0.0',
      tenant_id: input.record.tenant_id,
      run_id: input.record.run_id,
      issue_id: input.record.issue_id,
      stage: input.record.stage,
      kind: input.record.kind,
      title: input.record.title,
      status: input.record.status,
      produced_by: input.record.produced_by,
      payload_sha256: sha,
      storage_path: join('by-stage', input.record.stage, `${input.record.artifact_id}.json`),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 395 * 24 * 3600 * 1000).toISOString(),
    };
    if (full.tenant_id !== input.mounts.tenantId) {
      throw new Error(`cross-tenant write rejected: ${input.mounts.tenantId} != ${full.tenant_id}`);
    }
    this.artifacts.set(full.artifact_id, full);
    this.payloads.set(full.artifact_id, input.payload);
    return full;
  }

  async readArtifact(input: {
    mounts: TenantMounts;
    artifactId: string;
  }): Promise<{ record: ArtifactRecord; payload: unknown }> {
    const record = this.artifacts.get(input.artifactId);
    if (!record) throw new Error(`artifact not found: ${input.artifactId}`);
    if (record.tenant_id !== input.mounts.tenantId) {
      throw new Error(`cross-tenant read rejected: ${input.mounts.tenantId} != ${record.tenant_id}`);
    }
    const payload = this.payloads.get(input.artifactId);
    return { record, payload };
  }

  async emitAuditEvent(input: {
    mounts: TenantMounts;
    event: Omit<AuditEvent, 'schema_version' | 'shipped_at' | 'shipped_to'>;
  }): Promise<AuditEvent> {
    const full: AuditEvent = {
      schema_version: '1.0.0',
      shipped_at: null,
      shipped_to: null,
      ...input.event,
    };
    if (full.tenant_id !== input.mounts.tenantId) {
      throw new Error(`cross-tenant audit rejected: ${input.mounts.tenantId} != ${full.tenant_id}`);
    }
    this.events.push(full);
    return full;
  }
}

/**
 * Convenience wrapper used by agent runs that want a one-call "mount + write"
 * helper without threading both objects around. Equivalent to resolving the
 * mounts and then calling `store.writeArtifact` directly.
 */
export async function writeArtifactWithResolver(
  resolver: MountResolver,
  store: WorkspaceStore,
  input: {
    tenantId: TenantId;
    runId: RunId;
    record: Omit<
      ArtifactRecord,
      'payload_sha256' | 'storage_path' | 'schema_version' | 'created_at' | 'expires_at'
    > & { schema_version?: ArtifactRecord['schema_version'] };
    payload: unknown;
  },
): Promise<ArtifactRecord> {
  const mounts = resolver.resolve({ tenantId: input.tenantId, runId: input.runId });
  return store.writeArtifact({ mounts, record: input.record, payload: input.payload });
}

/** Symmetric helper for the audit emit path. */
export async function emitAuditEventWithResolver(
  resolver: MountResolver,
  store: WorkspaceStore,
  input: { tenantId: TenantId; runId: RunId; event: Omit<AuditEvent, 'schema_version' | 'shipped_at' | 'shipped_to'> },
): Promise<AuditEvent> {
  const mounts = resolver.resolve({ tenantId: input.tenantId, runId: input.runId });
  return store.emitAuditEvent({ mounts, event: input.event });
}

// `readdir` is re-exported for tests that want to assert on the on-disk layout
// (the production path does not need it).
export { readdir };