/**
 * forge-ai/mcp-router — test suite
 *
 * Covers the McpRouter port contract end-to-end:
 *   - register / listServers / resolve / invoke
 *   - every McpError variant
 *   - per-server circuit breaker (threshold + cooldown half-open)
 *   - tenant-scope gate (global / tenant / agent)
 *   - audit emission for every code path
 *   - manifest validation (programmer-error throws)
 *
 * Acceptance: 80%+ line coverage on `src/`.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  InMemoryMcpRouter,
  InMemoryAuditSink,
  ScriptedTransport,
  asServerName,
  asTenantId,
  asToolName,
  isArgsInvalid,
  isCircuitOpen,
  isMcpError,
  isScopeDenied,
  isToolNotFound,
  isUnavailable,
  isUpstreamError,
  type McpAuditEvent,
  type McpRequestContext,
  type ServerManifest,
  type ToolName,
} from '../src/index.js';

// ---------- fixtures ----------------------------------------------------

const GLOBAL_TOOL = asToolName('ping');
const TENANT_TOOL = asToolName('create_issue');
const AGENT_TOOL = asToolName('lint');

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

const tenantIdA = asTenantId('tnt_A');
const tenantIdB = asTenantId('tnt_B');
const TENANT_MANIFEST_A: ServerManifest = {
  name: asServerName('jira'),
  bin: 'node',
  argv: ['jira.js'],
  tenantScope: 'tenant',
  tenantId: tenantIdA,
  tools: [
    {
      name: TENANT_TOOL,
      label: 'Create Issue',
      description: 'Create a Jira issue',
      input_schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
      tags: ['write'],
    },
  ],
};

const AGENT_MANIFEST: ServerManifest = {
  name: asServerName('coder-helpers'),
  bin: 'node',
  argv: ['coder.js'],
  tenantScope: 'agent',
  tenantId: tenantIdA,
  agentType: 'developer',
  tools: [
    {
      name: AGENT_TOOL,
      label: 'Lint',
      description: 'Lint a file',
      input_schema: { type: 'object', properties: { file: { type: 'string' } } },
    },
  ],
};

const CTX_A_AGENT: McpRequestContext = {
  tenant_id: tenantIdA,
  principal: 'agent',
  actor: 'agent:developer:run-001',
  trace_id: 'trace-001',
  agent_type: 'developer',
};

const CTX_A_BOARD: McpRequestContext = {
  tenant_id: tenantIdA,
  principal: 'board_user',
  actor: 'user:okta-sub',
};

const CTX_B_AGENT: McpRequestContext = {
  tenant_id: tenantIdB,
  principal: 'agent',
  actor: 'agent:developer:run-002',
  agent_type: 'developer',
};

// ---------- scaffolding -------------------------------------------------

let audit: InMemoryAuditSink;
let router: InMemoryMcpRouter;
let scripted: ScriptedTransport;

beforeEach(() => {
  audit = new InMemoryAuditSink();
  scripted = new ScriptedTransport([]);
  router = new InMemoryMcpRouter({ audit, transport: scripted });
});

// ---------- registration -----------------------------------------------

describe('registerServer', () => {
  it('registers and returns ok', async () => {
    const result = await router.registerServer(GLOBAL_MANIFEST);
    expect(result.status).toBe('ok');
    expect(await router.listServers(CTX_A_AGENT)).toContainEqual(GLOBAL_MANIFEST);
  });

  it('emits an mcp.register audit event', async () => {
    await router.registerServer(GLOBAL_MANIFEST);
    const events = audit.ofKind('mcp.register');
    expect(events).toHaveLength(1);
    expect(events[0]?.server).toBe(GLOBAL_MANIFEST.name);
  });

  it('rejects empty name', async () => {
    await expect(
      router.registerServer({ ...GLOBAL_MANIFEST, name: '' as ReturnType<typeof asServerName> }),
    ).rejects.toThrow('manifest.name is required');
  });

  it('rejects empty bin', async () => {
    await expect(
      router.registerServer({ ...GLOBAL_MANIFEST, bin: '' }),
    ).rejects.toThrow('manifest.bin is required');
  });

  it('rejects tenant scope without tenantId', async () => {
    await expect(
      router.registerServer({ ...TENANT_MANIFEST_A, tenantId: undefined }),
    ).rejects.toThrow('tenant-scoped manifest requires tenantId');
  });

  it('rejects agent scope without tenantId or agentType', async () => {
    await expect(
      router.registerServer({ ...AGENT_MANIFEST, agentType: undefined }),
    ).rejects.toThrow('agent-scoped manifest requires tenantId + agentType');
  });

  it('rejects global scope carrying tenantId', async () => {
    await expect(
      router.registerServer({ ...GLOBAL_MANIFEST, tenantId: tenantIdA }),
    ).rejects.toThrow('global manifest must not carry tenantId/agentType');
  });

  it('rejects duplicate tool names', async () => {
    await expect(
      router.registerServer({
        ...GLOBAL_MANIFEST,
        tools: [
          { ...GLOBAL_MANIFEST.tools[0]! },
          { ...GLOBAL_MANIFEST.tools[0]! },
        ],
      }),
    ).rejects.toThrow(/duplicate tool/);
  });
});

// ---------- listServers -------------------------------------------------

describe('listServers', () => {
  beforeEach(async () => {
    await router.registerServer(GLOBAL_MANIFEST);
    await router.registerServer(TENANT_MANIFEST_A);
    await router.registerServer(AGENT_MANIFEST);
  });

  it('global server visible to any tenant', async () => {
    const list = await router.listServers(CTX_B_AGENT);
    expect(list).toContainEqual(GLOBAL_MANIFEST);
  });

  it('tenant-scoped server hidden from other tenants', async () => {
    const list = await router.listServers(CTX_B_AGENT);
    expect(list).not.toContainEqual(TENANT_MANIFEST_A);
  });

  it('agent-scoped server hidden from non-matching agent_type', async () => {
    const list = await router.listServers(CTX_A_BOARD); // tenant match, no agent_type
    expect(list).not.toContainEqual(AGENT_MANIFEST);
  });

  it('agent-scoped server visible to matching agent', async () => {
    const list = await router.listServers(CTX_A_AGENT);
    expect(list).toContainEqual(AGENT_MANIFEST);
  });

  it('tenant-scoped server visible to same tenant', async () => {
    const list = await router.listServers(CTX_A_AGENT);
    expect(list).toContainEqual(TENANT_MANIFEST_A);
  });
});

// ---------- resolve -----------------------------------------------------

describe('resolve', () => {
  beforeEach(async () => {
    await router.registerServer(GLOBAL_MANIFEST);
    await router.registerServer(TENANT_MANIFEST_A);
    await router.registerServer(AGENT_MANIFEST);
  });

  it('returns manifest + health on hit', async () => {
    const r = await router.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL);
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.manifest).toEqual(GLOBAL_MANIFEST);
      expect(r.health).toBe('healthy');
    }
  });

  it('returns manifest without tool filter when omitted', async () => {
    const r = await router.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name);
    expect(r.status).toBe('resolved');
  });

  it('returns unavailable for unknown server', async () => {
    const r = await router.resolve(CTX_A_AGENT, asServerName('nope'));
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isUnavailable(r)).toBe(true);
      expect(r.error.kind).toBe('unavailable');
    }
  });

  it('returns scope_denied for cross-tenant resolve', async () => {
    const r = await router.resolve(CTX_B_AGENT, TENANT_MANIFEST_A.name, TENANT_TOOL);
    expect(isScopeDenied(r)).toBe(true);
  });

  it('returns scope_denied for cross-agent_type resolve', async () => {
    const r = await router.resolve(CTX_A_BOARD, AGENT_MANIFEST.name, AGENT_TOOL);
    expect(isScopeDenied(r)).toBe(true);
  });

  it('returns tool_not_found for unknown tool', async () => {
    const r = await router.resolve(
      CTX_A_AGENT,
      GLOBAL_MANIFEST.name,
      asToolName('nope'),
    );
    expect(isToolNotFound(r)).toBe(true);
    if (isMcpError(r) && r.error.kind === 'tool_not_found') {
      expect(r.error.available_tools).toContain(GLOBAL_TOOL);
    }
  });

  it('emits mcp.resolve audit on success', async () => {
    await router.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL);
    expect(audit.ofKind('mcp.resolve')).toHaveLength(1);
    expect(audit.ofKind('mcp.resolve')[0]?.outcome).toBe('ok');
  });

  it('emits mcp.resolve audit on error', async () => {
    await router.resolve(CTX_A_AGENT, asServerName('nope'));
    const events = audit.ofKind('mcp.resolve');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('unavailable');
  });
});

// ---------- invoke ------------------------------------------------------

describe('invoke', () => {
  beforeEach(async () => {
    await router.registerServer(GLOBAL_MANIFEST);
    await router.registerServer(TENANT_MANIFEST_A);
  });

  it('returns ok on successful transport response', async () => {
    scripted = new ScriptedTransport([{ kind: 'ok', result: { pong: true } }]);
    router = new InMemoryMcpRouter({ audit, transport: scripted });
    await router.registerServer(GLOBAL_MANIFEST);

    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.result).toEqual({ pong: true });
      expect(r.server).toBe(GLOBAL_MANIFEST.name);
      expect(r.tool).toBe(GLOBAL_TOOL);
      expect(typeof r.latency_ms).toBe('number');
    }
  });

  it('returns upstream_error when transport throws', async () => {
    scripted = new ScriptedTransport([{ kind: 'throw', message: 'boom' }]);
    router = new InMemoryMcpRouter({ audit, transport: scripted });
    await router.registerServer(GLOBAL_MANIFEST);

    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isUpstreamError(r)).toBe(true);
    if (isMcpError(r) && r.error.kind === 'upstream_error') {
      expect(r.error.upstream_message).toBe('boom');
    }
  });

  it('returns unavailable for unknown server', async () => {
    const r = await router.invoke(
      CTX_A_AGENT,
      asServerName('nope'),
      GLOBAL_TOOL,
      {},
    );
    expect(isUnavailable(r)).toBe(true);
  });

  it('returns scope_denied for cross-tenant invoke', async () => {
    const r = await router.invoke(
      CTX_B_AGENT,
      TENANT_MANIFEST_A.name,
      TENANT_TOOL,
      { title: 'x' },
    );
    expect(isScopeDenied(r)).toBe(true);
  });

  it('returns tool_not_found when tool is not in manifest', async () => {
    const r = await router.invoke(
      CTX_A_AGENT,
      GLOBAL_MANIFEST.name,
      asToolName('nope'),
      {},
    );
    expect(isToolNotFound(r)).toBe(true);
  });

  it('returns args_invalid when args is not an object', async () => {
    const r = await router.invoke(
      CTX_A_AGENT,
      GLOBAL_MANIFEST.name,
      GLOBAL_TOOL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      null as any,
    );
    expect(isArgsInvalid(r)).toBe(true);
  });

  it('returns args_invalid when args is an array', async () => {
    const r = await router.invoke(
      CTX_A_AGENT,
      GLOBAL_MANIFEST.name,
      GLOBAL_TOOL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [] as any,
    );
    expect(isArgsInvalid(r)).toBe(true);
  });

  it('emits mcp.invoke audit with outcome=ok', async () => {
    scripted = new ScriptedTransport([{ kind: 'ok', result: { pong: true } }]);
    router = new InMemoryMcpRouter({ audit, transport: scripted });
    await router.registerServer(GLOBAL_MANIFEST);

    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(audit.ofKind('mcp.invoke')[0]?.outcome).toBe('ok');
  });

  it('emits mcp.invoke audit with outcome=upstream_error on transport throw', async () => {
    scripted = new ScriptedTransport([{ kind: 'throw', message: 'boom' }]);
    router = new InMemoryMcpRouter({ audit, transport: scripted });
    await router.registerServer(GLOBAL_MANIFEST);

    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(audit.ofKind('mcp.invoke')[0]?.outcome).toBe('upstream_error');
  });

  it('passes ctx and args through to the transport', async () => {
    let captured: { tool: ToolName; args: Record<string, unknown> } | null = null;
    const captureTransport = {
      invoke: async (
        _m: ServerManifest,
        tool: ToolName,
        args: Record<string, unknown>,
        _ctx: McpRequestContext,
      ) => {
        captured = { tool, args };
        return { ok: true };
      },
    };
    const r2 = new InMemoryMcpRouter({ audit, transport: captureTransport });
    await r2.registerServer(GLOBAL_MANIFEST);
    await r2.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, { foo: 'bar' });
    expect(captured).not.toBeNull();
    expect(captured?.tool).toBe(GLOBAL_TOOL);
    expect(captured?.args).toEqual({ foo: 'bar' });
  });
});

// ---------- circuit breaker --------------------------------------------

describe('circuit breaker', () => {
  beforeEach(async () => {
    await router.registerServer(GLOBAL_MANIFEST);
  });

  it('opens after threshold consecutive upstream_errors', async () => {
    scripted = new ScriptedTransport([
      { kind: 'throw', message: '1' },
      { kind: 'throw', message: '2' },
      { kind: 'throw', message: '3' },
      { kind: 'throw', message: '4' },
      { kind: 'throw', message: '5' },
    ]);
    router = new InMemoryMcpRouter({ audit, transport: scripted, breaker_threshold: 5 });
    await router.registerServer(GLOBAL_MANIFEST);

    for (let i = 0; i < 5; i++) {
      const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
      expect(isUpstreamError(r)).toBe(true);
    }
    // 6th call short-circuits — transport not invoked.
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isCircuitOpen(r)).toBe(true);
    expect(scripted.consumed()).toBe(5);
  });

  it('success resets the breaker failure count', async () => {
    scripted = new ScriptedTransport([
      { kind: 'throw', message: '1' },
      { kind: 'throw', message: '2' },
      { kind: 'throw', message: '3' },
      { kind: 'throw', message: '4' },
      { kind: 'ok', result: { ok: true } },
      { kind: 'throw', message: '5' },
    ]);
    router = new InMemoryMcpRouter({ audit, transport: scripted, breaker_threshold: 5 });
    await router.registerServer(GLOBAL_MANIFEST);

    for (let i = 0; i < 4; i++) {
      await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    }
    const okRes = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(okRes.status).toBe('ok');
    // Now 1 fresh failure; breaker should NOT be open yet.
    const failRes = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isUpstreamError(failRes)).toBe(true);
  });

  it('half-opens after cooldown and lets the next call through', async () => {
    let now = 1000;
    const clock = () => now;
    scripted = new ScriptedTransport([
      { kind: 'throw', message: '1' },
      { kind: 'throw', message: '2' },
      { kind: 'throw', message: '3' },
      { kind: 'throw', message: '4' },
      { kind: 'throw', message: '5' },
      { kind: 'ok', result: { recovered: true } },
    ]);
    router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      clock,
      breaker_threshold: 5,
      breaker_cooldown_ms: 1000,
    });
    await router.registerServer(GLOBAL_MANIFEST);

    for (let i = 0; i < 5; i++) {
      await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    }
    // 6th call: circuit open.
    const openRes = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isCircuitOpen(openRes)).toBe(true);

    // Advance past cooldown.
    now += 1500;

    // 7th call: breaker half-opens, transport invoked, succeeds, breaker resets.
    const recovered = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(recovered.status).toBe('ok');
    expect(scripted.consumed()).toBe(6);
  });

  it('does not trip on errors below threshold', async () => {
    scripted = new ScriptedTransport([
      { kind: 'throw', message: '1' },
      { kind: 'throw', message: '2' },
      { kind: 'ok', result: { ok: true } },
    ]);
    router = new InMemoryMcpRouter({ audit, transport: scripted, breaker_threshold: 5 });
    await router.registerServer(GLOBAL_MANIFEST);

    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(r.status).toBe('ok');
  });
});

// ---------- audit sink --------------------------------------------------

describe('audit sink', () => {
  it('uses NullAuditSink by default when none provided', async () => {
    const r = new InMemoryMcpRouter({ transport: scripted });
    await r.registerServer(GLOBAL_MANIFEST);
    await r.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name);
    // No assertion needed beyond not throwing.
  });

  it('emits every code path in the correct order', async () => {
    scripted = new ScriptedTransport([{ kind: 'ok', result: { ok: true } }]);
    router = new InMemoryMcpRouter({ audit, transport: scripted });
    await router.registerServer(GLOBAL_MANIFEST);
    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    const order = audit.snapshot().map((e: McpAuditEvent) => e.kind);
    expect(order).toEqual(['mcp.register', 'mcp.invoke']);
  });

  it('includes trace_id when present on ctx', async () => {
    await router.registerServer(GLOBAL_MANIFEST);
    await router.resolve(CTX_A_AGENT, GLOBAL_MANIFEST.name);
    const resolveEvents = audit.ofKind('mcp.resolve');
    expect(resolveEvents[0]?.trace_id).toBe('trace-001');
  });

  it('omits trace_id when ctx has none', async () => {
    const ctxNoTrace: McpRequestContext = {
      tenant_id: tenantIdA,
      principal: 'agent',
      actor: 'agent:test',
    };
    await router.registerServer(GLOBAL_MANIFEST);
    await router.resolve(ctxNoTrace, GLOBAL_MANIFEST.name);
    expect(audit.snapshot()[0]?.trace_id).toBeUndefined();
  });
});

// ---------- type predicates --------------------------------------------

describe('type predicates', () => {
  it('isMcpError narrows the envelope', async () => {
    const r = await router.resolve(CTX_A_AGENT, asServerName('nope'));
    expect(isMcpError(r)).toBe(true);
  });

  it('isToolNotFound narrows', async () => {
    await router.registerServer(GLOBAL_MANIFEST);
    const r = await router.invoke(
      CTX_A_AGENT,
      GLOBAL_MANIFEST.name,
      asToolName('nope'),
      {},
    );
    expect(isToolNotFound(r)).toBe(true);
  });
});

// ---------- delay / sleeper -------------------------------------------

describe('delay', () => {
  it('awaits sleeper when delay_ms > 0', async () => {
    scripted = new ScriptedTransport([{ kind: 'ok', result: {} }]);
    let slept = 0;
    const sleeper = async (ms: number) => {
      slept = ms;
    };
    router = new InMemoryMcpRouter({ audit, transport: scripted, sleeper, delay_ms: 25 });
    await router.registerServer(GLOBAL_MANIFEST);
    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(slept).toBe(25);
  });

  it('skips sleep when delay_ms is 0', async () => {
    scripted = new ScriptedTransport([{ kind: 'ok', result: {} }]);
    let called = false;
    const sleeper = async () => {
      called = true;
    };
    router = new InMemoryMcpRouter({ audit, transport: scripted, sleeper, delay_ms: 0 });
    await router.registerServer(GLOBAL_MANIFEST);
    await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(called).toBe(false);
  });
});

// ---------- scripted transport -----------------------------------------

describe('ScriptedTransport', () => {
  it('throws when queue exhausted', async () => {
    scripted = new ScriptedTransport([]);
    router = new InMemoryMcpRouter({ audit, transport: scripted });
    await router.registerServer(GLOBAL_MANIFEST);
    const r = await router.invoke(CTX_A_AGENT, GLOBAL_MANIFEST.name, GLOBAL_TOOL, {});
    expect(isUpstreamError(r)).toBe(true);
  });

  it('consumed and remaining track consumption', async () => {
    const t = new ScriptedTransport([{ kind: 'ok', result: 1 }, { kind: 'ok', result: 2 }]);
    expect(t.remaining()).toBe(2);
    await t.invoke(GLOBAL_MANIFEST, GLOBAL_TOOL, {}, CTX_A_AGENT);
    expect(t.consumed()).toBe(1);
    expect(t.remaining()).toBe(1);
  });
});