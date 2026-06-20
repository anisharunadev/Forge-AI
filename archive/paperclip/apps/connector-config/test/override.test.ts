/**
 * Override rules tests — divergence rule + credential_ref + depth cap.
 *
 * Sub-task: FORA-485 acceptance #3: "Project override inheritance
 * + divergence rules implemented."
 *
 * The four rules:
 *   1. credential_ref is NEVER inherited.
 *   2. auth_method must inherit unless Architect role.
 *   3. depth must be 0..3.
 *   4. diverged_fields is closed to 'auth_method'.
 *
 * Plus the orphan-risk detector + the 90-day re-attestation
 * sweeper, both of which live in the override module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDivergenceRecord,
  checkDivergenceRules,
  createProjectOverride,
  detectExpiredAttestations,
  detectOrphanRisk,
  createInMemoryAuditSink,
} from '../src/index.js';
import {
  OverrideDivergenceError,
  type CreateProjectOverrideInput,
  type RealAuthMethod,
} from '../src/types.js';
import { FakeScopedClient, seedBinding } from './fakes.js';
import type { TenantId, ActorId } from '@fora/db-pool';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PROJECT_X = '44444444-4444-4444-4444-444444444444';
const TENANT_PARENT = '33333333-3333-3333-3333-333333333333';

const ACTOR_ENGINEER: ActorId = 'user:engineer';
const ACTOR_ARCHITECT: ActorId = 'user:architect';

function makeInput(
  overrides: Partial<CreateProjectOverrideInput> = {},
): CreateProjectOverrideInput {
  return {
    tenant_id: TENANT_A as TenantId,
    project_id: PROJECT_X,
    connector_id: 'github',
    auth_method: 'pat' as RealAuthMethod,
    credential_ref: 'cred:override',
    actor: {
      actor_id: ACTOR_ENGINEER,
      role: 'engineer',
      trace_id: 'trace-1',
    },
    ...overrides,
  };
}

describe('connector-config/override rules', () => {
  let client: FakeScopedClient;
  let audit: ReturnType<typeof createInMemoryAuditSink>;

  beforeEach(() => {
    client = new FakeScopedClient();
    audit = createInMemoryAuditSink();
  });

  // -------------------------------------------------------------------------
  // Rule 1: credential_ref is NEVER inherited
  // -------------------------------------------------------------------------

  it('rejects an override with empty credential_ref', () => {
    expect(() =>
      checkDivergenceRules({
        input: makeInput({ credential_ref: '' }),
        inherited_auth_method: 'pat',
      }),
    ).toThrow(OverrideDivergenceError);
  });

  it('rejects an override with whitespace-only credential_ref', () => {
    expect(() =>
      checkDivergenceRules({
        input: makeInput({ credential_ref: '   ' }),
        inherited_auth_method: 'pat',
      }),
    ).toThrow(OverrideDivergenceError);
  });

  // -------------------------------------------------------------------------
  // Rule 2: auth_method must inherit unless Architect
  // -------------------------------------------------------------------------

  it('allows a non-Architect override when auth_method matches inherited', () => {
    expect(() =>
      checkDivergenceRules({
        input: makeInput({ auth_method: 'pat' }),
        inherited_auth_method: 'pat',
      }),
    ).not.toThrow();
  });

  it('rejects a non-Architect override when auth_method diverges', () => {
    expect(() =>
      checkDivergenceRules({
        input: makeInput({ auth_method: 'oauth2' }),
        inherited_auth_method: 'pat',
      }),
    ).toThrow(OverrideDivergenceError);
  });

  it('allows an Architect override to diverge auth_method', () => {
    expect(() =>
      checkDivergenceRules({
        input: makeInput({
          auth_method: 'oauth2',
          actor: {
            actor_id: ACTOR_ARCHITECT,
            role: 'architect',
            trace_id: 'trace-arch',
          },
        }),
        inherited_auth_method: 'pat',
      }),
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Rule 3: depth cap (0..3)
  // -------------------------------------------------------------------------

  it('rejects a depth outside the 0..3 cap', () => {
    expect(() =>
      checkDivergenceRules({
        input: makeInput(),
        inherited_auth_method: 'pat',
        resolved_depth: 4,
      }),
    ).toThrow(OverrideDivergenceError);

    expect(() =>
      checkDivergenceRules({
        input: makeInput(),
        inherited_auth_method: 'pat',
        resolved_depth: -1,
      }),
    ).toThrow(OverrideDivergenceError);
  });

  it('accepts depth 1..3', () => {
    for (const d of [0, 1, 2, 3]) {
      expect(() =>
        checkDivergenceRules({
          input: makeInput(),
          inherited_auth_method: 'pat',
          resolved_depth: d,
        }),
      ).not.toThrow();
    }
  });

  // -------------------------------------------------------------------------
  // Divergence record + audit emission
  // -------------------------------------------------------------------------

  it('buildDivergenceRecord returns null when override matches inherited', () => {
    const record = buildDivergenceRecord({
      tenant_id: TENANT_A as TenantId,
      binding_id: 'binding-x',
      connector_id: 'github',
      project_id: PROJECT_X,
      override_auth_method: 'pat',
      inherited_auth_method: 'pat',
    });
    expect(record).toBeNull();
  });

  it('buildDivergenceRecord returns the closed-set record when override diverges', () => {
    const record = buildDivergenceRecord({
      tenant_id: TENANT_A as TenantId,
      binding_id: 'binding-x',
      connector_id: 'github',
      project_id: PROJECT_X,
      override_auth_method: 'oauth2',
      inherited_auth_method: 'pat',
    });
    expect(record).not.toBeNull();
    expect(record?.diverged_fields).toEqual(['auth_method']);
    expect(record?.inherited_auth_method).toBe('pat');
    expect(record?.override_auth_method).toBe('oauth2');
  });

  // -------------------------------------------------------------------------
  // createProjectOverride end-to-end (Architect divergence)
  // -------------------------------------------------------------------------

  it('creates a non-divergent override when auth_method matches tenant default', async () => {
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const binding = await createProjectOverride({
      client,
      audit,
      input: makeInput({
        auth_method: 'pat',
        credential_ref: 'cred:override',
      }),
    });
    expect(binding.auth_method).toBe('pat');
    expect(binding.diverged_fields).toBeNull();
    // No divergence event for an exact match.
    expect(audit.events).toHaveLength(0);
  });

  it('creates a divergent override when Architect supplies a different auth_method', async () => {
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const binding = await createProjectOverride({
      client,
      audit,
      input: makeInput({
        auth_method: 'oauth2',
        credential_ref: 'cred:override',
        actor: {
          actor_id: ACTOR_ARCHITECT,
          role: 'architect',
          trace_id: 'trace-arch',
        },
      }),
    });
    expect(binding.auth_method).toBe('oauth2');
    expect(binding.diverged_fields).toEqual(['auth_method']);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.event_type).toBe('connector.binding.diverged');
  });

  it('rejects a non-Architect divergent override before writing', async () => {
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    await expect(
      createProjectOverride({
        client,
        audit,
        input: makeInput({
          auth_method: 'oauth2',
          credential_ref: 'cred:override',
        }),
      }),
    ).rejects.toThrow(OverrideDivergenceError);
  });

  it('probes inheritance via parent_tenant_id chain', async () => {
    // Tenant A has no tenant default; its parent has the binding at depth 1.
    seedBinding(client, {
      binding_id: 'binding-inherited',
      tenant_id: TENANT_PARENT,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      depth: 1,
      status: 'active',
    });
    const binding = await createProjectOverride({
      client,
      audit,
      input: makeInput({
        tenant_id: TENANT_A as TenantId,
        auth_method: 'pat',
        credential_ref: 'cred:override',
      }),
    });
    expect(binding.auth_method).toBe('pat');
    expect(binding.diverged_fields).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Orphan-risk detection
  // -------------------------------------------------------------------------

  it('detects orphan-risk overrides when tenant default is revoked', async () => {
    // Tenant default is revoked; an override is still active.
    seedBinding(client, {
      binding_id: 'binding-default-revoked',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'revoked',
      revoked_reason: 'manual',
    });
    seedBinding(client, {
      binding_id: 'binding-override-orphan',
      tenant_id: TENANT_A,
      project_id: PROJECT_X,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const emitted = await detectOrphanRisk({
      client,
      audit,
      tenant_id: TENANT_A as TenantId,
      connector_id: 'github',
      auth_method: 'pat',
    });
    expect(emitted).toHaveLength(1);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.event_type).toBe('connector.binding.orphan_risk');
  });

  it('does NOT emit orphan_risk when tenant default is active', async () => {
    seedBinding(client, {
      binding_id: 'binding-default-active',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    seedBinding(client, {
      binding_id: 'binding-override',
      tenant_id: TENANT_A,
      project_id: PROJECT_X,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const emitted = await detectOrphanRisk({
      client,
      audit,
      tenant_id: TENANT_A as TenantId,
      connector_id: 'github',
      auth_method: 'pat',
    });
    expect(emitted).toHaveLength(0);
    expect(audit.events).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 90-day re-attestation sweeper
  // -------------------------------------------------------------------------

  it('marks bindings as attesting and emits attestation_expired when due', async () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    seedBinding(client, {
      binding_id: 'binding-due',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
      attestation_expires_at: expired,
    });
    const marked = await detectExpiredAttestations({
      client,
      audit,
      tenant_id: TENANT_A as TenantId,
      connector_id: 'github',
    });
    expect(marked).toContain('binding-due');
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.event_type).toBe(
      'connector.binding.attestation_expired',
    );
  });

  it('does not mark bindings whose attestation is still in the future', async () => {
    const future = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    seedBinding(client, {
      binding_id: 'binding-future',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
      attestation_expires_at: future,
    });
    const marked = await detectExpiredAttestations({
      client,
      audit,
      tenant_id: TENANT_A as TenantId,
      connector_id: 'github',
    });
    expect(marked).toHaveLength(0);
    expect(audit.events).toHaveLength(0);
  });
});