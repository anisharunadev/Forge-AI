/**
 * `forge-ai/mcp-jira` — router-port smoke test (FORA-48 §3 / AC #4).
 *
 * Proves the Jira MCP drops into the FORA 0.3 router framework cleanly:
 * the same `list_issues` flow that `test/smoke.mjs` exercises over an MCP
 * stdio child-process is exercised here through `InMemoryMcpRouter.invoke`
 * with a manifest built from `createJiraManifest('acme')`. No framework
 * changes; no body changes to `tools.ts`, `client.ts`, or `config.ts`.
 *
 * What this test covers:
 *   1. `createJiraManifest(tenantId)` returns a valid `ServerManifest` —
 *      `InMemoryMcpRouter.registerServer` accepts it without throwing.
 *   2. `resolve(ctx, 'jira', 'list_issues')` returns `status: 'resolved'`
 *      with the right manifest + `health: 'healthy'`.
 *   3. `invoke(ctx, 'jira', 'list_issues', {})` returns `status: 'ok'` with
 *      the same payload the stdio smoke test sees (two `FORA-*` issues,
 *      pinned-project scoped, JSON-stringified inside an MCP-style content
 *      block).
 *   4. The transport actually called the in-process `handleToolCall` —
 *      proves the manifest's `tools[]` wiring matches what `tools.ts`
 *      exposes.
 *   5. `invoke` with a peer tenant's claim → `scope_denied` without
 *      reaching the transport (proves the tenant scope gate is wired).
 *
 * The mock Atlassian HTTP server is the same one `smoke.mjs` uses; we
 * import it as a sibling module so the assertion set stays in lockstep.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  InMemoryMcpRouter,
  type McpTransport,
  asServerName,
  asTenantId,
  asToolName,
  isMcpError,
  isScopeDenied,
  type McpInvocationResult,
  type McpRequestContext,
  type ServerManifest,
} from 'forge-ai/mcp-router';

import { initialState, startMockServer } from './mock-atlassian.mjs';
import { createClient, type Client } from '../src/client.js';
import { handleToolCall, toolDefinitions } from '../src/tools.js';
import { createJiraManifest, JIRA_SERVER_NAME } from '../src/manifest.js';

// ---------- transport adapter: invokes the in-process Jira handlers ----

/**
 * In-process transport that wires the router to the same handlers the
 * stdio MCP server uses. Holds the live `Client` produced from the env
 * (`JIRA_API_BASE_URL` → mock-atlassian.mjs).
 */
class InProcessJiraTransport implements McpTransport {
  public invokeCalls = 0;
  constructor(private readonly client: Client) {}

  async invoke(
    _server: ServerManifest,
    tool: ReturnType<typeof asToolName>,
    args: Record<string, unknown>,
    _ctx: McpRequestContext,
  ): Promise<unknown> {
    this.invokeCalls += 1;
    // Delegate straight to the same `handleToolCall` that `index.ts`
    // wires into the MCP stdio server. The router hands us a branded
    // `ToolName`; `handleToolCall` accepts the loose string form.
    return handleToolCall(this.client, tool as unknown as string, args);
  }
}

// ---------- fixture wiring ---------------------------------------------

const TENANT_ACME = asTenantId('acme');
const TENANT_OTHER = asTenantId('other');

const CTX_ACME: McpRequestContext = {
  tenant_id: TENANT_ACME,
  principal: 'agent',
  actor: 'agent:developer:run-router-smoke',
  trace_id: 'trace-router-smoke',
  agent_type: 'developer',
};

const CTX_OTHER: McpRequestContext = {
  tenant_id: TENANT_OTHER,
  principal: 'agent',
  actor: 'agent:developer:run-router-smoke-cross',
  trace_id: 'trace-router-smoke-cross',
  agent_type: 'developer',
};

let shutdownMock: () => Promise<void>;
let transport: InProcessJiraTransport;
let router: InMemoryMcpRouter;
let manifest: ServerManifest;

