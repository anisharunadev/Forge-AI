#!/usr/bin/env node
/**
 * @fora/mcp-transport — fake MCP stdio server for tests + smoke.
 *
 * Implements the bare minimum MCP JSON-RPC surface needed to exercise
 * `StdioChildProcessTransport`:
 *   - `initialize` handshake
 *   - `tools/list`
 *   - `tools/call`
 *   - `notifications/message` (for streaming tools)
 *
 * Tools:
 *   - `echo`           — returns args as text content.
 *   - `fail`           — returns `{ isError: true }`. Tests non-retryable path.
 *   - `flaky`          — fails the first `fail_n` times per idempotency_key,
 *                        then succeeds. Retries with the same key converge.
 *   - `crash`          — process.exit(1) on first call. Tests child_died retry.
 *   - `stream`         — emits 3 `notifications/message` chunks then returns
 *                        a final result.
 *
 * Wire format: newline-delimited JSON-RPC 2.0. The MCP TypeScript SDK
 * 1.x (`@modelcontextprotocol/sdk/client/stdio`) uses newline-delimited
 * JSON (`serializeMessage = JSON.stringify(msg) + '\n'`) — NOT the
 * Content-Length framing used by LSP. The fixture speaks the SDK's wire
 * format so the production transport (which wires StdioClientTransport
 * under the hood) can talk to it without rewriting.
 */

const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes the input back as text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
  {
    name: 'fail',
    description: 'Always returns isError=true.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flaky',
    description: 'Fails fail_n times then succeeds; keyed by idempotency_key.',
    inputSchema: {
      type: 'object',
      properties: {
        fail_n: { type: 'number' },
        result: { type: 'string' },
      },
    },
  },
  {
    name: 'crash',
    description: 'process.exit(1) on first call.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stream',
    description: 'Emits 3 chunks via notifications/message then returns a result.',
    inputSchema: { type: 'object', properties: { prefix: { type: 'string' } } },
  },
];

const flakyCounters = new Map();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function errResp(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

async function handleCall(id, name, args) {
  args = args || {};
  switch (name) {
    case 'echo':
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(args) }],
      });
    case 'fail':
      return ok(id, { content: [{ type: 'text', text: 'failed' }], isError: true });
    case 'flaky': {
      const key = args.idempotency_key || `__no_key_${Date.now()}_${Math.random()}`;
      const count = flakyCounters.get(key) || 0;
      flakyCounters.set(key, count + 1);
      const fail_n = Number(args.fail_n || 0);
      if (count < fail_n) {
        return errResp(id, -32001, `flaky failure ${count + 1}/${fail_n}`);
      }
      return ok(id, {
        content: [{ type: 'text', text: args.result || 'ok' }],
      });
    }
    case 'crash': {
      process.nextTick(() => process.exit(1));
      return undefined;
    }
    case 'stream': {
      const prefix = String(args.prefix || 'chunk');
      // `level` is required by `LoggingMessageNotificationParamsSchema` in
      // `@modelcontextprotocol/sdk` — without it the client's notification
      // handler rejects the message and the stream yields no chunks.
      notify('notifications/message', { level: 'info', data: { seq: 1, value: `${prefix}-1` } });
      notify('notifications/message', { level: 'info', data: { seq: 2, value: `${prefix}-2` } });
      notify('notifications/message', { level: 'info', data: { seq: 3, value: `${prefix}-3` } });
      return ok(id, {
        content: [{ type: 'text', text: `${prefix}-done` }],
      });
    }
    default:
      return errResp(id, -32601, `tool not found: ${name}`);
  }
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.method === 'initialize') {
      ok(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'fake-mcp-server', version: '0.1.0' },
        capabilities: { tools: {} },
      });
    } else if (msg.method === 'notifications/initialized') {
      // no-op
    } else if (msg.method === 'tools/list') {
      ok(msg.id, { tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      handleCall(
        msg.id,
        msg.params && msg.params.name,
        msg.params && msg.params.arguments,
      ).catch((e) =>
        errResp(msg.id, -32603, String(e && e.message ? e.message : e)),
      );
    } else if (msg.id !== undefined) {
      errResp(msg.id, -32601, `unknown method: ${msg.method}`);
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
