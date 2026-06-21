/**
 * @fora/mcp-schemas — types
 *
 * The schema-registry contract. The registry holds, per MCP server name, the
 * list of JSON-Schemas derived from each tool's Zod input shape. This file
 * defines the public types only — runtime objects live in `in-memory.ts`.
 *
 * Conventions:
 *   - `serverName` matches `ServerManifest.name` from `@fora/mcp-router`
 *     (branded `ServerName`).
 *   - `toolName` matches `McpToolDescriptor.name` from `@fora/mcp-router`
 *     (branded `ToolName`).
 *   - `ToolSchema` is the JSON-Schema form (already converted from Zod);
 *     callers receive a JSON-Schema object, not a Zod schema. Re-conversion
 *     from the registry output is not supported by design — the registry is
 *     a one-way derivation store.
 *   - `JsonSchema` is intentionally typed as `Record<string, unknown>` to
 *     match the rest of the platform's JSON-Schema boundary conventions
 *     (no fake type safety on free-form schema bodies).
 */

export type ServerName = string & { readonly __brand: 'ServerName' };
export type ToolName = string & { readonly __brand: 'ToolName' };

/**
 * A free-form JSON Schema value. The registry does not enforce shape; the
 * caller (router, broker, etc.) decides which draft / dialect to validate
 * against. Matches `McpToolDescriptor.input_schema` in `@fora/mcp-router`.
 */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * One tool's registration record: its name, description (model-facing copy
 * preserved verbatim), and the JSON-Schema form of its Zod input shape.
 */
export interface ToolSchema {
  readonly name: ToolName;
  readonly description: string;
  readonly input_schema: JsonSchema;
}

/**
 * One server's registration record: server name + the list of tools.
 * Carried in audit events and exposed via `SchemaRegistry.list()`.
 */
export interface ServerSchema {
  readonly serverName: ServerName;
  readonly tools: readonly ToolSchema[];
}

export const asServerName = (s: string): ServerName => s as ServerName;
export const asToolName = (s: string): ToolName => s as ToolName;
