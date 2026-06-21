#!/usr/bin/env node
/**
 * @fora/mcp-transport — manual smoke
 *
 * Boots the stdio transport against the in-repo fake fixture
 * (`test/fixtures/fake-mcp-server.mjs`) and exercises the public surface:
 *
 *   1. invoke('echo', ...)  — happy path
 *   2. invoke('flaky', fail_n=0) — tool with idempotency-tagged args
 *   3. invokeStream('stream', ...) — notification chunks
 *   4. health(server) — pool probe
 *   5. LRU eviction — spawn 3 entries with poolMaxSize=2
 *
 * The retry policy + child_died path are covered exhaustively by
 * `src/__tests__/stdio_transport.test.ts`; this smoke is a quick
 * end-to-end verification that the binary boots and the SDK handshake
 * works against a real child process.
 *
 * Run: `pnpm --filter @fora/mcp-transport smoke` (after `pnpm build`).
 *
 * Exit codes: 0 = all checks passed, 1 = at least one failed.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  StdioChildProcessTransport,
  TransportError,
} from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '..', 'test', 'fixtures', 'fake-mcp-server.mjs');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function tenantId(s) { return s; }
function serverName(s) { return s; }
function toolName(s) { return s; }

const manifest = (name, tools) => ({
  name: serverName(name),
  bin: 'node',
  argv: [FIXTURE],
  tenantScope: 'global',
  tools: tools.map((t) => ({
    name: toolName(t),
    label: t,
    description: t,
    input_schema: { type: 'object', properties: {} },
    tags: t === 'stream' ? ['stream'] : t === 'flaky' ? ['mutation'] : [],
  })),
});

const ctx = {
  tenant_id: tenantId('smoke-tenant'),
  principal: 'agent',
  actor: 'agent:smoke',
};

async function main() {
  const transport = new StdioChildProcessTransport({
    spawnTimeoutMs: 5_000,
    invokeTimeoutMs: 5_000,
    poolMaxSize: 2,
  });

  try {
    // 1. happy path
    try {
      const r = await transport.invoke(
        manifest('jira', ['echo']),
        toolName('echo'),
        { text: 'smoke-ok' },
        ctx,
      );
      record('invoke(echo)', r === JSON.stringify({ text: 'smoke-ok' }), `result=${JSON.stringify(r)}`);
    } catch (e) {
      record('invoke(echo)', false, e.message);
    }

    // 2. flaky tool with fail_n=0 — always succeeds; verifies that an
    // idempotency-key-tagged mutation call round-trips through the
    // transport without errors. (Retry behavior under transport-level
    // failure is exercised in src/__tests__/stdio_transport.test.ts.)
    try {
      const r = await transport.invoke(
        manifest('jira', ['flaky']),
        toolName('flaky'),
        { fail_n: 0, result: 'converged', idempotency_key: 'smoke-1' },
        ctx,
      );
      record('invoke(flaky, idempotent)', r === 'converged', `result=${JSON.stringify(r)}`);
    } catch (e) {
      record('invoke(flaky, idempotent)', false, e instanceof Error ? e.message : String(e));
    }

    // 3. streaming tool
    try {
      const stream = await transport.invokeStream(
        manifest('jira', ['stream']),
        toolName('stream'),
        { prefix: 'smoke' },
        ctx,
      );
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const ok = chunks.length === 4 && chunks[3].payload?.__stream_end__ === true;
      record('invokeStream(stream)', ok, `chunks=${chunks.length}`);
    } catch (e) {
      record('invokeStream(stream)', false, e instanceof Error ? e.message : String(e));
    }

    // 4. health probe
    try {
      const h = await transport.health(manifest('jira', ['echo']));
      record('health()', h === 'healthy', `health=${h}`);
    } catch (e) {
      record('health()', false, e instanceof Error ? e.message : String(e));
    }

    // 5. LRU eviction — pool is now {jira::smoke-tenant}, force a new tenant
    //    to push the old entry out (pool max = 2, third tenant evicts first).
    try {
      const ctxB = { ...ctx, tenant_id: 'smoke-tenant-b' };
      const ctxC = { ...ctx, tenant_id: 'smoke-tenant-c' };
      await transport.invoke(manifest('jira', ['echo']), toolName('echo'), { text: 'a' }, ctxB);
      await transport.invoke(manifest('jira', ['echo']), toolName('echo'), { text: 'b' }, ctxC);
      const snap = transport.snapshot();
      const tenants = snap.entries.map((e) => e.key.tenantId).sort();
      record(
        'LRU eviction (pool max=2)',
        snap.size === 2 && !tenants.includes('smoke-tenant'),
        `tenants=${tenants.join(',')}`,
      );
    } catch (e) {
      record('LRU eviction (pool max=2)', false, e instanceof Error ? e.message : String(e));
    }
  } finally {
    await transport.close();
  }

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('smoke crashed:', e);
  process.exit(1);
});
// Reference TransportError so static analyzers see the import (used by other smokes).
void TransportError;
