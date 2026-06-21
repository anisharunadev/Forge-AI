/**
 * @fora/mcp-schemas — InMemorySchemaRegistry
 *
 * Pure-logic reference implementation of `SchemaRegistry`. Stores entries
 * in a Map keyed by server name; insertion order is preserved via the Map's
 * own iteration order (JS Map iteration is insertion-ordered).
 *
 * Thread-safety: not thread-safe. Callers (the router, the orchestrator)
 * are single-threaded JS; if this is ever wired into a worker boundary,
 * wrap with a synchronisation primitive.
 *
 * Defensive copy: the constructor (and `register`) freeze the returned
 * `ServerSchema` so callers cannot mutate the registry's internal state by
 * holding onto the returned reference.
 */

import type { SchemaRegistry } from './registry.js';
import type { ServerName, ServerSchema, ToolSchema } from './types.js';

export interface InMemorySchemaRegistryOptions {
  /**
   * Seed the registry at construction time. Useful for tests and for
   * boot-time static registrations (the FORA-128 secrets-mcp fixtures,
   * for example).
   */
  readonly seed?: ReadonlyArray<{
    readonly serverName: ServerName;
    readonly tools: readonly ToolSchema[];
  }>;
}

const deepFreeze = (input: unknown): unknown => {
  if (input === null || typeof input !== 'object') return input;
  if (Object.isFrozen(input)) return input;
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(obj);
};

const freezeServerSchema = (record: ServerSchema): ServerSchema =>
  Object.freeze({
    serverName: record.serverName,
    tools: Object.freeze(
      record.tools.map((t) =>
        Object.freeze({
          name: t.name,
          description: t.description,
          input_schema: deepFreeze(
            t.input_schema,
          ) as ServerSchema['tools'][number]['input_schema'],
        }) as ToolSchema,
      ),
    ) as readonly ToolSchema[],
  });

export class InMemorySchemaRegistry implements SchemaRegistry {
  readonly #entries = new Map<ServerName, ServerSchema>();

  constructor(opts: InMemorySchemaRegistryOptions = {}) {
    if (opts.seed) {
      for (const { serverName, tools } of opts.seed) {
        this.#entries.set(serverName, freezeServerSchema({ serverName, tools }));
      }
    }
  }

  register(serverName: ServerName, tools: readonly ToolSchema[]): ServerSchema {
    // `Map.set` on an existing key preserves the original insertion order,
    // so to move a re-registered server to the tail of `list()` we delete
    // the entry first and re-insert at the end. For first-write servers
    // the delete is a no-op.
    this.#entries.delete(serverName);
    const record: ServerSchema = freezeServerSchema({ serverName, tools });
    this.#entries.set(serverName, record);
    return record;
  }

  get(serverName: ServerName): ServerSchema | undefined {
    return this.#entries.get(serverName);
  }

  list(): readonly ServerSchema[] {
    // Defensive copy — the array itself is fresh on each call so callers
    // cannot mutate the iteration buffer.
    return Array.from(this.#entries.values());
  }

  unregister(serverName: ServerName): boolean {
    return this.#entries.delete(serverName);
  }

  size(): number {
    return this.#entries.size;
  }
}
