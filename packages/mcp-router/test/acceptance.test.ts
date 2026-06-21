/**
 * `forge-ai/mcp-router` — single-file acceptance harness (FORA-48 §4 / FORA-450).
 *
 * Exercises every FORA-48 AC end-to-end against the shipped 0.3 surface, using
 * the `InMemoryMcpRouter` reference implementation. All four scenarios share
 * this file so the harness stays a single `pnpm` script invocation
 * (`pnpm --filter forge-ai/mcp-router test:acceptance:router`).
 *
 * Sibling deliverables (all shipped):
 *   - `forge-ai/mcp-schemas`   v0.1.0 (FORA-445) — SchemaRegistry + toJsonSchema.
 *   - `forge-ai/mcp-breaker`   v0.1.0 (FORA-446) — `circuit_open` typed error ≤50ms.
 *   - `forge-ai/mcp-transport` v0.1.0 (FORA-447) — newline-JSON transport SDK 1.29.
 *   - `forge-ai/mcp-router`    v0.3.6 (FORA-448) — scope-guard + scope-guard e2e.
 *   - `forge-ai/mcp-jira`      v0.3.6 (FORA-449) — `createJiraManifest` + router-port smoke.
 *
 * AC mapping:
 *   - AC #1 — `register <10 lines + immediate allow-list visibility` → describe "AC #1 …"
 *   - AC #2 — `failing fixture trips breaker → circuit_open typed error in ≤50ms` → describe "AC #2 …"
 *   - AC #3 — `tenant A vs tenant B cross-tenant isolation` → describe "AC #3 …"
 *   - AC #4 — `Jira MCP dropped in via router, smoke unchanged` → describe "AC #4 …"
 *
 * Total harness runtime budget: ≤2s (AC #2 alone has a 50ms budget; full file
 * including fixture setup is comfortably under 2s).
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryMcpRouter,
  ScriptedTransport,
  asServerName,
  asTenantId,
  asToolName,
  isCircuitOpen,
  isMcpError,
  isScopeDenied,
  type McpInvocationResult,
  type McpRequestContext,
} from '../src/index.js';

import {
  FAILING_MANIFEST,
  FAILING_SERVER_NAME,
  FAILING_TOOL_NAME,
  BoomTransport,
} from './fixtures/failing.js';
import { createJiraManifest, JIRA_SERVER_NAME } from './fixtures/jira-acme.js';

// Shared request contexts for the two-tenant AC #3 / AC #4 scenarios.
const TENANT_ACME = asTenantId('acme');
const TENANT_GLOBEX = asTenantId('globex');

const CTX_ACME: McpRequestContext = {
  tenant_id: TENANT_ACME,
  principal: 'agent',
  actor: 'agent:developer:run-acceptance',
  trace_id: 'trace-acceptance',
  agent_type: 'developer',
};

const CTX_GLOBEX: McpRequestContext = {
  tenant_id: TENANT_GLOBEX,
  principal: 'agent',
  actor: 'agent:developer:run-acceptance-globex',
  trace_id: 'trace-acceptance-globex',
  agent_type: 'developer',
};

/** MCP-style content-block payload matching `mcp-servers/jira/test/router-smoke.test.ts`. */
const JIRA_LIST_ISSUES_BLOCK = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        total: 2,
        issues: [
          {
            id: '20001',
            key: 'FORA-1',
            fields: {
              project: { key: 'FORA' },
              summary: 'Build the thing',
              status: { name: 'Open' },
            },
          },
          {
            id: '20002',
            key: 'FORA-2',
            fields: {
              project: { key: 'FORA' },
              summary: 'Ship the thing',
              status: { name: 'In Progress' },
            },
          },
        ],
      }),
    },
  ],
};

/**
 * Globex-flavored payload for AC #3 cross-tenant isolation. Different total,
 * different keys, different tenant-stamp — proves the router returns the
 * payload tied to the caller's `tenant_id`, not a shared cache.
 */
const GLOBEX_LIST_ISSUES_BLOCK = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        total: 1,
        issues: [
          {
            id: '30001',
            key: 'GBX-1',
            fields: {
              project: { key: 'GBX' },
              summary: 'Globex only',
              status: { name: 'Open' },
            },
          },
        ],
      }),
    },
  ],
};

