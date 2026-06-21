/**
 * @fora/mcp-schemas — public API
 *
 * The only surface the rest of the platform imports. Re-exports the typed
 * port, types, the in-memory reference implementation, and the Zod →
 * JSON-Schema conversion helpers.
 *
 * See FORA-48 §3.2 (v0.1 plan) and FORA-445 for the sub-goal that lands
 * this.
 */

export type {
  JsonSchema,
  ServerName,
  ServerSchema,
  ToolName,
  ToolSchema,
} from './types.js';

export { asServerName, asToolName } from './types.js';

export type { SchemaRegistry } from './registry.js';

export {
  InMemorySchemaRegistry,
  type InMemorySchemaRegistryOptions,
} from './in-memory.js';

export {
  shapeToJsonSchema,
  toJsonSchema,
  type ToJsonSchemaOptions,
  type ToJsonSchemaTarget,
} from './to-json-schema.js';
