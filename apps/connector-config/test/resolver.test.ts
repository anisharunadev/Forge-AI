/**
 * Resolver tests — five-step walk + MISS handling + Auditor gating.
 *
 * Sub-task: FORA-485 acceptance #2: "Five-step resolver implemented
 * with explicit MISS handling."
 *
 * The tests use the in-memory `FakeScopedClient` to drive the
 * resolver. The fake mirrors the SQL patterns the repo issues
 * so the test exercises the actual resolver code paths without
 * requiring a real Postgres. The integration test
 * (`resolver.integration.test.ts`) wires a real `TenantAwarePool`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConnectorConfigResolver,
  InProcessConnectorConfigCache,
  cacheKey,
  createInMemoryAuditSink,
} from '../src/index.js';
import {
  ConnectorBindingMissingError,
  type ResolveBindingInput,
} from '../src/types.js';
import { FakeScopedClient, seedBinding } from './fakes.js';
import type { TenantId, ActorId } from '@fora/db-pool';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TENANT_PARENT = '33333333-3333-3333-3333-333333333333';

const PROJECT_X = '44444444-4444-4444-4444-444444444444';

const ACTOR_ENGINEER: ActorId = 'user:engineer';
const ACTOR_AUDITOR: ActorId = 'user:auditor';

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

describe('connector-config/resolver', () => {
  let client: FakeScopedClient;
  let audit: ReturnType<typeof createInMemoryAuditSink>;
  let cache: InProcessConnectorConfigCache;

  beforeEach(() => {
    client = new FakeScopedClient();
    audit = createInMemoryAuditSink();
    cache = new InProcessConnectorConfigCache();
  });

  // -------------------------------------------------------------------------
  // Step 1: project override
  // -------------------------------------------------------------------------

  it('resolves via step 1 when a project override is active', async () => {
    seedBinding(client, {
      binding_id: 'binding-proj',
      tenant_id: TENANT_A,
      project_id: PROJECT_X,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    const result = await resolver.resolve(
      makeInput({ project_id: PROJECT_X }),
    );
    expect(result.step).toBe('project_override');
    expect(result.binding?.binding_id).toBe('binding-proj');
  });

  it('falls through step 1 when project override is attesting (refused)', async () => {
    seedBinding(client, {
      binding_id: 'binding-proj-attesting',
      tenant_id: TENANT_A,
      project_id: PROJECT_X,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'attesting',
    });
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    const result = await resolver.resolve(
      makeInput({ project_id: PROJECT_X }),
    );
    // step 1 row was `attesting` (refused by isResolvable),
    // so the resolver falls through to step 2.
    expect(result.step).toBe('tenant_default');
    expect(result.binding?.binding_id).toBe('binding-default');
  });

  // -------------------------------------------------------------------------
  // Step 2: tenant default
  // -------------------------------------------------------------------------

  it('resolves via step 2 when no project override but a tenant default exists', async () => {
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    const result = await resolver.resolve(makeInput());
    expect(result.step).toBe('tenant_default');
    expect(result.binding?.binding_id).toBe('binding-default');
  });

  // -------------------------------------------------------------------------
  // Step 3: tenant inherited (depth <= 3)
  // -------------------------------------------------------------------------

  it('resolves via step 3 by walking parent_tenant_id chain', async () => {
    // Parent tenant has the binding at depth=1.
    seedBinding(client, {
      binding_id: 'binding-inherited',
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
    expect(result.binding?.binding_id).toBe('binding-inherited');
  });

  // -------------------------------------------------------------------------
  // Step 4: forge_operator_fallback (Auditor only)
  // -------------------------------------------------------------------------

  it('resolves via step 4 when actor is Auditor and fallback exists', async () => {
    seedBinding(client, {
      binding_id: 'binding-fallback',
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
    expect(result.binding?.binding_id).toBe('binding-fallback');
  });

  it('does NOT resolve via step 4 when actor is not Auditor (falls to MISS)', async () => {
    seedBinding(client, {
      binding_id: 'binding-fallback',
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
    const result = await resolver.resolve(makeInput()); // engineer actor
    expect(result.step).toBe('miss');
    expect(result.binding).toBeNull();
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.event_type).toBe('connector.binding.missing');
  });

  // -------------------------------------------------------------------------
  // Step 5: MISS
  // -------------------------------------------------------------------------

  it('resolves to MISS and emits connector.binding.missing when no chain matches', async () => {
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    const result = await resolver.resolve(makeInput());
    expect(result.step).toBe('miss');
    expect(result.binding).toBeNull();
    expect(audit.events).toHaveLength(1);
    const event = audit.events[0];
    expect(event?.event_type).toBe('connector.binding.missing');
    expect(event?.metadata).toMatchObject({
      attempted_auth_method: 'pat',
      attempted_steps: [
        'project_override',
        'tenant_default',
        'tenant_inherited',
        'forge_operator_fallback',
      ],
    });
  });

  it('resolveOrThrow raises ConnectorBindingMissingError on MISS', async () => {
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    await expect(resolver.resolveOrThrow(makeInput())).rejects.toThrow(
      ConnectorBindingMissingError,
    );
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  it('returns cache_hit on the second resolve with the same key', async () => {
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    const first = await resolver.resolve(makeInput());
    expect(first.cache_hit).toBe(false);
    const second = await resolver.resolve(makeInput());
    expect(second.cache_hit).toBe(true);
    expect(second.step).toBe('project_override'); // Cached step survives cache_hit.
  });

  it('cache key includes project_id (project vs tenant-default are distinct)', async () => {
    seedBinding(client, {
      binding_id: 'binding-default',
      tenant_id: TENANT_A,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
      status: 'active',
    });
    const resolver = new ConnectorConfigResolver({
      client,
      audit,
      cache,
    });
    const tenantDefault = await resolver.resolve(makeInput());
    expect(tenantDefault.step).toBe('tenant_default');
    // Same tenant + project_id=PROJECT_X is a distinct cache key.
    const withProject = await resolver.resolve(
      makeInput({ project_id: PROJECT_X }),
    );
    expect(withProject.step).toBe('miss');
  });

  // -------------------------------------------------------------------------
  // No silent cross-tenant fallback
  // -------------------------------------------------------------------------

  it('does NOT silently fall back to a binding from a different tenant', async () => {
    // Tenant B has an active tenant default; tenant A does not.
    seedBinding(client, {
      binding_id: 'binding-B',
      tenant_id: TENANT_B,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
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

  // -------------------------------------------------------------------------
  // Tenant isolation at the resolver boundary (RLS posture)
  // -------------------------------------------------------------------------

  it('does not surface a Tenant B binding even when Tenant A has none', async () => {
    seedBinding(client, {
      binding_id: 'binding-B-only',
      tenant_id: TENANT_B,
      project_id: null,
      connector_id: 'github',
      auth_method: 'pat',
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
    expect(result.step).toBe('miss');
    expect(result.binding).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FORA-544 — cache key contract + cross-tenant leak guard
  //
  // AC #3: "Cache key matches spec; integration test confirms no
  // cross-tenant leak." The spec names the 4-tuple
  // (connector_id, tenant_id, project_id, auth_method); the tests
  // below pin the string form and prove a populated cache for
  // tenant A does not leak into tenant B's resolution.
  // -------------------------------------------------------------------------

  describe('cache key contract', () => {
    it('cacheKey string contains all four fields in the spec order', () => {
      const key = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'github',
        auth_method: 'pat',
      });
      // Order: tenant_id|project_id|connector_id|auth_method per Plan 4 §2.
      expect(key).toBe(`${TENANT_A}|${PROJECT_X}|github|pat`);
      expect(key).toContain(TENANT_A);
      expect(key).toContain(PROJECT_X);
      expect(key).toContain('github');
      expect(key).toContain('pat');
    });

    it('cacheKey projects the tenant-default sentinel when project_id is null', () => {
      const key = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
      });
      // The sentinel must NOT collide with a real project_id value
      // (project UUIDs are v4-shaped, never '<tenant-default>').
      expect(key).toBe(`${TENANT_A}|<tenant-default>|github|pat`);
    });

    it('same 4-tuple produces identical key (deterministic)', () => {
      const a = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'github',
        auth_method: 'pat',
      });
      const b = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'github',
        auth_method: 'pat',
      });
      expect(a).toBe(b);
    });

    it('different tenant_id produces a different key (cross-tenant guard)', () => {
      const a = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
      });
      const b = cacheKey({
        tenant_id: TENANT_B as TenantId,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
      });
      expect(a).not.toBe(b);
    });

    it('different auth_method produces a different key', () => {
      const a = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'github',
        auth_method: 'pat',
      });
      const b = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'github',
        auth_method: 'oauth2',
      });
      expect(a).not.toBe(b);
    });

    it('different connector_id produces a different key', () => {
      const a = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'github',
        auth_method: 'pat',
      });
      const b = cacheKey({
        tenant_id: TENANT_A as TenantId,
        project_id: PROJECT_X,
        connector_id: 'gitlab',
        auth_method: 'pat',
      });
      expect(a).not.toBe(b);
    });
  });

  describe('cross-tenant cache leak guard', () => {
    it('does NOT return a tenant A cached binding to a tenant B resolution', async () => {
      // Tenant A has an active tenant-default binding for github/pat.
      seedBinding(client, {
        binding_id: 'binding-A',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      // Warm the cache with tenant A's resolution.
      const aResult = await resolver.resolve(makeInput());
      expect(aResult.step).toBe('tenant_default');
      expect(aResult.binding?.binding_id).toBe('binding-A');
      expect(aResult.cache_hit).toBe(false);

      // Resolve again for tenant A — cache_hit flips to true.
      const aCached = await resolver.resolve(makeInput());
      expect(aCached.cache_hit).toBe(true);
      expect(aCached.binding?.binding_id).toBe('binding-A');

      // Tenant B with the same connector_id / project_id / auth_method
      // must NOT see tenant A's binding. No binding is seeded for
      // tenant B; tenant B's resolver must walk to step 5 and MISS.
      // The cache lookup is keyed on tenant_id first, so a cache
      // hit for tenant A does NOT short-circuit tenant B.
      const bResult = await resolver.resolve(
        makeInput({ tenant_id: TENANT_B as TenantId }),
      );
      expect(bResult.step).toBe('miss');
      expect(bResult.binding).toBeNull();
      expect(bResult.cache_hit).toBe(false);
      // One connector.binding.missing event was emitted for tenant
      // B's MISS. Tenant A's first resolve did not emit (it
      // resolved); the second cache hit did not emit either.
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]?.event_type).toBe('connector.binding.missing');
      expect(audit.events[0]?.tenant_id).toBe(TENANT_B);
    });

    it('a populated cache for one auth_method does not leak to a different auth_method', async () => {
      seedBinding(client, {
        binding_id: 'binding-pat',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      // Warm cache for github/pat.
      const patResult = await resolver.resolve(makeInput());
      expect(patResult.step).toBe('tenant_default');
      expect(patResult.binding?.binding_id).toBe('binding-pat');

      // github/oauth2 is a separate cache key. Tenant A has no row
      // for that auth_method → MISS.
      const oauthResult = await resolver.resolve(
        makeInput({ auth_method: 'oauth2' }),
      );
      expect(oauthResult.step).toBe('miss');
      expect(oauthResult.binding).toBeNull();
      expect(oauthResult.cache_hit).toBe(false);
    });

    it('invalidatePrefix evicts only entries for the named (tenant_id, connector_id)', async () => {
      seedBinding(client, {
        binding_id: 'binding-A',
        tenant_id: TENANT_A,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        status: 'active',
      });
      seedBinding(client, {
        binding_id: 'binding-B',
        tenant_id: TENANT_B,
        project_id: null,
        connector_id: 'github',
        auth_method: 'pat',
        status: 'active',
      });
      const resolver = new ConnectorConfigResolver({
        client,
        audit,
        cache,
      });
      // Warm both tenants' caches.
      await resolver.resolve(makeInput());
      await resolver.resolve(makeInput({ tenant_id: TENANT_B as TenantId }));
      // Invalidate only tenant A's github entries.
      cache.invalidatePrefix({
        tenant_id: TENANT_A as TenantId,
        connector_id: 'github',
      });
      // Tenant A re-resolves from the repo (cache_hit=false).
      const a = await resolver.resolve(makeInput());
      expect(a.cache_hit).toBe(false);
      // Tenant B still hits the cache.
      const b = await resolver.resolve(
        makeInput({ tenant_id: TENANT_B as TenantId }),
      );
      expect(b.cache_hit).toBe(true);
      expect(b.binding?.binding_id).toBe('binding-B');
    });
  });
});