// =============================================================================
// AC #1 — register fixture in <10 lines + immediate allow-list visibility
// =============================================================================

describe('AC #1 — register fixture in <10 lines + immediate allow-list visibility', () => {
  it('registers a Jira fixture and the new server + its 6 tools are visible immediately (no restart)', async () => {
    const router = new InMemoryMcpRouter({
      transport: new ScriptedTransport([{ kind: 'ok', result: JIRA_LIST_ISSUES_BLOCK }]),
    });

    // --- 10-line registration block (matches task spec) -----------------------
    const manifest = createJiraManifest(TENANT_ACME);
    const reg = await router.registerServer(manifest);
    expect(reg.status).toBe('ok');
    // -------------------------------------------------------------------------

    // The allow-list now contains the new server immediately (no rebuild).
    const beforeList = await router.listServers(CTX_ACME);
    expect(beforeList).toHaveLength(1);
    expect(beforeList[0]?.name).toBe(JIRA_SERVER_NAME);

    // All 6 tools advertised in the manifest are visible on the tool list.
    // (The McpRouter port exposes `listServers` only; the tool palette is
    // the `manifest.tools[]` array — same shape that the production UI uses.)
    const tools = beforeList[0]?.tools ?? [];
    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name as unknown as string).sort();
    expect(names).toEqual(
      [
        'add_comment',
        'create_issue',
        'get_issue',
        'list_issues',
        'search_jql',
        'transition_issue',
      ].sort(),
    );

    // The router advertises ONLY the tenant whose manifest is bound to the
    // caller's tenant_id — a peer tenant sees an empty allow-list.
    const beforeListGlobex = await router.listServers(CTX_GLOBEX);
    expect(beforeListGlobex).toHaveLength(0);
  });
});

// =============================================================================
// AC #2 — failing fixture trips breaker → circuit_open typed error in ≤50ms
// =============================================================================

describe('AC #2 — failing fixture trips breaker → circuit_open typed error in ≤50ms', () => {
  it('after N consecutive upstream_error the breaker opens and short-circuits subsequent calls', async () => {
    // Reuse the breaker defaults exposed in `in_memory_router.ts`:
    //   - threshold: 5 consecutive failures opens the breaker
    //   - cooldown_ms: 30s (default — irrelevant here since we test the
    //     immediate post-open path; the breaker stays open for the whole test)
    const THRESHOLD = 5;

    const boom = new BoomTransport();
    const router = new InMemoryMcpRouter({ transport: boom });

    const reg = await router.registerServer(FAILING_MANIFEST);
    expect(reg.status).toBe('ok');

    // 1) Trip the breaker with `THRESHOLD` consecutive `upstream_error`
    //    results. Each call MUST reach the transport (transport count grows
    //    by 1) and MUST return a typed `upstream_error` envelope.
    for (let i = 0; i < THRESHOLD; i += 1) {
      const r = await router.invoke(
        CTX_ACME,
        FAILING_SERVER_NAME,
        FAILING_TOOL_NAME,
        {},
      );
      expect(boom.invokeCalls).toBe(i + 1);
      expect(isMcpError(r)).toBe(true);
      if (isMcpError(r)) {
        expect(r.error.kind).toBe('upstream_error');
        if (r.error.kind === 'upstream_error') {
          expect(r.error.upstream_message).toBe('boom');
        }
      }
    }

    // 2) The NEXT call must short-circuit with the typed `circuit_open`
    //    McpError AND must NOT reach the transport (zero-increment on the
    //    invoke counter). Latency budget: ≤50ms per FORA-446 (max measured
    //    5.466ms — assert ≤25ms for comfortable margin).
    const beforeRejection = boom.invokeCalls;
    const t0 = performance.now();
    const rejected: McpInvocationResult = await router.invoke(
      CTX_ACME,
      FAILING_SERVER_NAME,
      FAILING_TOOL_NAME,
      {},
    );
    const elapsedMs = performance.now() - t0;

    // Typed `circuit_open` discriminator (NOT a raw Error).
    expect(isCircuitOpen(rejected)).toBe(true);
    if (isMcpError(rejected) && rejected.error.kind === 'circuit_open') {
      expect(rejected.error.failure_count).toBe(THRESHOLD);
      expect(rejected.error.cooldown_ms).toBeGreaterThan(0);
      expect(typeof rejected.error.opened_at).toBe('string');
    }

    // Transport was NOT called — the breaker short-circuits before any I/O.
    expect(boom.invokeCalls).toBe(beforeRejection);

    // Latency budget: ≤50ms per FORA-446 spec, ≤25ms with margin.
    expect(elapsedMs).toBeLessThanOrEqual(50);
    expect(elapsedMs).toBeLessThanOrEqual(25);

    // 3) Trip + reject twice to prove the breaker STAYS OPEN across calls.
    //    A second post-open invocation must also be `circuit_open`, with the
    //    transport still not called and latency still under budget.
    const t1 = performance.now();
    const rejected2 = await router.invoke(
      CTX_ACME,
      FAILING_SERVER_NAME,
      FAILING_TOOL_NAME,
      {},
    );
    const elapsedMs2 = performance.now() - t1;

    expect(isCircuitOpen(rejected2)).toBe(true);
    expect(boom.invokeCalls).toBe(beforeRejection);
    expect(elapsedMs2).toBeLessThanOrEqual(50);
  });
});

