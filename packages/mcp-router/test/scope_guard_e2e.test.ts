/**
 * forge-ai/mcp-router — end-to-end scope-guard integration test
 * (FORA-48 §3.5 / FORA-448).
 *
 * This is the canonical proof of AC #3. The router is wired with HTTP
 * adapters (the same shape as the real `HttpTenantValidator` and
 * `HttpCredentialResolver` in `forge-ai/identity-broker` and
 * `forge-ai/customer-cloud-broker`), pointed at a live `node:http` server
 * that implements the two broker routes.
 *
 * Acceptance: tenant A's session attempting tenant B's MCP returns
 * `scope_denied` (or a scope-guard subclass) and never spawns tenant
 * B's process. We assert "never spawns" via the transport's
 * `invokeCalls` counter — the production transport is the only thing
 * that would ever spawn the upstream MCP process, so a zero-increment
 * is a faithful "no process spawned" proxy in the in-memory reference
 * implementation.
 *
 * We deliberately use `node:http` (not fastify) so the router package
 * stays free of broker-framework dependencies. The two routes mirror
 * the broker contract (`GET /auth/tenants/:id/validate`,
 * `POST /credentials/resolve`) so the adapters never know they're
 * hitting a stub.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import {
  InMemoryAuditSink,
  InMemoryMcpRouter,
  ScriptedTransport,
  asServerName,
  asTenantId,
  asToolName,
  isMcpError,
  isTenantInvalid,
  isValidatorUnreachable,
  type McpRequestContext,
  type ServerManifest,
} from '../src/index.js';

// ---------- HTTP adapter shape (mirrors the broker adapter classes) -----

interface ValidatorOk { readonly ok: true }
interface ValidatorDenial { readonly ok: false; readonly reason: string }
type ValidatorResult = ValidatorOk | ValidatorDenial;
interface TenantValidator {
  validate(tenant_id: string): Promise<ValidatorResult>;
}
interface CredentialOk { readonly ok: true; readonly credential: unknown }
interface CredentialDenial { readonly ok: false; readonly reason: string }
type CredentialResult = CredentialOk | CredentialDenial;
interface CredentialResolver {
  resolve(tenant_id: string, server_name: string): Promise<CredentialResult>;
}

class HttpTenantValidator implements TenantValidator {
  constructor(private readonly baseUrl: string) {}
  async validate(tenant_id: string): Promise<ValidatorResult> {
    const res = await fetch(
      `${this.baseUrl}/auth/tenants/${encodeURIComponent(tenant_id)}/validate`,
    );
    if (res.status === 200) {
      const body = (await res.json()) as { valid?: boolean };
      if (body.valid === true) return { ok: true };
      return { ok: false, reason: 'invalid' };
    }
    if (res.status === 404) {
      const body = (await res.json()) as { reason?: string };
      return { ok: false, reason: body.reason ?? 'unknown_tenant' };
    }
    throw new Error(`validator -> ${res.status}`);
  }
}

class HttpCredentialResolver implements CredentialResolver {
  constructor(private readonly baseUrl: string) {}
  async resolve(tenant_id: string, server_name: string): Promise<CredentialResult> {
    const res = await fetch(`${this.baseUrl}/credentials/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id, server_name }),
    });
    if (res.status >= 200 && res.status < 300) {
      const body = (await res.json()) as { ok?: boolean; credential?: unknown; reason?: string };
      if (body.ok === true) return { ok: true, credential: body.credential };
      return { ok: false, reason: body.reason ?? 'unknown' };
    }
    throw new Error(`resolver -> ${res.status}`);
  }
}

// ---------- broker stubs (node:http, matching the real routes) ----------

const KNOWN_TENANTS = new Set(['tnt_A']);
const TENANTS_WITH_TRUST = new Set(['tnt_A']);

let baseUrl: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    // GET /auth/tenants/:id/validate
    const validateMatch = url.match(/^\/auth\/tenants\/([^/]+)\/validate$/);
    if (req.method === 'GET' && validateMatch) {
      const id = decodeURIComponent(validateMatch[1]!);
      if (!KNOWN_TENANTS.has(id)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ valid: false, reason: 'unknown_tenant', tenant_id: id }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ valid: true, tenant_id: id }));
      return;
    }
    // POST /credentials/resolve
    if (req.method === 'POST' && url === '/credentials/resolve') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            tenant_id?: string;
            server_name?: string;
          };
          if (!body.tenant_id || !body.server_name) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, reason: 'malformed_request' }));
            return;
          }
          if (!TENANTS_WITH_TRUST.has(body.tenant_id)) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                ok: false,
                reason: 'cloud_disabled',
                tenant_id: body.tenant_id,
                server_name: body.server_name,
              }),
            );
            return;
          }
          const issued_at_ms = Date.now();
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              tenant_id: body.tenant_id,
              server_name: body.server_name,
              credential: {
                kind: 'stub',
                server_name: body.server_name,
                tenant_id: body.tenant_id,
                issued_at_ms,
                expires_at_ms: issued_at_ms + 5 * 60 * 1000,
                role_fingerprint: 'role::test',
              },
            }),
          );
        } catch {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, reason: 'malformed_json' }));
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

// ---------- fixtures ----------------------------------------------------

const tenantA = asTenantId('tnt_A');
const tenantB = asTenantId('tnt_B');

const JIRA_B_TOOL = asToolName('create_issue');
const JIRA_B_MANIFEST: ServerManifest = {
  name: asServerName('jira'),
  bin: 'node',
  argv: ['jira.js'],
  tenantScope: 'tenant',
  tenantId: tenantB,
  tools: [
    {
      name: JIRA_B_TOOL,
      label: 'Create Issue',
      description: 'Tenant-B-owned Jira MCP',
      input_schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
    },
  ],
};

const CTX_A: McpRequestContext = {
  tenant_id: tenantA,
  principal: 'agent',
  actor: 'agent:developer:run-001',
  trace_id: 'trace-AC3',
  agent_type: 'developer',
};

// ---------- AC #3 -------------------------------------------------------

describe('AC #3 — cross-tenant request returns scope_denied without process spawn', () => {
  it('tenant A attempting tenant B MCP via invoke: never reaches transport, scope-guard error', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([{ kind: 'ok', result: { should: 'never see this' } }]);
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: new HttpTenantValidator(baseUrl),
      credential_resolver: new HttpCredentialResolver(baseUrl),
    });
    await router.registerServer(JIRA_B_MANIFEST);

    const before = scripted.invokeCalls;
    const r = await router.invoke(CTX_A, JIRA_B_MANIFEST.name, JIRA_B_TOOL, { title: 'pwn' });

    // Transport MUST NOT have been called — proves no upstream MCP
    // process was spawned (the transport is the seam that spawns the
    // upstream process in the production transport implementation).
    expect(scripted.invokeCalls).toBe(before);

    // Outcome MUST be a scope-guard error. Tenant A is known to the
    // validator, so the validator approves tenant A. The router then
    // hits the manifest's tenant-scope gate (tenant B's manifest with
    // tenant A's claim) and returns `scope_denied` — the second of the
    // two guard stages. Either stage is a valid scope-guard rejection.
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      // The validator approves tenant A → reach the manifest gate →
      // `scope_denied` because the manifest is owned by tenant B.
      expect(r.error.kind).toBe('scope_denied');
    }

    // No scope_guard events (the rejection was at the manifest gate,
    // not the validator/resolver stage). An `mcp.invoke` event was
    // emitted with outcome=scope_denied.
    expect(audit.ofKind('mcp.scope_guard')).toHaveLength(0);
    const invoke = audit.ofKind('mcp.invoke');
    expect(invoke).toHaveLength(1);
    expect(invoke[0]?.outcome).toBe('scope_denied');
  });

  it('tenant A attempting tenant B MCP via resolve: never reaches transport, scope-guard error', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([]);
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: new HttpTenantValidator(baseUrl),
    });
    await router.registerServer(JIRA_B_MANIFEST);

    const before = scripted.invokeCalls;
    const r = await router.resolve(CTX_A, JIRA_B_MANIFEST.name, JIRA_B_TOOL);

    expect(scripted.invokeCalls).toBe(before);
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(r.error.kind).toBe('scope_denied');
    }
  });

  it('unknown tenant at the validator → fail closed (tenant_invalid, no transport call)', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([{ kind: 'ok', result: {} }]);
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: new HttpTenantValidator(baseUrl),
    });
    // Use a global manifest so the scope gate doesn't reject tenant
    // A; the only gate is the validator.
    const globalManifest: ServerManifest = {
      ...JIRA_B_MANIFEST,
      tenantScope: 'global',
      tenantId: undefined,
    };
    await router.registerServer(globalManifest);

    const unknownCtx: McpRequestContext = {
      ...CTX_A,
      tenant_id: asTenantId('tnt_FOREIGN'),
    };
    const before = scripted.invokeCalls;
    const r = await router.invoke(unknownCtx, globalManifest.name, JIRA_B_TOOL, { title: 'x' });

    expect(scripted.invokeCalls).toBe(before);
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isTenantInvalid(r)).toBe(true);
      expect(r.error.kind).toBe('tenant_invalid');
    }
    const guard = audit.ofKind('mcp.scope_guard');
    expect(guard).toHaveLength(1);
    expect(guard[0]?.outcome).toBe('tenant_invalid');
  });

  it('identity-broker unreachable → fail closed (validator_unreachable, no transport call)', async () => {
    const audit = new InMemoryAuditSink();
    const scripted = new ScriptedTransport([{ kind: 'ok', result: {} }]);
    // Point at a port nothing is listening on — connect refused.
    const router = new InMemoryMcpRouter({
      audit,
      transport: scripted,
      tenant_validator: new HttpTenantValidator('http://127.0.0.1:1'),
    });
    const globalManifest: ServerManifest = {
      ...JIRA_B_MANIFEST,
      tenantScope: 'global',
      tenantId: undefined,
    };
    await router.registerServer(globalManifest);

    const before = scripted.invokeCalls;
    const r = await router.invoke(CTX_A, globalManifest.name, JIRA_B_TOOL, { title: 'x' });

    expect(scripted.invokeCalls).toBe(before);
    expect(isMcpError(r)).toBe(true);
    if (isMcpError(r)) {
      expect(isValidatorUnreachable(r)).toBe(true);
    }
  });
});