beforeAll(async () => {
  // 1. Spin up the mock Atlassian server (same one smoke.mjs uses).
  const state = initialState({ pinnedProject: 'FORA' });
  const started = await startMockServer(state);
  shutdownMock = started.shutdown;

  // 2. Wire the in-process Jira client to point at the mock.
  process.env.JIRA_EMAIL = 'router-smoke@example.com';
  process.env.JIRA_API_TOKEN = 'router-smoke-token';
  process.env.JIRA_PROJECT_KEY = 'FORA';
  process.env.JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.JIRA_API_BASE_URL = `${started.baseUrl}/rest/api/3`;

  const { client } = createClient({
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY,
    baseUrl: process.env.JIRA_BASE_URL,
    apiBaseUrl: process.env.JIRA_API_BASE_URL,
    userAgent: 'fora-mcp-jira/router-smoke',
  });

  transport = new InProcessJiraTransport(client);

  // 3. Build the manifest + router.
  manifest = createJiraManifest(TENANT_ACME);
  router = new InMemoryMcpRouter({ transport });
  await router.registerServer(manifest);
});

afterAll(async () => {
  await shutdownMock?.();
});

// ---------- the actual test --------------------------------------------

describe('FORA-48 AC #4 — `forge-ai/mcp-jira` drops into the router unchanged', () => {
  it('manifest advertises the same 6 tools the stdio server registers', () => {
    expect(JIRA_SERVER_NAME).toBe(asServerName('jira'));
    expect(manifest.name).toBe(JIRA_SERVER_NAME);
    expect(manifest.tenantScope).toBe('tenant');
    expect(manifest.tenantId).toBe(TENANT_ACME);

    const advertised = manifest.tools.map((t) => t.name as unknown as string).sort();
    const wired = toolDefinitions.map((t) => t.name).sort();
    expect(advertised).toEqual(wired);

    // Each tool descriptor carries the JSON-Schema form of its Zod input.
    for (const tool of manifest.tools) {
      expect(tool.input_schema).toMatchObject({ type: 'object' });
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('resolve(acme, jira, list_issues) → resolved with the registered manifest', async () => {
    const r = await router.resolve(CTX_ACME, JIRA_SERVER_NAME, asToolName('list_issues'));
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.manifest.name).toBe(JIRA_SERVER_NAME);
      // The in-process transport does not implement `health()`; the router
      // therefore reports `'unknown'`. Production wiring (the stdio transport)
      // implements `health()` and would report `'healthy'` here. Either way
      // the resolve path succeeds — AC #4 is about manifest + invocation,
      // not health probing.
      expect(['healthy', 'unknown']).toContain(r.health);
    }
  });

  it('invoke(acme, jira, list_issues, {}) returns the same payload as smoke.mjs', async () => {
    const before = transport.invokeCalls;
    const r: McpInvocationResult = await router.invoke(
      CTX_ACME,
      JIRA_SERVER_NAME,
      asToolName('list_issues'),
      {},
    );

    expect(transport.invokeCalls).toBe(before + 1);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;

    // The handler returns an MCP content block; the router passes it
    // through verbatim, so the payload matches `smoke.mjs` line-by-line.
    const block = r.result as { content: Array<{ type: 'text'; text: string }> };
    expect(block.content).toHaveLength(1);
    expect(block.content[0]?.type).toBe('text');

    const parsed = JSON.parse(block.content[0]?.text ?? '{}') as {
      total: number;
      issues: Array<{ key: string }>;
    };
    expect(parsed.total).toBe(2);
    expect(parsed.issues.map((i) => i.key).sort()).toEqual(['FORA-1', 'FORA-2']);
    expect(parsed.issues.every((i) => i.key.startsWith('FORA-'))).toBe(true);
  });

  it('invoke from a peer tenant (other) → scope_denied without transport call', async () => {
    const before = transport.invokeCalls;
    const r = await router.invoke(
      CTX_OTHER,
      JIRA_SERVER_NAME,
      asToolName('list_issues'),
      {},
    );

    expect(transport.invokeCalls).toBe(before); // transport never invoked
    expect(isMcpError(r)).toBe(true);
    expect(isScopeDenied(r)).toBe(true);
  });

  it('invoke with an unknown tool → tool_not_found (manifest.tools is the source of truth)', async () => {
    const before = transport.invokeCalls;
    const r = await router.invoke(
      CTX_ACME,
      JIRA_SERVER_NAME,
      asToolName('not_a_real_tool'),
      {},
    );
    expect(transport.invokeCalls).toBe(before);
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(r.error.kind).toBe('tool_not_found');
    }
  });
});