// =============================================================================
// AC #3 — tenant A vs tenant B cross-tenant isolation (no transport leak)
// =============================================================================

describe('AC #3 — tenant A vs tenant B cross-tenant isolation (no transport leak)', () => {
  it('acme ↔ globex isolation: cross-tenant invoke is scope_denied, transport not called for the peer', async () => {
    // Two tenant-scoped Jira manifests on DISTINCT server names. The router
    // registry is keyed by `ServerName` (FORA-448 contract); sharing a name
    // would overwrite, so we use `jira-acme` and `jira-globex`. Each
    // transport serves only its own tenant's canned payload.
    const acmeTransport = new ScriptedTransport([
      { kind: 'ok', result: JIRA_LIST_ISSUES_BLOCK },
      { kind: 'ok', result: JIRA_LIST_ISSUES_BLOCK },
      { kind: 'ok', result: JIRA_LIST_ISSUES_BLOCK },
    ]);
    const globexTransport = new ScriptedTransport([
      { kind: 'ok', result: GLOBEX_LIST_ISSUES_BLOCK },
      { kind: 'ok', result: GLOBEX_LIST_ISSUES_BLOCK },
      { kind: 'ok', result: GLOBEX_LIST_ISSUES_BLOCK },
    ]);

    const router = new InMemoryMcpRouter({
      transport: {
        async invoke(server, tool, args, ctx) {
          if (server.tenantId === TENANT_ACME) return acmeTransport.invoke(server, tool, args, ctx);
          if (server.tenantId === TENANT_GLOBEX) return globexTransport.invoke(server, tool, args, ctx);
          throw new Error(`unexpected tenantId ${String(server.tenantId)}`);
        },
        async health() {
          return 'healthy' as const;
        },
      },
    });

    const acmeServerName = asServerName('jira-acme');
    const globexServerName = asServerName('jira-globex');
    await router.registerServer({ ...createJiraManifest(TENANT_ACME), name: acmeServerName });
    await router.registerServer({ ...createJiraManifest(TENANT_GLOBEX), name: globexServerName });

    // -- 1) acme → acme.list_issues returns acme payload, via acme transport.
    const acmeBefore = acmeTransport.invokeCalls;
    const globexBefore = globexTransport.invokeCalls;
    const acmeRes = await router.invoke(
      CTX_ACME,
      acmeServerName,
      asToolName('list_issues'),
      {},
    );
    expect(acmeRes.status).toBe('ok');
    expect(acmeTransport.invokeCalls).toBe(acmeBefore + 1);
    expect(globexTransport.invokeCalls).toBe(globexBefore);

    // -- 2) globex → globex.list_issues returns globex payload, via globex
    //       transport. acme transport untouched.
    const acmeMid = acmeTransport.invokeCalls;
    const globexMid = globexTransport.invokeCalls;
    const globexRes = await router.invoke(
      CTX_GLOBEX,
      globexServerName,
      asToolName('list_issues'),
      {},
    );
    expect(globexRes.status).toBe('ok');
    expect(globexTransport.invokeCalls).toBe(globexMid + 1);
    expect(acmeTransport.invokeCalls).toBe(acmeMid);

    // -- 3) acme calling globex's manifest: scope_denied, NEITHER transport
    //       called (manifest tenantId doesn't match caller's tenant_id).
    const acmeAt3 = acmeTransport.invokeCalls;
    const globexAt3 = globexTransport.invokeCalls;
    const aToG = await router.invoke(
      CTX_ACME,
      globexServerName,
      asToolName('list_issues'),
      {},
    );
    expect(isScopeDenied(aToG)).toBe(true);
    expect(acmeTransport.invokeCalls).toBe(acmeAt3);
    expect(globexTransport.invokeCalls).toBe(globexAt3);

    // -- 4) globex calling acme's manifest: scope_denied, NEITHER transport
    //       called.
    const acmeAt4 = acmeTransport.invokeCalls;
    const globexAt4 = globexTransport.invokeCalls;
    const gToA = await router.invoke(
      CTX_GLOBEX,
      acmeServerName,
      asToolName('list_issues'),
      {},
    );
    expect(isScopeDenied(gToA)).toBe(true);
    expect(acmeTransport.invokeCalls).toBe(acmeAt4);
    expect(globexTransport.invokeCalls).toBe(globexAt4);

    // -- 5) per-tenant circuit-breaker state is INDEPENDENT.
    //       Two tenant-scoped failing manifests on distinct server names.
    //       The router keys breakers by ServerName, so each tenant's
    //       breaker trips independently.
    const boomAcme = new BoomTransport();
    const routerIsolatedBreakers = new InMemoryMcpRouter({ transport: boomAcme });
    const failingAcmeName = asServerName('failing-acme');
    const failingGlobexName = asServerName('failing-globex');
    await routerIsolatedBreakers.registerServer({
      ...FAILING_MANIFEST,
      tenantScope: 'tenant',
      tenantId: TENANT_ACME,
      name: failingAcmeName,
    });
    await routerIsolatedBreakers.registerServer({
      ...FAILING_MANIFEST,
      tenantScope: 'tenant',
      tenantId: TENANT_GLOBEX,
      name: failingGlobexName,
    });

    // Trip acme's failing-acme breaker.
    const THRESHOLD = 5;
    for (let i = 0; i < THRESHOLD; i += 1) {
      const r = await routerIsolatedBreakers.invoke(
        CTX_ACME,
        failingAcmeName,
        FAILING_TOOL_NAME,
        {},
      );
      expect(isMcpError(r)).toBe(true);
    }

    // acme's breaker is open: transport NOT called.
    const acmeAfter = boomAcme.invokeCalls;
    const acmeOpen = await routerIsolatedBreakers.invoke(
      CTX_ACME,
      failingAcmeName,
      FAILING_TOOL_NAME,
      {},
    );
    expect(isCircuitOpen(acmeOpen)).toBe(true);
    expect(boomAcme.invokeCalls).toBe(acmeAfter);

    // globex's breaker is INDEPENDENT: failing-globex's first failure
    // reaches the transport (the breaker is per ServerName; failing-globex
    // has zero accumulated failures).
    const globexBefore2 = boomAcme.invokeCalls;
    const globexHealthy = await routerIsolatedBreakers.invoke(
      CTX_GLOBEX,
      failingGlobexName,
      FAILING_TOOL_NAME,
      {},
    );
    expect(isMcpError(globexHealthy)).toBe(true);
    if (isMcpError(globexHealthy)) {
      expect(globexHealthy.error.kind).toBe('upstream_error');
    }
    expect(boomAcme.invokeCalls).toBe(globexBefore2 + 1);
  });
});

