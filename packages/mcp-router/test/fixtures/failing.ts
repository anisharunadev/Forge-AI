/**
 * `forge-ai/mcp-router` — acceptance harness fixture: a deliberately-failing MCP.
 *
 * Used by FORA-48 / FORA-450 AC #2 to prove the per-server circuit breaker
 * trips after N consecutive `upstream_error` failures and short-circuits the
 * next invocation with the typed `circuit_open` McpError in ≤50ms (well under
 * the FORA-446 budget — assert ≤25ms with comfortable margin).
 *
 * `BoomTransport` is the simplest possible `McpTransport` that always throws
 * with `Error('boom')` — the router wraps that into an `upstream_error`
 * envelope (`McpUpstreamError.upstream_message = 'boom'`), increments the
 * breaker failure count, and opens the breaker at the configured threshold.
 *
 * FORA-450 (acceptance harness).
 */

import {
  asServerName,
  asToolName,
  type McpTransport,
  type ServerManifest,
  type ToolName,
  type McpArgs,
  type McpRequestContext,
} from '../../src/index.js';

/** Server name used by this fixture. Stable so tests can reference it. */
export const FAILING_SERVER_NAME = asServerName('failing');

/** Single tool the failing server exposes. */
export const FAILING_TOOL_NAME = asToolName('do_thing');

/**
 * `McpTransport` impl that ALWAYS throws `Error('boom')`. Every invoke call
 * increments `invokeCalls` so tests can assert the transport was actually
 * reached on the failure path (and NOT reached once the breaker opens).
 */
export class BoomTransport implements McpTransport {
  public invokeCalls = 0;

  async invoke(
    _server: ServerManifest,
    _tool: ToolName,
    _args: McpArgs,
    _ctx: McpRequestContext,
  ): Promise<unknown> {
    this.invokeCalls += 1;
    throw new Error('boom');
  }
}

/**
 * Server manifest for the failing fixture. Global-scoped so AC #2 is purely
 * about the breaker behavior — no tenant-scope gate noise. Tools array has a
 * single descriptor so `tool_not_found` can't fire on the breaker-trip path.
 */
export const FAILING_MANIFEST: ServerManifest = {
  name: FAILING_SERVER_NAME,
  bin: 'node',
  argv: ['failing.js'],
  tenantScope: 'global',
  tools: [
    {
      name: FAILING_TOOL_NAME,
      label: 'Do Thing',
      description: 'Always throws — used to exercise the per-server breaker.',
      input_schema: { type: 'object', properties: {} },
      tags: ['test-fixture'],
    },
  ],
  healthcheck: { kind: 'none' },
};
