/**
 * In-memory fake of `@fora/db-pool`'s `ScopedClient`.
 *
 * The test path does not require a real Postgres — the
 * connector-config service's contract is the SQL shape, the
 * resolver's five-step logic, and the audit emission. The
 * fake simulates the `pg.PoolClient` query() surface by
 * matching SQL strings against the patterns the repo uses.
 *
 * Sub-task: FORA-485. The fake mirrors the
 * `ScopedClient` interface from `@fora/db-pool`:
 *
 *   query<R>(sql: string, params?: unknown[]): Promise<QueryResult<R>>
 *   release(): void
 *
 * The fake deliberately implements only the SELECTs + UPDATEs
 * the connector-config repo issues. The integration test
 * (separate file) wires a real `TenantAwarePool`.
 */

import type {
  QueryResult,
  QueryResultRow,
} from 'pg';
import type { ScopedClient } from '@fora/db-pool';
import type { ConnectorBinding, BindingStatus } from '../src/types.js';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface StoredBinding {
  id: string;
  binding_id: string;
  tenant_id: string;
  project_id: string | null;
  connector_id: string;
  auth_method: string;
  credential_ref: string;
  scopes: string[];
  status: BindingStatus;
  last_health_check_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  parent_tenant_id: string | null;
  depth: number;
  diverged_fields: string[] | null;
  attested_at: string;
  attested_by: string;
  attestation_expires_at: string;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

function emptyBinding(): Omit<StoredBinding, never> {
  return {
    id: '',
    binding_id: '',
    tenant_id: '',
    project_id: null,
    connector_id: '',
    auth_method: '',
    credential_ref: '',
    scopes: [],
    status: 'pending',
    last_health_check_at: null,
    last_success_at: null,
    last_failure_at: null,
    parent_tenant_id: null,
    depth: 0,
    diverged_fields: null,
    attested_at: '',
    attested_by: '',
    attestation_expires_at: '',
    revoked_reason: null,
    created_at: '',
    updated_at: '',
    created_by: '',
    updated_by: '',
  };
}

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

/**
 * In-memory fake of `pg.PoolClient` (i.e. `ScopedClient`). The
 * fake matches SQL strings against the patterns the
 * connector-config repo issues and routes them to in-memory
 * tables. Tests seed + read from the same store.
 */
export class FakeScopedClient implements ScopedClient {
  /** Bindings keyed by id. */
  readonly bindings = new Map<string, StoredBinding>();
  /** Audit events appended by the FORA-36 forwarder (separate store). */
  readonly audit_events: Array<Record<string, unknown>> = [];

  private counter = 0;
  private released = false;

  // ---- ScopedClient ------------------------------------------------------

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('INSERT INTO CONNECTOR_BINDING')) {
      return this.fakeInsert<R>(params);
    }
    if (trimmed.startsWith('UPDATE CONNECTOR_BINDING')) {
      return this.fakeUpdate<R>(sql, params);
    }
    if (trimmed.startsWith('SELECT')) {
      return this.fakeSelect<R>(sql, params);
    }
    throw new Error(
      `FakeScopedClient: unhandled SQL — ${sql.slice(0, 60)}...`,
    );
  }

  release(): void {
    this.released = true;
  }

  // ---- Internals ---------------------------------------------------------

  private nextId(): string {
    this.counter += 1;
    return `00000000-0000-0000-0000-${String(this.counter).padStart(12, '0')}`;
  }

  private toRow(b: StoredBinding): Record<string, unknown> {
    return { ...b };
  }

  private fakeInsert<R extends QueryResultRow>(
    params: unknown[],
  ): QueryResult<R> {
    // INSERT INTO connector_binding (<cols>) VALUES (...) ON CONFLICT ...
    const [
      binding_id,
      tenant_id,
      project_id,
      connector_id,
      auth_method,
      credential_ref,
      scopes_json,
      status,
      parent_tenant_id,
      depth,
      diverged_fields_json,
      attested_by,
      created_by,
    ] = params as [
      string,
      string,
      string | null,
      string,
      string,
      string,
      string,
      string,
      string | null,
      number,
      string | null,
      string,
      string,
    ];
    const id = this.nextId();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const scopes = JSON.parse((scopes_json as string) ?? '[]') as string[];
    const diverged_fields = diverged_fields_json
      ? (JSON.parse(diverged_fields_json as string) as string[])
      : null;

    const row: StoredBinding = {
      id,
      binding_id: binding_id as string,
      tenant_id: tenant_id as string,
      project_id: (project_id as string | null) ?? null,
      connector_id: connector_id as string,
      auth_method: auth_method as string,
      credential_ref: credential_ref as string,
      scopes,
      status: status as BindingStatus,
      last_health_check_at: null,
      last_success_at: null,
      last_failure_at: null,
      parent_tenant_id: (parent_tenant_id as string | null) ?? null,
      depth: depth as number,
      diverged_fields,
      attested_at: now,
      attested_by: attested_by as string,
      attestation_expires_at: expires,
      revoked_reason: null,
      created_at: now,
      updated_at: now,
      created_by: created_by as string,
      updated_by: created_by as string,
    };

    // ON CONFLICT (tenant_id, binding_id) DO UPDATE SET updated_at = now()
    for (const existing of this.bindings.values()) {
      if (
        existing.tenant_id === row.tenant_id &&
        existing.binding_id === row.binding_id
      ) {
        existing.updated_at = now;
        return { rows: [this.toRow(existing) as R], rowCount: 1 } as QueryResult<R>;
      }
    }
    this.bindings.set(id, row);
    return { rows: [this.toRow(row) as R], rowCount: 1 } as QueryResult<R>;
  }

  private fakeUpdate<R extends QueryResultRow>(
    sql: string,
    params: unknown[],
  ): QueryResult<R> {
    const trimmed = sql.trim().toUpperCase();

    // activateBinding: SET status='active'
    if (trimmed.includes("SET STATUS = 'ACTIVE'")) {
      return this.fakeUpdateStatus<R>(params, 'active', null);
    }
    // revokeBinding: SET status='revoked', revoked_reason=$3
    if (trimmed.includes("SET STATUS = 'REVOKED'")) {
      const [tenant_id, binding_id, revoked_reason, updated_by] = params as [
        string,
        string,
        string,
        string,
      ];
      return this.fakeUpdateStatus<R>(
        [tenant_id, binding_id, revoked_reason, updated_by],
        'revoked',
        revoked_reason,
      );
    }
    // markAttesting: SET status='attesting'
    if (trimmed.includes("SET STATUS = 'ATTESTING'")) {
      return this.fakeUpdateStatus<R>(params, 'attesting', null);
    }
    // attest: SET status='active', attested_at=now(), attestation_expires_at=now()+90d
    if (
      trimmed.includes('SET STATUS = \'ACTIVE\'') &&
      trimmed.includes('ATTESTED_AT = NOW()')
    ) {
      const [tenant_id, binding_id, attested_by] = params as [
        string,
        string,
        string,
      ];
      const row = this.findByBindingId(tenant_id, binding_id);
      if (!row) return { rows: [], rowCount: 0 } as QueryResult<R>;
      row.status = 'active';
      const now = new Date().toISOString();
      row.attested_at = now;
      row.attested_by = attested_by;
      row.attestation_expires_at = new Date(
        Date.now() + 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      row.updated_at = now;
      row.updated_by = attested_by;
      return { rows: [this.toRow(row) as R], rowCount: 1 } as QueryResult<R>;
    }
    // recordHealthCheckSuccess: SET last_health_check_at, last_success_at
    if (trimmed.includes('LAST_SUCCESS_AT = NOW()')) {
      return this.fakeUpdateHealthCheck<R>(params, true);
    }
    // recordHealthCheckFailure: SET last_failure_at
    if (trimmed.includes('LAST_FAILURE_AT = NOW()')) {
      return this.fakeUpdateHealthCheck<R>(params, false);
    }
    throw new Error(
      `FakeScopedClient.fakeUpdate: unhandled UPDATE — ${sql.slice(0, 80)}...`,
    );
  }

  private fakeUpdateStatus<R extends QueryResultRow>(
    params: unknown[],
    status: BindingStatus,
    revoked_reason: string | null,
  ): QueryResult<R> {
    const [tenant_id, binding_id, , updated_by] = params as [
      string,
      string,
      string | null,
      string,
    ];
    const row = this.findByBindingId(tenant_id, binding_id);
    if (!row) return { rows: [], rowCount: 0 } as QueryResult<R>;
    row.status = status;
    row.updated_at = new Date().toISOString();
    row.updated_by = (updated_by as string) ?? row.updated_by;
    if (revoked_reason !== null) row.revoked_reason = revoked_reason;
    return { rows: [this.toRow(row) as R], rowCount: 1 } as QueryResult<R>;
  }

  private fakeUpdateHealthCheck<R extends QueryResultRow>(
    params: unknown[],
    ok: boolean,
  ): QueryResult<R> {
    const [tenant_id, binding_id, updated_by] = params as [
      string,
      string,
      string,
    ];
    const row = this.findByBindingId(tenant_id, binding_id);
    if (!row) return { rows: [], rowCount: 0 } as QueryResult<R>;
    const now = new Date().toISOString();
    row.last_health_check_at = now;
    if (ok) row.last_success_at = now;
    else row.last_failure_at = now;
    row.updated_at = now;
    row.updated_by = updated_by as string;
    return { rows: [this.toRow(row) as R], rowCount: 1 } as QueryResult<R>;
  }

  private fakeSelect<R extends QueryResultRow>(
    sql: string,
    params: unknown[],
  ): QueryResult<R> {
    const trimmed = sql.trim().toUpperCase();

    // findProjectOverride
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('PROJECT_ID = $2')
    ) {
      const [tenant_id, project_id, connector_id, auth_method] = params as [
        string,
        string,
        string,
        string,
      ];
      const match = Array.from(this.bindings.values()).find(
        (b) =>
          b.tenant_id === tenant_id &&
          b.project_id === project_id &&
          b.connector_id === connector_id &&
          b.auth_method === auth_method &&
          ['pending', 'active', 'attesting'].includes(b.status),
      );
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // findTenantDefault (auth_method filtered) — `AND PROJECT_ID IS NULL`
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('PROJECT_ID IS NULL') &&
      trimmed.includes("AUTH_METHOD = $3")
    ) {
      const [tenant_id, connector_id, auth_method] = params as [
        string,
        string,
        string,
      ];
      const match = Array.from(this.bindings.values()).find(
        (b) =>
          b.tenant_id === tenant_id &&
          b.project_id === null &&
          b.connector_id === connector_id &&
          b.auth_method === auth_method &&
          ['pending', 'active', 'attesting'].includes(b.status),
      );
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // findTenantDefaultAnyAuthMethod
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('PROJECT_ID IS NULL') &&
      trimmed.includes('ORDER BY CREATED_AT ASC')
    ) {
      const [tenant_id, connector_id] = params as [string, string];
      const match = Array.from(this.bindings.values())
        .filter(
          (b) =>
            b.tenant_id === tenant_id &&
            b.project_id === null &&
            b.connector_id === connector_id &&
            ['pending', 'active', 'attesting'].includes(b.status),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // findInheritedBinding (auth_method filtered; depth>0 = chain row)
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('DEPTH = $2') &&
      trimmed.includes('DEPTH > 0') &&
      trimmed.includes("AUTH_METHOD = $4")
    ) {
      const [parent_tenant_id, depth, connector_id, auth_method] = params as [
        string,
        number,
        string,
        string,
      ];
      const match = Array.from(this.bindings.values()).find(
        (b) =>
          b.depth === depth &&
          b.depth > 0 &&
          b.connector_id === connector_id &&
          b.auth_method === auth_method &&
          b.status === 'active',
      );
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // findInheritedBindingAnyAuthMethod
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('DEPTH = $2') &&
      trimmed.includes('ORDER BY CREATED_AT ASC')
    ) {
      const [parent_tenant_id, depth, connector_id] = params as [
        string,
        number,
        string,
      ];
      const match = Array.from(this.bindings.values())
        .filter(
          (b) =>
            b.tenant_id === parent_tenant_id &&
            b.depth === depth &&
            b.connector_id === connector_id &&
            b.status === 'active',
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // findForgeOperatorFallback
    if (trimmed.includes("AUTH_METHOD = 'FORGE_OPERATOR_FALLBACK'")) {
      const [tenant_id] = params as [string];
      const match = Array.from(this.bindings.values()).find(
        (b) =>
          b.tenant_id === tenant_id &&
          b.project_id === null &&
          b.auth_method === 'forge_operator_fallback' &&
          b.status === 'active',
      );
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // listForgeOperatorFallbacks
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes("AUTH_METHOD = 'FORGE_OPERATOR_FALLBACK'") &&
      trimmed.includes("STATUS = 'ACTIVE'") &&
      !trimmed.includes('LIMIT')
    ) {
      const [tenant_id] = params as [string];
      const matches = Array.from(this.bindings.values()).filter(
        (b) =>
          b.tenant_id === tenant_id &&
          b.auth_method === 'forge_operator_fallback' &&
          b.status === 'active',
      );
      return { rows: matches.map((m) => this.toRow(m) as R), rowCount: matches.length } as QueryResult<R>;
    }

    // listActiveProjectOverrides
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('PROJECT_ID IS NOT NULL') &&
      trimmed.includes("STATUS = 'ACTIVE'") &&
      !trimmed.includes('LIMIT')
    ) {
      const [tenant_id, connector_id, auth_method] = params as [
        string,
        string,
        string,
      ];
      const matches = Array.from(this.bindings.values()).filter(
        (b) =>
          b.tenant_id === tenant_id &&
          b.connector_id === connector_id &&
          b.auth_method === auth_method &&
          b.project_id !== null &&
          b.status === 'active',
      );
      return { rows: matches.map((m) => this.toRow(m) as R), rowCount: matches.length } as QueryResult<R>;
    }

    // findByBindingId
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('BINDING_ID = $2') &&
      trimmed.includes('LIMIT 1')
    ) {
      const [tenant_id, binding_id] = params as [string, string];
      const match = this.findByBindingId(tenant_id, binding_id);
      return match
        ? { rows: [this.toRow(match) as R], rowCount: 1 }
        : ({ rows: [], rowCount: 0 } as QueryResult<R>);
    }

    // attestation sweep — used by detectExpiredAttestations
    if (
      trimmed.includes('FROM CONNECTOR_BINDING') &&
      trimmed.includes('ATTESTATION_EXPIRES_AT < NOW()')
    ) {
      const [tenant_id, connector_id] = params as [string, string];
      const now = new Date().toISOString();
      const matches = Array.from(this.bindings.values()).filter(
        (b) =>
          b.tenant_id === tenant_id &&
          b.connector_id === connector_id &&
          b.status === 'active' &&
          b.attestation_expires_at < now,
      );
      return {
        rows: matches.map((m) => ({
          binding_id: m.binding_id,
          attestation_expires_at: m.attestation_expires_at,
        })) as R[],
        rowCount: matches.length,
      } as QueryResult<R>;
    }

    throw new Error(
      `FakeScopedClient.fakeSelect: unhandled SELECT — ${sql.slice(0, 80)}...`,
    );
  }

  private findByBindingId(
    tenant_id: string,
    binding_id: string,
  ): StoredBinding | undefined {
    for (const b of this.bindings.values()) {
      if (b.tenant_id === tenant_id && b.binding_id === binding_id) return b;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers for tests
// ---------------------------------------------------------------------------

/** Seed a binding row directly into the fake store (bypasses the repo). */
export function seedBinding(
  client: FakeScopedClient,
  args: Partial<ConnectorBinding> & {
    binding_id: string;
    tenant_id: string;
    connector_id: string;
    auth_method: string;
  },
): ConnectorBinding {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const id = `00000000-0000-0000-0000-${String(client.bindings.size + 1).padStart(12, '0')}`;
  const row: StoredBinding = {
    id,
    binding_id: args.binding_id,
    tenant_id: args.tenant_id,
    project_id: args.project_id ?? null,
    connector_id: args.connector_id,
    auth_method: args.auth_method,
    credential_ref: args.credential_ref ?? 'cred:ref',
    scopes: (args.scopes as string[] | undefined) ?? [],
    status: args.status ?? 'active',
    last_health_check_at: args.last_health_check_at ?? null,
    last_success_at: args.last_success_at ?? null,
    last_failure_at: args.last_failure_at ?? null,
    parent_tenant_id: args.parent_tenant_id ?? null,
    depth: args.depth ?? 0,
    diverged_fields:
      (args.diverged_fields as string[] | undefined) ?? null,
    attested_at: args.attested_at ?? now,
    attested_by: args.attested_by ?? 'user:admin',
    attestation_expires_at: args.attestation_expires_at ?? expires,
    revoked_reason: args.revoked_reason ?? null,
    created_at: args.created_at ?? now,
    updated_at: args.updated_at ?? now,
    created_by: args.created_by ?? 'user:admin',
    updated_by: args.updated_by ?? 'user:admin',
  };
  client.bindings.set(id, row);
  return row as unknown as ConnectorBinding;
}

export type { StoredBinding };
export { emptyBinding };