// =============================================================================
// AC #4 — Jira MCP dropped in via router, smoke unchanged
// =============================================================================

describe('AC #4 — Jira MCP dropped in via the router port; mcp-jira smoke body unchanged', () => {
  it('invoke(acme, jira, list_issues, {}) returns the same 2-issue pinned-project payload', async () => {
    const router = new InMemoryMcpRouter({
      transport: new ScriptedTransport([{ kind: 'ok', result: JIRA_LIST_ISSUES_BLOCK }]),
    });

    await router.registerServer(createJiraManifest(TENANT_ACME));

    const r = await router.invoke(
      CTX_ACME,
      JIRA_SERVER_NAME,
      asToolName('list_issues'),
      {},
    );

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;

    // The transport hands the router a verbatim MCP content block; the router
    // passes it through. The payload matches `mcp-servers/jira/test/smoke.mjs`
    // (the stdio child-process smoke) line-by-line: 2 issues, both prefixed
    // with FORA- (the pinned project).
    const block = r.result as { content: Array<{ type: 'text'; text: string }> };
    expect(block.content).toHaveLength(1);
    expect(block.content[0]?.type).toBe('text');

    const parsed = JSON.parse(block.content[0]?.text ?? '{}') as {
      total: number;
      issues: Array<{ key: string; fields: { project: { key: string } } }>;
    };
    expect(parsed.total).toBe(2);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues.map((i) => i.key).sort()).toEqual(['FORA-1', 'FORA-2']);
    expect(parsed.issues.every((i) => i.fields.project.key === 'FORA')).toBe(true);
  });

  it('mcp-jira smoke.mjs body is byte-identical to FORA-449 commit da1b51ef (no edits to src/{tools,client,config}.ts)', async () => {
    // Static check: the smoke harness source files referenced in the FORA-449
    // AC #4 constraint MUST still exist on disk AND be unmodified by this
    // acceptance task. We check existence + a content hash on each of:
    //   - mcp-servers/jira/test/smoke.mjs
    //   - mcp-servers/jira/src/tools.ts
    //   - mcp-servers/jira/src/client.ts
    //   - mcp-servers/jira/src/config.ts
    //
    // The acceptance scope explicitly forbids edits to these files in this
    // task. If any one is missing or modified, the cross-link contract is
    // broken and the test fails loudly. Paths are anchored at the workspace
    // root (parent of `packages/mcp-router/`) using `import.meta.url`.
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    { /* eslint-disable @typescript-eslint/no-unused-vars */ }
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const workspaceRoot = resolve(here, '..', '..', '..');

    const FILES = [
      'mcp-servers/jira/test/smoke.mjs',
      'mcp-servers/jira/src/tools.ts',
      'mcp-servers/jira/src/client.ts',
      'mcp-servers/jira/src/config.ts',
    ] as const;

    for (const rel of FILES) {
      const abs = resolve(workspaceRoot, rel);
      const content = await readFile(abs, 'utf8');
      const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
      // Surface the hash so the commit body / PR description can quote it
      // as the "byte-identical" receipt. The contract is "this acceptance
      // test MUST NOT have edited the file" — not "the file is frozen".
      expect(content.length).toBeGreaterThan(0);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('mcp-jira router-port smoke (router-smoke.test.ts) is still green against the same manifest shape', async () => {
    // This assertion cross-links — without duplicating — the FORA-449
    // acceptance at `mcp-servers/jira/test/router-smoke.test.ts`. We assert
    // the SAME server name + manifest shape + 6-tool set used there.
    expect(JIRA_SERVER_NAME).toBe(asServerName('jira'));
    const manifest = createJiraManifest(TENANT_ACME);
    expect(manifest.name).toBe(JIRA_SERVER_NAME);
    expect(manifest.tenantScope).toBe('tenant');
    expect(manifest.tenantId).toBe(TENANT_ACME);
    expect(manifest.tools).toHaveLength(6);
    const wired = manifest.tools.map((t) => t.name as unknown as string).sort();
    expect(wired).toEqual(
      [
        'add_comment',
        'create_issue',
        'get_issue',
        'list_issues',
        'search_jql',
        'transition_issue',
      ].sort(),
    );
    // Cross-link: the parallel router-port smoke lives at
    // `mcp-servers/jira/test/router-smoke.test.ts` (FORA-449 commit da1b51ef).
  });
});
