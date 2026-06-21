/**
 * @fora/mcp-schemas — registry port
 *
 * The `SchemaRegistry` interface is the typed port the rest of the platform
 * depends on. The default implementation (`InMemorySchemaRegistry`) lives in
 * `./in-memory.ts`; downstream callers (router, tools adapter, broker)
 * program against the interface so the registry can be swapped to a
 * file-backed or shared cache without touching consumers.
 *
 * Contract:
 *   - `register(serverName, tools)` REPLACES any prior registration for the
 *     same server. The registry is the source of truth for live MCP server
 *     tool shapes; re-registration on (re)connect is the expected pattern.
 *   - `get(serverName)` returns the latest registered record, or `undefined`
 *     if no server is registered.
 *   - `list()` returns every registered server in insertion order. The
 *     order matters: it drives UI listings and audit event sequencing.
 */

import type { ServerName, ServerSchema, ToolSchema } from './types.js';

export interface SchemaRegistry {
  /**
   * Register (or replace) the tool set for `serverName`. Returns the
   * canonical `ServerSchema` record as stored, useful for chaining on
   * registration completion.
   */
  register(serverName: ServerName, tools: readonly ToolSchema[]): ServerSchema;

  /**
   * Fetch the registered schema for `serverName`, or `undefined` if not
   * registered.
   */
  get(serverName: ServerName): ServerSchema | undefined;

  /**
   * List every registered server in insertion order.
   */
  list(): readonly ServerSchema[];

  /**
   * Drop a server from the registry. Idempotent — returns `true` if a
   * record was removed, `false` if no record existed.
   */
  unregister(serverName: ServerName): boolean;

  /**
   * Total number of registered servers. Convenience for diagnostics.
   */
  size(): number;
}
