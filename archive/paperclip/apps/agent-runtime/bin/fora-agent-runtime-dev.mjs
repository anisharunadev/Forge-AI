#!/usr/bin/env node
/**
 * FORA Agent Runtime — dev HTTP shim.
 *
 * The runtime is a library, not a service. `pnpm --filter
 * @fora/agent-runtime dev` wraps it in a tiny http server so
 * `scripts/smoke.sh` can curl /health on :4001 (FORA-371 AC).
 *
 * This binary is INTENTIONALLY NOT shipped in `package.json#files`.
 * It exists for local dev only — production runs the runtime in-
 * process inside the orchestrator. Anyone looking for the public
 * surface of `@fora/agent-runtime` should import from
 * `dist/index.js`, not this shim.
 *
 * Uses Node's built-in `http` so the agent-runtime package stays
 * zero-dep (the runtime itself is a pure library).
 *
 * Endpoints:
 *   GET  /health    200 {status: "ok", uptime_ms}
 *   GET  /          200 {name, version, pid}
 *   GET  /agents    200 {agents: []}   (intentional stub)
 */

import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const startedAt = performance.now();
const port = Number(process.env.FORA_RUNTIME_PORT ?? 4001);
const host = process.env.FORA_RUNTIME_HOST ?? '0.0.0.0';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'agent-runtime',
      version,
      uptime_ms: Math.round(performance.now() - startedAt),
    });
  }

  if (url.pathname === '/agents') {
    // The runtime is a library, so a `dev` shim can't enumerate
    // registered agents without a side channel. Return an empty
    // list — the smoke test only checks /health, not /agents.
    return sendJson(res, 200, { agents: [] });
  }

  if (url.pathname === '/' || url.pathname === '') {
    return sendJson(res, 200, {
      name: '@fora/agent-runtime',
      version,
      pid: process.pid,
      note: 'dev shim — production runs the runtime in-process inside the orchestrator',
    });
  }

  return sendJson(res, 404, { error: { code: 'NOT_FOUND', path: url.pathname } });
});

server.on('error', (err) => {
  console.error('[agent-runtime] dev shim failed:', err);
  process.exit(1);
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[agent-runtime] dev shim listening on http://${host}:${port} (v${version})`,
  );
});
