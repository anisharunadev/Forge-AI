/**
 * Integration tests for FORA-152 (10.4a — wire workspace/{artifacts,sessions,
 * audit} to the runtime). The bar is mount → write → read for one artifact and
 * one audit event; this test also asserts the cross-tenant guard that the
 * contract docs require.
 *
 * Mirrors `integration.test.ts`: mkdtempSync root, FileSystemMountResolver +
 * FileSystemWorkspaceStore (the production pairing), assertions on the
 * on-disk layout.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  asRunId,
  canonicalJson,
  FileSystemMountResolver,
  FileSystemWorkspaceStore,
  hashPayload,
  InMemoryMountResolver,
  InMemoryWorkspaceStore,
  writeArtifactWithResolver,
} from '../../src/index.js';
import type { TenantId } from '../../src/orchestrator/index.js';

const TENANT = 'acme-corp' as TenantId;
const OTHER_TENANT = 'umbrella-co' as TenantId;
const RUN = asRunId('run_01J7Z3R8M4F1Q9B2C7D5E6H7K0');

let workspace: string;
let resolver: FileSystemMountResolver;
let store: FileSystemWorkspaceStore;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fora-mounts-'));
  resolver = new FileSystemMountResolver(workspace);
  store = new FileSystemWorkspaceStore();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('MountResolver', () => {
  it('resolves all three roots under by-tenant/<tenantId>/', () => {
    const mounts = resolver.resolve({ tenantId: TENANT, runId: RUN });

    expect(mounts.tenantId).toBe(TENANT);
    expect(mounts.runId).toBe(RUN);
    expect(mounts.artifactsRoot).toBe(join(workspace, 'by-tenant', TENANT, 'artifacts'));
    expect(mounts.sessionsRoot).toBe(join(workspace, 'by-tenant', TENANT, 'sessions'));
    expect(mounts.auditRoot).toBe(join(workspace, 'by-tenant', TENANT, 'audit'));
    expect(mounts.catalogIndex).toBe(join(mounts.artifactsRoot, 'catalog.jsonl'));
    expect(mounts.auditIndex).toBe(join(mounts.auditRoot, 'index.jsonl'));
  });

  it('scopes paths per-tenant so two tenants cannot collide', () => {
    const a = resolver.resolve({ tenantId: TENANT, runId: RUN });
    const b = resolver.resolve({ tenantId: OTHER_TENANT, runId: RUN });

    expect(a.artifactsRoot).not.toBe(b.artifactsRoot);
    expect(a.auditRoot).not.toBe(b.auditRoot);
  });
});

describe('WorkspaceStore.writeArtifact + readArtifact', () => {
  it('writes the payload + appends to catalog.jsonl, then round-trips on read', async () => {
    const mounts = resolver.resolve({ tenantId: TENANT, runId: RUN });
    const payload = { adr_id: 'ADR-0014', decision: 'runtime output mounts', choices: ['fs', 's3'] };

    const written = await store.writeArtifact({
      mounts,
      record: {
        artifact_id: 'art_01J7Z3X4K2N9PQ8R5V6T0YBWAC',
        tenant_id: TENANT,
        run_id: RUN,
        issue_id: 'FORA-152',
        stage: 'architect',
        kind: 'adr',
        title: 'ADR-0014 — Runtime output mounts',
        status: 'approved',
        produced_by: 'agent:architect',
      },
      payload,
    });

    // Returned record carries the derived fields.
    expect(written.payload_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(written.storage_path).toBe('by-stage/architect/art_01J7Z3X4K2N9PQ8R5V6T0YBWAC.json');
    expect(written.schema_version).toBe('1.0.0');
    expect(written.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(written.expires_at > written.created_at).toBe(true);

    // On-disk: catalog.jsonl has one line.
    const catalog = readFileSync(mounts.catalogIndex, 'utf-8').trim().split('\n');
    expect(catalog).toHaveLength(1);
    const catalogRow = JSON.parse(catalog[0]!);
    expect(catalogRow.artifact_id).toBe(written.artifact_id);
    expect(catalogRow.payload_sha256).toBe(written.payload_sha256);

    // On-disk: payload file under by-stage/architect/.
    const payloadFile = join(mounts.artifactsRoot, written.storage_path);
    const body = JSON.parse(readFileSync(payloadFile, 'utf-8'));
    expect(body.payload).toEqual(payload);
    expect(body.record.artifact_id).toBe(written.artifact_id);

    // Round-trip: readArtifact returns the same record + payload.
    const { record, payload: readBack } = await store.readArtifact({
      mounts,
      artifactId: written.artifact_id,
    });
    expect(record).toEqual(written);
    expect(readBack).toEqual(payload);
  });

  it('cross-tenant reads cannot see another tenant artifacts (structural isolation)', async () => {
    const mounts = resolver.resolve({ tenantId: TENANT, runId: RUN });
    const written = await store.writeArtifact({
      mounts,
      record: {
        artifact_id: 'art_cross_tenant',
        tenant_id: TENANT,
        run_id: RUN,
        issue_id: 'FORA-152',
        stage: 'dev',
        kind: 'code',
        title: 'cross-tenant guard',
        status: 'draft',
        produced_by: 'agent:dev',
      },
      payload: { x: 1 },
    });

    // Different tenant asks to read it. The contract says: cross-tenant
    // reads are a P0 (artifacts/README.md §5). The defense is structural —
    // each tenant has its own catalog and by-stage tree under
    // by-tenant/<tenant>/, so the foreign tenant's catalog simply does not
    // list the artifact and the lookup fails closed with "not found".
    const foreignMounts = resolver.resolve({ tenantId: OTHER_TENANT, runId: RUN });
    await expect(
      store.readArtifact({ mounts: foreignMounts, artifactId: written.artifact_id }),
    ).rejects.toThrow(/artifact not found/);

    // The home tenant can still read it.
    const { record } = await store.readArtifact({ mounts, artifactId: written.artifact_id });
    expect(record.artifact_id).toBe(written.artifact_id);
  });

  it('writes twice produce two catalog lines (append-only)', async () => {
    const mounts = resolver.resolve({ tenantId: TENANT, runId: RUN });
    await store.writeArtifact({
      mounts,
      record: {
        artifact_id: 'art_first',
        tenant_id: TENANT,
        run_id: RUN,
        issue_id: 'FORA-152',
        stage: 'dev',
        kind: 'code',
        title: 'first',
        status: 'draft',
        produced_by: 'agent:dev',
      },
      payload: { n: 1 },
    });
    await store.writeArtifact({
      mounts,
      record: {
        artifact_id: 'art_second',
        tenant_id: TENANT,
        run_id: RUN,
        issue_id: 'FORA-152',
        stage: 'dev',
        kind: 'code',
        title: 'second',
        status: 'draft',
        produced_by: 'agent:dev',
      },
      payload: { n: 2 },
    });

    const catalog = readFileSync(mounts.catalogIndex, 'utf-8').trim().split('\n');
    expect(catalog).toHaveLength(2);
    expect(JSON.parse(catalog[0]!).artifact_id).toBe('art_first');
    expect(JSON.parse(catalog[1]!).artifact_id).toBe('art_second');
  });
});

describe('WorkspaceStore.emitAuditEvent', () => {
  it('fans out to index.jsonl, by-tenant/<tenant>/<YYYY>-<MM>.jsonl, and by-run/<run>/<YYYY>-<MM>-<DD>.jsonl', async () => {
    const mounts = resolver.resolve({ tenantId: TENANT, runId: RUN });
    const ts = '2026-06-20T14:23:08.142Z';
    const event = await store.emitAuditEvent({
      mounts,
      event: {
        event_id: 'evt_01J7Z3X4K2N9PQ8R5V6T0YBWAC',
        ts,
        tenant_id: TENANT,
        run_id: RUN,
        stage: 'architect',
        actor: 'agent:architect',
        on_behalf_of: 'user:cto@acme-corp',
        tool: 'github.create_pull_request',
        args_hash: hashPayload({ repo: 'fora', pr: 14 }),
        result: 'success',
        duration_ms: 412,
        trace_id: 'trace_01J7Z3X4K2N9PQ8R5V6T0YBWAD',
      },
    });

    expect(event.schema_version).toBe('1.0.0');
    expect(event.shipped_at).toBeNull();
    expect(event.shipped_to).toBeNull();

    const index = readFileSync(mounts.auditIndex, 'utf-8').trim();
    const tenantShard = readFileSync(
      join(mounts.auditRoot, 'by-tenant', TENANT, '2026-06.jsonl'),
      'utf-8',
    ).trim();
    const runShard = readFileSync(
      join(mounts.auditRoot, 'by-run', RUN, '2026-06-20.jsonl'),
      'utf-8',
    ).trim();

    expect(JSON.parse(index)).toEqual(event);
    expect(JSON.parse(tenantShard)).toEqual(event);
    expect(JSON.parse(runShard)).toEqual(event);
  });
});

describe('hashPayload', () => {
  it('is key-order independent (canonical JSON contract)', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('is value-order independent for objects but not arrays', () => {
    expect(hashPayload({ a: [1, 2] })).toBe(hashPayload({ a: [1, 2] }));
    expect(hashPayload({ a: [1, 2] })).not.toBe(hashPayload({ a: [2, 1] }));
  });

  it('produces a 64-char hex after the sha256: prefix', () => {
    const h = hashPayload({ x: 1 });
    expect(h.startsWith('sha256:')).toBe(true);
    expect(h.slice('sha256:'.length)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('writeArtifactWithResolver (the public helper agent runs call)', () => {
  it('writes + reads back without the caller threading mounts explicitly', async () => {
    const inMemResolver = new InMemoryMountResolver(workspace);
    const inMemStore = new InMemoryWorkspaceStore();
    const payload = { shortcut: true };

    const written = await writeArtifactWithResolver(inMemResolver, inMemStore, {
      tenantId: TENANT,
      runId: RUN,
      record: {
        artifact_id: 'art_helper',
        tenant_id: TENANT,
        run_id: RUN,
        issue_id: 'FORA-152',
        stage: 'qa',
        kind: 'test_report',
        title: 'helper-path test',
        status: 'draft',
        produced_by: 'agent:qa',
      },
      payload,
    });

    expect(written.payload_sha256).toMatch(/^sha256:/);
    expect(inMemResolver.all()).toHaveLength(1);

    const { payload: readBack } = await inMemStore.readArtifact({
      mounts: inMemResolver.resolve({ tenantId: TENANT, runId: RUN }),
      artifactId: 'art_helper',
    });
    expect(readBack).toEqual(payload);
  });
});

describe('canonicalJson', () => {
  it('round-trips through JSON.parse', () => {
    const obj = { z: 1, a: { y: 2, b: [3, { m: 4 }] } };
    expect(JSON.parse(canonicalJson(obj))).toEqual(obj);
  });
});