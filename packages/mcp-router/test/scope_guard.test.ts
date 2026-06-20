/**
 * @fora/mcp-router — scope-guard test suite
 *
 * Covers FORA-448 / FORA-48 §3.5: the per-tenant scope guard that wires
 * identity-broker (tenant validation) and customer-cloud-broker (credential
 * resolution) into the router.
 *
 * Acceptance (mirrors FORA-48 AC #3):
 *   - tenant A's session attempting tenant B's MCP returns `scope_denied`
 *     (or the scope-guard subclass) and never spawns tenant B's process
 *     (transport.invoke is never called).
 *   - When identity-broker is unreachable the router fails CLOSED.
 *   - When customer-cloud-broker refuses a credential the router fails CLOSED.
 *   - Happy path: validator approves + resolver mints credential → transport
 *     is called exactly once with `ctx.credential` populated.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  InMemoryAuditSink,
  InMemoryMcpRouter,
  ScriptedTransport,
  asServerName,
  asTenantId,
  asToolName,
  isCredentialDenied,
  isMcpError,
  isResolverUnreachable,
  isTenantInvalid,
  isValidatorUnreachable,
  type CredentialResolver,
  type McpRequestContext,
  type ServerManifest,
  type TenantValidator,
  type ToolName,
} from '../src/index.js';

// ---------- fixtures ----------------------------------------------------

const tenantIdA = asTenantId('tnt_A');
const tenantIdB = asTenantId('tnt_B');

const GLOBAL_TOOL = asToolName('ping');
const TENANT_B_TOOL = asToolName('create_issue');

// A *global* MCP (visible to anyone) — used for happy-path scope guard tests.
const GLOBAL_MANIFEST: ServerManifest = {
  name: asServerName('secrets'),
  bin: 'node',
  argv: ['secrets.js'],
  tenantScope: 'global',
  tools: [
    {
      name: GLOBAL_TOOL,
      label: 'Ping',
      description: 'Liveness check',
      input_schema: { type: 'object', properties: {} },
      tags: ['read'],
    },
  ],
};

// A *tenant-scoped* MCP owned by tenant B — used for the cross-tenant AC #3
// test. Tenant A's session MUST NOT reach this server, and the transport
// MUST NOT be invoked.
const TENANT_B_MANIFEST: ServerManifest = {
  name: asServerName('jira'),
  bin: 'node',
  argv: ['jira.js'],
  tenantScope: 'tenant',
  tenantId: tenantIdB,
  tools: [
    {
      name: TENANT_B_TOOL,
      label: 'Create Issue',
      description: 'Create a Jira issue in tenant B',
      input_schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
      tags: ['write'],
    },
  ],
};

const CTX_A_AGENT: McpRequestContext = {
  tenant_id: tenantIdA,
  principal: 'agent',
  actor: 'agent:developer:run-001',
  trace_id: 'trace-A',
  agent_type: 'developer',
};

// ---------- scaffolding -------------------------------------------------

interface ScopeGuardHarness {
  audit: InMemoryAuditSink;
  scripted: ScriptedTransport;
  router: InMemoryMcpRouter;
}

function makeHarness(
  opts: {
    validator?: TenantValidator;
    resolver?: CredentialResolver;
    scriptedQueue?: Array<{ kind: 'ok'; result: unknown } | { kind: 'throw'; message: string }>;
  } = {},
): ScopeGuardHarness {
  const audit = new InMemoryAuditSink();
  const scripted = new ScriptedTransport(opts.scriptedQueue ?? [{ kind: 'ok', result: { pong: true } }]);
  const router = new InMemoryMcpRouter({
    audit,
    transport: scripted,
    ...(opts.validator ? { tenant_validator: opts.validator } : {}),
    ...(opts.resolver ? { credential_resolver: opts.resolver } : {}),
  });
  return { audit, scripted, router };
}

// ---------- TenantValidator (identity-broker) --------------------------

describe('scope guard: tenant validator (identity-broker)', () => {
  let harness: ScopeGuardHarness;

  beforeEach(async () => {
    harness = makeHarness({
      validator: {
        async validate(tid) {
          // Approve tenant A; reject everyone else.
          return tid === tenantIdA
            ? { ok: true }
            : { ok: false, reason: `unknown tenant ${tid}` };
        },
      },
    });
    await harness.router.registerServer(GLOBAL_MANIFEST);
    await harness.router.registerServer(TENANT_B_MANIFEST);
  });

  it('AC #3: cross-tenant resolve returns scope-guard error WITHOUT transport call', async () => {
    const before = harness.scripted.invokeCalls;
    const r = await harness.router.resolve(CTX_A_AGENT, TENANT_B_MANIFEST.name, TENANT_B_TOOL);

    expect(isMcpError(r)).toBe(true);
    // AC #3 acceptance — tenant B's MCP process is never spawned.
    // The transport was never called.
    expect(harness.scripted.invokeCalls).toBe(before);

    // The validator-approved tenant A wouldn't reach this code path because
    // the manifest's tenantScope is 'tenant' and would be scope_denied anyway.
    // Use a freshly rejected tenant to confirm the validator branch is hit.
    const ctxForeign = { ...CTX_A_AGENT, tenant_id: asTenantId('tnt_FOREIGN') };
    const r2 = await harness.router.resolve(ctxForeign, TENANT_B_MANIFEST.name, TENANT_B_TOOL);
    expect(isMcpError(r2)).toBe(true);
    if (isMcpError(r2)) {
      expect(isTenantInvalid(r2)).toBe(true);
      expect(r2.error.kind).toBe('tenant_invalid');
    }
    // Still no transport call.
    expect(harness.scripted.invokeCalls).toBe(before);
  });

  it('rejects invoke before scope gate when validator says no', async () => {
    const ctxForeign = { ...CTX_A_AGENT, tenant_id: asTenantId('tnt_FOREIGN') };
    const before = harness.scripted.invokeCalls;
    const r = await harness.router.invoke(
      ctxForeign,
      GLOBAL_MANIFEST.name,
      GLOBAL_TOOL,
      {},
    );
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isTenantInvalid(r)).toBe(true);
    }
    expect(harness.scripted.invokeCalls).toBe(before);
  });

  it('passes invoke through when validator approves the tenant', async () => {
    const before = harness.scripted.invokeCalls;
    const r = await harness.router.invoke(
      CTX_A_AGENT,
      GLOBAL_MANIFEST.name,
      GLOBAL_TOOL,
      {},
    );
    expect(r.status).toBe('ok');
    expect(harness.scripted.invokeCalls).toBe(before + 1);
  });

  it('emits mcp.scope_guard audit on validator rejection', async () => {
    const ctxForeign = { ...CTX_A_AGENT, tenant_id: asTenantId('tnt_FOREIGN') };
    await harness.router.invoke(ctxForeign, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    const events = harness.audit.ofKind('mcp.scope_guard');
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.outcome).toBe('tenant_invalid');
    expect(event?.reason).toContain('unknown tenant tnt_FOREIGN');
  });

  it('emits mcp.scope_guard audit on validator_unreachable when validator throws', async () => {
    const audit2 = new InMemoryAuditSink();
    const scripted2 = new ScriptedTransport([{ kind: 'ok', result: {} }]);
    const failing: TenantValidator = {
      async validate() {
        throw new Error('connection refused: identity-broker unreachable');
      },
    };
    const r2 = new InMemoryMcpRouter({
      audit: audit2,
      transport: scripted2,
      tenant_validator: failing,
    });
    await r2.registerServer(GLOBAL_MANIFEST);
    const before = scripted2.invokeCalls;
    const r = await r2.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isValidatorUnreachable(r)).toBe(true);
      expect(r.error.kind).toBe('validator_unreachable');
    }
    expect(scripted2.invokeCalls).toBe(before); // no transport call
    const events = audit2.ofKind('mcp.scope_guard');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('validator_unreachable');
    expect(events[0]?.reason).toContain('connection refused');
  });
});

// ---------- CredentialResolver (customer-cloud-broker) ------------------

describe('scope guard: credential resolver (customer-cloud-broker)', () => {
  let audit: InMemoryAuditSink;
  let scripted: ScriptedTransport;
  let seenCredentials: Array<unknown>;

  beforeEach(async () => {
    audit = new InMemoryAuditSink();
    seenCredentials = [];
    scripted = new ScriptedTransport([{ kind: 'ok', result: { pong: true } }]);
  });

  it('populates ctx.credential before transport.invoke is called', async () => {
    const resolver: CredentialResolver = {
      async resolve(tid, server) {
        return { ok: true, credential: { token: `cred-${tid}-${server}` } };
      },
    };
    const router = new InMemoryMcpRouter({
      audit,
      transport: {
        async invoke(_m, _t, _a, ctx) {
          seenCredentials.push(ctx.credential);
          return { pong: true };
        },
      },
      credential_resolver: resolver,
    });
    await router.registerServer(GLOBAL_MANIFEST);
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(r.status).toBe('ok');
    expect(seenCredentials).toHaveLength(1);
    expect(seenCredentials[0]).toEqual({ token: `cred-${tenantIdA}-${GLOBAL_MANIFEST.name}` });
  });

  it('returns credential_denied WITHOUT transport call when resolver rejects', async () => {
    const resolver: CredentialResolver = {
      async resolve() {
        return { ok: false, reason: 'tenant B trust is cloud_disabled' };
      },
    };
    const router = new InMemoryMcpRouter({ audit, transport: scripted, credential_resolver: resolver });
    await router.registerServer(GLOBAL_MANIFEST);
    const before = scripted.invokeCalls;
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isCredentialDenied(r)).toBe(true);
      expect(r.error.kind).toBe('credential_denied');
      if (r.error.kind === 'credential_denied') {
        expect(r.error.message).toContain('cloud_disabled');
      }
    }
    expect(scripted.invokeCalls).toBe(before); // no spawn
    const events = audit.ofKind('mcp.scope_guard');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('credential_denied');
  });

  it('returns resolver_unreachable WITHOUT transport call when resolver throws', async () => {
    const resolver: CredentialResolver = {
      async resolve() {
        throw new Error('connection refused: customer-cloud-broker unreachable');
      },
    };
    const router = new InMemoryMcpRouter({ audit, transport: scripted, credential_resolver: resolver });
    await router.registerServer(GLOBAL_MANIFEST);
    const before = scripted.invokeCalls;
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isResolverUnreachable(r)).toBe(true);
    }
    expect(scripted.invokeCalls).toBe(before);
    const events = audit.ofKind('mcp.scope_guard');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('resolver_unreachable');
  });
});

// ---------- Combined validator + resolver -------------------------------

describe('scope guard: validator + resolver together', () => {
  it('runs validator before resolver (validator failure short-circuits resolver)', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([{ kind: 'ok', result: {} }]);
    let validatorCalls = 0;
    let resolverCalls = 0;
    const validator: TenantValidator = {
      async validate() {
        validatorCalls += 1;
        return { ok: false, reason: 'tenant disabled' };
      },
    };
    const resolver: CredentialResolver = {
      async resolve() {
        resolverCalls += 1;
        return { ok: true, credential: { token: 'should-never-mint' } };
      },
    };
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: validator,
      credential_resolver: resolver,
    });
    await router.registerServer(GLOBAL_MANIFEST);
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isTenantInvalid(r)).toBe(true);
    }
    expect(validatorCalls).toBe(1);
    expect(resolverCalls).toBe(0); // resolver never called — fail closed at stage 0
    expect(scripted.invokeCalls).toBe(0);
  });

  it('happy path: validator approves → resolver mints → transport called once', async () => {
    const audit = new InMemoryAuditSink();
    let transportCalls = 0;
    let credentialSeen: unknown = 'unset';
    const router = new InMemoryMcpRouter({
      audit,
      transport: {
        async invoke(_m, _t, _a, ctx) {
          transportCalls += 1;
          credentialSeen = ctx.credential;
          return { pong: true };
        },
      },
      tenant_validator: {
        async validate(tid) {
          return tid === tenantIdA ? { ok: true } : { ok: false, reason: 'unknown' };
        },
      },
      credential_resolver: {
        async resolve(tid, srv) {
          return { ok: true, credential: { mintedFor: `${tid}@${srv}` } };
        },
      },
    });
    await router.registerServer(GLOBAL_MANIFEST);
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(r.status).toBe('ok');
    expect(transportCalls).toBe(1);
    expect(credentialSeen).toEqual({ mintedFor: `${tenantIdA}@${GLOBAL_MANIFEST.name}` });
    // No scope_guard audit events on the happy path.
    expect(audit.ofKind('mcp.scope_guard')).toHaveLength(0);
  });
});

// ---------- resolve() guard path ----------------------------------------

describe('scope guard: resolve() consults the validator', () => {
  it('returns tenant_invalid from resolve when validator rejects, no transport call', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([]);
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: {
        async validate() {
          return { ok: false, reason: 'unknown tenant' };
        },
      },
    });
    await router.registerServer(GLOBAL_MANIFEST);
    const before = scripted.invokeCalls;
    const r = await router.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL);
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isTenantInvalid(r)).toBe(true);
    }
    expect(scripted.invokeCalls).toBe(before);
  });

  it('returns validator_unreachable from resolve when validator throws', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([]);
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: {
        async validate() {
          throw new Error('upstream timeout');
        },
      },
    });
    await router.registerServer(GLOBAL_MANIFEST);
    const before = scripted.invokeCalls;
    const r = await router.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL);
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isValidatorUnreachable(r)).toBe(true);
    }
    expect(scripted.invokeCalls).toBe(before);
  });
});
