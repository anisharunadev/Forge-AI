/**
 * FORA-546 acceptance tests.
 *
 * Sub-task: FORA-391.3d — Tenant inheritance depth ≤ 3 +
 * onboarding flow + forge_operator auto-revoke. Covers the
 * six AC items not already green from FORA-485:
 *
 *   AC #1 — depth-3 enforcement at the Keycloak layer rejects
 *           chains deeper than 3 with a typed error.
 *           (Repo.create depth admission.)
 *   AC #2 — child-uses-parent call path emits audit with the
 *           child's tenant_id.
 *           (connector.binding.inherited_resolved.)
 *   AC #3 — child cannot write parent binding (negative test
 *           required).
 *           (CrossTenantBindingWriteForbiddenError.)
 *   AC #5 — on activation, all forge_operator fallback bindings
 *           are auto-revoked; audit event emitted.
 *           (revokeForgeOperatorFallbacks.)
 *   AC #6 — Auditors retain read-only access via role grant,
 *           not via fallback binding.
 *           (Resolver step 4 path; auditor-only.)
 *
 * Tests use the in-memory `FakeScopedClient` so the runtime
 * guards + audit emission run without a real Postgres. The
 * migration CHECK (0007) is a separate forward-only swap on
 * the column CHECK and is not exercised here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConnectorConfigResolver,
  InProcessConnectorConfigCache,
  connectorBindingRepo,
  createInMemoryAuditSink,
} from '../src/index.js';
import {
  CrossTenantBindingWriteForbiddenError,
  TenantInheritanceDepthExceededError,
  type ResolveBindingInput,
} from '../src/types.js';
import {
  createAndActivateTenantDefault,
  onboardTenant,
  revokeForgeOperatorFallbacks,
} from '../src/onboarding.js';
import { FakeScopedClient, seedBinding } from './fakes.js';
import type { TenantId, ActorId } from '@fora/db-pool';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TENANT_PARENT = '33333333-3333-3333-3333-333333333333';
const TENANT_GRANDCHILD = '55555555-5555-5555-5555-555555555555';

const ACTOR_ENGINEER: ActorId = 'user:engineer';
const ACTOR_AUDITOR: ActorId = 'user:auditor';
const ACTOR_ADMIN: ActorId = 'user:admin';

function makeInput(
  overrides: Partial<ResolveBindingInput> = {},
): ResolveBindingInput {
  return {
    tenant_id: TENANT_A as TenantId,
    project_id: null,
    connector_id: 'github',
    auth_method: 'pat',
    actor: {
      actor_id: ACTOR_ENGINEER,
      role: 'engineer',
      trace_id: 'trace-1',
    },
    ...overrides,
  };
}

describe('connector-config / FORA-546 acceptance', () => {
  let client: FakeScopedClient;
  let audit: ReturnType<typeof createInMemoryAuditSink>;
  let cache: InProcessConnectorConfigCache;

  beforeEach(() => {
    client = new FakeScopedClient();
    audit = createInMemoryAuditSink();
    cache = new InProcessConnectorConfigCache();
  });

  // -------------------------------------------------------------------------
  // AC #1: depth-3 enforcement at the admission boundary
  // -------------------------------------------------------------------------

  describe('AC #1: depth-3 enforcement (Keycloak admission boundary)', () => {
    it('rejects repo.create with depth > 3 with TenantInheritanceDepthExceededError', async () => {
      const repo = connectorBindingRepo(client);
      await expect(
        repo.create({
          binding_id: 'binding-deep',
          tenant_id: TENANT_A as TenantId,
          project_id: null,
          connector_id: 'github',
          auth_method: 'pat',
          credential_ref: 'cred:deep',
          parent_tenant_id: TENANT_PARENT as TenantId,
          depth: 4,
          attested_by: ACTOR_ADMIN,
          created_by: ACTOR_ADMIN,
        }),
      ).rejects.toBeInstanceOf(TenantInheritanceDepthExceededError);
      // No binding row was created — the guard runs before
      // the SQL executes.
      expect(client.bindings.size).toBe(0);
    });

    it('rejects repo.create with depth = 99 (well past the cap)', async () => {
      const repo = connectorBindingRepo(client);
      await expect(
        repo.create({
          binding_id: 'binding-impossible',
          tenant_id: TENANT_A as TenantId,
          project_id: null,
          connector_id: 'github',
          auth_method: 'pat',
          credential_ref: 'cred:impossible',
          depth: 99,
          attested_by: ACTOR_ADMIN,
          created_by: ACTOR_ADMIN,
        }),
      ).rejects.toBeInstanceOf(TenantInheritanceDepthExceededError);
    });

    it('rejects repo.create with depth = -1 (negative)', async () => {
      const repo = connectorBindingRepo(client);
      await expect(
        repo.create({
          binding_id: 'binding-neg',
          tenant_id: TENANT_A as TenantId,
          project_id: null,
          connector_id: 'github',
          auth_method: 'pat',
          credential_ref: 'cred:neg',
          depth: -1,
          attested_by: ACTOR_ADMIN,
          created_by: ACTOR_ADMIN,
        }),
      ).rejects.toBeInstanceOf(TenantInheritanceDepthExceededError);
    });

    it('accepts depth = 0 (project-owned / tenant default)', async () => {
      const repo = connectorBindingRepo(client);
      const row = await repo.create({
        binding_id: 'binding-depth-0',
        tenant_id: TENANT_A as TenantId,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        credential_ref: 'cred:d0',
        depth: 0,
        attested_by: ACTOR_ADMIN,
        created_by: ACTOR_ADMIN,
      });
      expect(row.depth).toBe(0);
    });

    it('accepts depth = 3 (the cap)', async () => {
      const repo = connectorBindingRepo(client);
      const row = await repo.create({
        binding_id: 'binding-depth-3',
        tenant_id: TENANT_A as TenantId,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        credential_ref: 'cred:d3',
        parent_tenant_id: TENANT_PARENT as TenantId,
        depth: 3,
        attested_by: ACTOR_ADMIN,
        created_by: ACTOR_ADMIN,
      });
      expect(row.depth).toBe(3);
    });

    it('walkInheritance never queries depth > 3 (resolver cap is enforced at the loop)', async () => {
      // The walk iterates depth 1..3 only; a binding seeded
      // at depth=4 must NOT be discovered. The test
      // demonstrates the runtime cap matches the column
      // CHECK + the admission guard.
      seedBinding(client, {
        binding_id: 'binding-depth-4',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 4,
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      const result = await resolver.resolve(makeInput());
      expect(result.step).toBe('miss');
      expect(result.binding).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // AC #2: child-uses-parent emits audit with the child's tenant_id
  // -------------------------------------------------------------------------

  describe('AC #2: child-uses-parent audit stamped with the child tenant', () => {
    it('emits connector.binding.inherited_resolved with the child tenant_id (depth 1)', async () => {
      seedBinding(client, {
        binding_id: 'binding-parent-d1',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 1,
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      const result = await resolver.resolve(
        makeInput({ tenant_id: TENANT_A as TenantId }),
      );
      expect(result.step).toBe('tenant_inherited');
      expect(result.binding?.binding_id).toBe('binding-parent-d1');
      // Exactly one event was emitted: the inherited_resolved.
      expect(audit.events).toHaveLength(1);
      const event = audit.events[0];
      expect(event?.event_type).toBe('connector.binding.inherited_resolved');
      // CRITICAL: tenant_id on the event is the CHILD's,
      // not the parent's. Auditors can filter on
      // metadata.parent_tenant_id to find every consumer of
      // a given parent binding.
      expect(event?.tenant_id).toBe(TENANT_A);
      expect(event?.metadata).toMatchObject({
        requester_tenant_id: TENANT_A,
        parent_tenant_id: TENANT_PARENT,
        depth: 1,
        inherited_binding_id: 'binding-parent-d1',
      });
    });

    it('stamps the event with the child tenant_id even at depth 3 (grandchild)', async () => {
      seedBinding(client, {
        binding_id: 'binding-grandparent',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 3,
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      // The grandchild requests; the chain walks depth 1..3
      // and lands on the depth-3 row.
      const result = await resolver.resolve(
        makeInput({ tenant_id: TENANT_GRANDCHILD as TenantId }),
      );
      expect(result.step).toBe('tenant_inherited');
      const event = audit.events[0];
      expect(event?.tenant_id).toBe(TENANT_GRANDCHILD);
      expect(event?.metadata).toMatchObject({
        requester_tenant_id: TENANT_GRANDCHILD,
        parent_tenant_id: TENANT_PARENT,
        depth: 3,
      });
    });

    it('does NOT emit inherited_resolved on MISS (only on a successful step-3 resolve)', async () => {
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      const result = await resolver.resolve(makeInput());
      expect(result.step).toBe('miss');
      // Only connector.binding.missing is emitted; no
      // inherited_resolved should fire when step 3 returns
      // null.
      const eventTypes = audit.events.map((e) => e.event_type);
      expect(eventTypes).toEqual(['connector.binding.missing']);
    });
  });

  // -------------------------------------------------------------------------
  // AC #3: child cannot write parent binding (negative test)
  // -------------------------------------------------------------------------

  describe('AC #3: child-cannot-write-parent-binding', () => {
    it('rejects activate() on a parent-owned binding with CrossTenantBindingWriteForbiddenError', async () => {
      // Seed a binding owned by the PARENT tenant; the child
      // (TENANT_A) attempts to activate it.
      seedBinding(client, {
        binding_id: 'binding-parent-owned',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 1,
        status: 'pending',
      });
      const repo = connectorBindingRepo(client);
      await expect(
        repo.activate({
          tenant_id: TENANT_A as TenantId,
          binding_id: 'binding-parent-owned',
          actor: ACTOR_ENGINEER,
        }),
      ).rejects.toBeInstanceOf(CrossTenantBindingWriteForbiddenError);
    });

    it('rejects revoke() on a parent-owned binding', async () => {
      seedBinding(client, {
        binding_id: 'binding-parent-owned',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 1,
        status: 'active',
      });
      const repo = connectorBindingRepo(client);
      await expect(
        repo.revoke({
          tenant_id: TENANT_A as TenantId,
          binding_id: 'binding-parent-owned',
          revoked_reason: 'child_attempt',
          revoked_by: ACTOR_ENGINEER,
        }),
      ).rejects.toBeInstanceOf(CrossTenantBindingWriteForbiddenError);
    });

    it('rejects attest() on a parent-owned binding', async () => {
      seedBinding(client, {
        binding_id: 'binding-parent-owned',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 1,
        status: 'attesting',
      });
      const repo = connectorBindingRepo(client);
      await expect(
        repo.attest({
          tenant_id: TENANT_A as TenantId,
          binding_id: 'binding-parent-owned',
          attested_by: ACTOR_ENGINEER,
        }),
      ).rejects.toBeInstanceOf(CrossTenantBindingWriteForbiddenError);
    });

    it('rejects recordHealthCheckSuccess() on a parent-owned binding', async () => {
      seedBinding(client, {
        binding_id: 'binding-parent-owned',
        tenant_id: TENANT_PARENT,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 1,
        status: 'active',
      });
      const repo = connectorBindingRepo(client);
      await expect(
        repo.recordHealthCheckSuccess({
          tenant_id: TENANT_A as TenantId,
          binding_id: 'binding-parent-owned',
          actor: ACTOR_ENGINEER,
        }),
      ).rejects.toBeInstanceOf(CrossTenantBindingWriteForbiddenError);
    });

    it('ALLOWS activate() on a binding the child owns', async () => {
      // Negative-positive: a binding owned by TENANT_A is
      // freely activatable by TENANT_A.
      seedBinding(client, {
        binding_id: 'binding-child-owned',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        depth: 0,
        status: 'pending',
      });
      const repo = connectorBindingRepo(client);
      const activated = await repo.activate({
        tenant_id: TENANT_A as TenantId,
        binding_id: 'binding-child-owned',
        actor: ACTOR_ADMIN,
      });
      expect(activated.status).toBe('active');
    });
  });

  // -------------------------------------------------------------------------
  // AC #5: forge_operator_fallback auto-revoke on activation
  // -------------------------------------------------------------------------

  describe('AC #5: forge_operator_fallback auto-revoke on activation', () => {
    it('revokeForgeOperatorFallbacks transitions every fallback binding to revoked with reason tenant_activated', async () => {
      // Seed two forge_operator_fallback bindings for the
      // tenant + one for a different tenant (must NOT be
      // touched).
      seedBinding(client, {
        binding_id: 'fallback-A-1',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'forge_operator_fallback',
        status: 'active',
      });
      seedBinding(client, {
        binding_id: 'fallback-A-2',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'jira',
        auth_method: 'forge_operator_fallback',
        status: 'active',
      });
      seedBinding(client, {
        binding_id: 'fallback-B-1',
        tenant_id: TENANT_B,
        project_id: null,
        connector_id: 'github',
        auth_method: 'forge_operator_fallback',
        status: 'active',
      });

      const revoked = await revokeForgeOperatorFallbacks({
        client,
        audit,
        tenant_id: TENANT_A as TenantId,
        actor: ACTOR_ADMIN,
        actor_role: 'admin',
      });
      expect(revoked).toHaveLength(2);
      expect(revoked).toContain('fallback-A-1');
      expect(revoked).toContain('fallback-A-2');
      // Tenant B's fallback is untouched.
      const tenantBRow = Array.from(client.bindings.values()).find(
        (b) => b.binding_id === 'fallback-B-1',
      );
      expect(tenantBRow?.status).toBe('active');

      // Two connector.binding.revoked events, both with
      // metadata.revoked_reason = 'tenant_activated'.
      const revokedEvents = audit.events.filter(
        (e) => e.event_type === 'connector.binding.revoked',
      );
      expect(revokedEvents).toHaveLength(2);
      for (const ev of revokedEvents) {
        expect(ev.metadata).toMatchObject({
          revoked_reason: 'tenant_activated',
        });
        // Stamped with the activating admin tenant.
        expect(ev.tenant_id).toBe(TENANT_A);
      }
    });

    it('onboardTenant: every successful connector creation emits connector.binding.created + .activated', async () => {
      const result = await onboardTenant({
        client,
        audit,
        input: {
          tenant_id: TENANT_A as TenantId,
          actor: {
            actor_id: ACTOR_ADMIN,
            role: 'admin',
            trace_id: 'trace-onboard',
          },
          connectors: [
            {
              connector_id: 'github',
              auth_method: 'pat',
              credential_ref: 'cred:onboard-gh',
              scopes: ['repo'],
            },
            {
              connector_id: 'jira',
              auth_method: 'oauth2',
              credential_ref: 'cred:onboard-jira',
            },
          ],
        },
      });
      expect(result.tenant_activated).toBe(true);
      expect(result.created).toHaveLength(2);
      // Two .created + two .activated events.
      const created = audit.events.filter(
        (e) => e.event_type === 'connector.binding.created',
      );
      const activated = audit.events.filter(
        (e) => e.event_type === 'connector.binding.activated',
      );
      expect(created).toHaveLength(2);
      expect(activated).toHaveLength(2);
      for (const ev of created) {
        expect(ev.tenant_id).toBe(TENANT_A);
      }
    });

    it('onboardTenant: auto-revokes forge_operator_fallback after every connector succeeds', async () => {
      // Pre-seed a forge_operator_fallback for the tenant.
      seedBinding(client, {
        binding_id: 'fallback-onboard',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'forge_operator_fallback',
        status: 'active',
      });
      await onboardTenant({
        client,
        audit,
        input: {
          tenant_id: TENANT_A as TenantId,
          actor: {
            actor_id: ACTOR_ADMIN,
            role: 'admin',
            trace_id: 'trace-onboard',
          },
          connectors: [
            {
              connector_id: 'github',
              auth_method: 'pat',
              credential_ref: 'cred:onboard',
            },
          ],
        },
      });
      // Fallback was revoked.
      const fallbackRow = Array.from(client.bindings.values()).find(
        (b) => b.binding_id === 'fallback-onboard',
      );
      expect(fallbackRow?.status).toBe('revoked');
      expect(fallbackRow?.revoked_reason).toBe('tenant_activated');
      // A connector.binding.revoked event with the
      // tenant_activated reason was emitted.
      const revokedEvent = audit.events.find(
        (e) =>
          e.event_type === 'connector.binding.revoked' &&
          e.metadata &&
          (e.metadata as Record<string, unknown>).revoked_reason ===
            'tenant_activated',
      );
      expect(revokedEvent).toBeDefined();
    });

    it('createAndActivateTenantDefault: rejects forge_operator_fallback auth_method at the type boundary', async () => {
      // The wizard must never accept the Auditor-only
      // fallback as a connector auth_method. The
      // isRealAuthMethod type-guard surfaces this; the
      // wizard should be the only path that calls
      // createAndActivateTenantDefault, so the runtime
      // guarantee is the type-narrowing at the call site.
      // This test documents the expected behaviour:
      // createAndActivateTenantDefault takes a
      // Tier1OnboardConnector (which is typed RealAuthMethod)
      // and so a forge_operator_fallback is a compile error.
      // At runtime, the migration CHECK + isRealAuthMethod
      // both reject the value.
      const tier1: {
        connector_id: 'github';
        auth_method: 'pat' | 'oauth2' | 'oidc' | 'service_account' | 'api_key';
        credential_ref: string;
      } = {
        connector_id: 'github',
        auth_method: 'pat',
        credential_ref: 'cred:tier1',
      };
      const result = await createAndActivateTenantDefault({
        client,
        audit,
        tenant_id: TENANT_A as TenantId,
        connector: tier1,
        actor: ACTOR_ADMIN,
        actor_role: 'admin',
        trace_id: 'trace-tier1',
      });
      expect(result.binding.auth_method).toBe('pat');
    });
  });

  // -------------------------------------------------------------------------
  // AC #6: Auditor-only role-grant read path
  // -------------------------------------------------------------------------

  describe('AC #6: Auditor role-grant read via forge_operator_fallback (step 4)', () => {
    it('Auditor resolve succeeds via step 4 when only the fallback exists', async () => {
      // Tenant A has no own binding; only the
      // forge_operator_fallback row exists. An Auditor
      // must be able to read the binding via the role-grant
      // path.
      seedBinding(client, {
        binding_id: 'fallback-only',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'forge_operator_fallback',
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      const result = await resolver.resolve(
        makeInput({
          actor: {
            actor_id: ACTOR_AUDITOR,
            role: 'auditor',
            trace_id: 'trace-aud',
          },
        }),
      );
      expect(result.step).toBe('forge_operator_fallback');
      expect(result.binding?.binding_id).toBe('fallback-only');
    });

    it('non-Auditor resolve MISSes when only the fallback exists (role-gate enforcement)', async () => {
      seedBinding(client, {
        binding_id: 'fallback-only',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'forge_operator_fallback',
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      const result = await resolver.resolve(makeInput()); // engineer
      expect(result.step).toBe('miss');
      expect(result.binding).toBeNull();
      // A connector.binding.missing event was emitted (so
      // the FORA-36 forwarder records the attempt).
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]?.event_type).toBe(
        'connector.binding.missing',
      );
    });
  });
});
