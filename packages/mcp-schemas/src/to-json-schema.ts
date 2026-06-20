/**
 * @fora/mcp-schemas — toJsonSchema
 *
 * Convert a Zod schema (single value or raw shape) to its JSON-Schema
 * representation. Uses `zod-to-json-schema` (the same dependency the MCP SDK
 * uses internally) so the output matches what an MCP server would advertise
 * over stdio.
 *
 * The default target is JSON Schema draft 2019-09 — the newest draft
 * `zod-to-json-schema@3.x` supports. (The MCP spec's preferred draft is
 * 2020-12, but the underlying library has not caught up; consumers that
 * require 2020-12 should add a `postProcess` step that rewrites the
 * `$schema` URL.) 2019-09 is a superset of draft-07 and is accepted by
 * every JSON Schema validator we depend on.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import type { JsonSchema } from './types.js';

/** Targets supported by `zod-to-json-schema@3.x`. Mirrors its `Targets` type. */
export type ToJsonSchemaTarget =
  | 'jsonSchema7'
  | 'jsonSchema2019-09'
  | 'openApi3'
  | 'openAi';

export interface ToJsonSchemaOptions {
  /**
   * JSON Schema target dialect. Default `'jsonSchema2019-09'` (newest draft
   * the underlying library supports; matches what the MCP SDK emits).
   */
  readonly target?: ToJsonSchemaTarget;
  /**
   * Name to apply to the schema's `$id`. Optional.
   */
  readonly name?: string;
  /**
   * Description to set as `description`. Optional.
   */
  readonly description?: string;
}

/**
 * Internal: raw conversion via `zod-to-json-schema`, with target dispatch
 * and the 2019-09 `$schema` URL trailing-`#` stripped (the upstream library
 * appends `#` to anchor fragments; the JSON Schema 2019-09 spec URL the
 * rest of the platform emits does NOT include the fragment). Draft-07's URL
 * legitimately includes the `#`, so we only strip for the 2019-09 target.
 */
function convertViaZod(
  schema: z.ZodTypeAny,
  opts: ToJsonSchemaOptions,
): Record<string, unknown> {
  const target = opts.target ?? 'jsonSchema2019-09';
  const converted = zodToJsonSchema(schema, {
    target,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.description !== undefined ? { description: opts.description } : {}),
  }) as Record<string, unknown>;
  // The 2019-09 schema URL is conventionally emitted without a fragment
  // ("https://json-schema.org/draft/2019-09/schema"). zod-to-json-schema
  // appends '#' to anchor fragments; strip it for this target only.
  if (
    target === 'jsonSchema2019-09' &&
    typeof converted.$schema === 'string' &&
    converted.$schema === 'https://json-schema.org/draft/2019-09/schema#'
  ) {
    converted.$schema = 'https://json-schema.org/draft/2019-09/schema';
  }
  return converted;
}

/**
 * Convert a single Zod schema to a JSON-Schema object.
 *
 * Accepts any `ZodTypeAny` — object schemas, primitives, unions, etc. For a
 * raw shape (a record of `key → ZodTypeAny`), wrap with `z.object(shape)`
 * first, or call `shapeToJsonSchema` instead.
 *
 * `opts.name` is exposed as `$id` on the resulting schema (the contract
 * callers in the router and broker rely on). `zod-to-json-schema` puts the
 * name into `title` by default; we rename it to `$id` here.
 *
 * `opts.description` is set as the top-level `description` (post-process —
 * `zod-to-json-schema` does not always surface the option for primitives,
 * so we set it explicitly when the caller provided it).
 */
export function toJsonSchema(
  schema: z.ZodTypeAny,
  opts: ToJsonSchemaOptions = {},
): JsonSchema {
  const converted = convertViaZod(schema, opts);
  if (opts.name !== undefined) {
    converted.$id = opts.name;
    delete converted.title;
  }
  if (opts.description !== undefined) {
    converted.description = opts.description;
  }
  return converted;
}

/**
 * Convert a raw Zod shape (a `Record<string, ZodTypeAny>` like the one the
 * MCP SDK uses on `server.tool(name, description, shape, handler)`) into a
 * JSON Schema object with `type: "object"`. Each shape field is converted
 * individually so per-field `.describe(...)` strings survive into the
 * `description` of each property.
 *
 * Returns `{ type: "object", properties: {...}, required: [...] }` plus any
 * `$schema` / `additionalProperties` envelope from `zod-to-json-schema`.
 *
 * `opts.name` is preserved as the wrapper object's `title` (NOT renamed to
 * `$id` — the wrapper title is the natural identifier for an object schema).
 * When the caller does not set a name, the wrapper title is stripped so the
 * shape output reads as a clean per-tool object schema.
 *
 * Empty shapes return `{ type: "object", properties: {}, required: [] }`.
 */
export function shapeToJsonSchema(
  shape: Readonly<Record<string, z.ZodTypeAny>>,
  opts: ToJsonSchemaOptions = {},
): JsonSchema {
  // Wrap the raw shape in z.object() so zod-to-json-schema handles the
  // nested conversion + required-set derivation consistently. This matches
  // what the MCP SDK does internally.
  // The shape can be empty; z.object({}) is valid and yields an object schema.
  const objectSchema = z.object({ ...shape });
  // Convert directly via the upstream library — do NOT route through
  // `toJsonSchema` here, since that function renames `name` → `$id` and we
  // want the wrapper's `title` preserved for the object-shape path.
  const converted = convertViaZod(objectSchema, opts);
  // Explicitly set the wrapper title when the caller named the shape.
  // zod-to-json-schema does not always surface the `name` option for
  // wrapped object schemas, so we set it directly to honour the contract.
  if (opts.name !== undefined) {
    converted.title = opts.name;
  } else {
    delete (converted as Record<string, unknown>)['title'];
  }
  if (opts.description === undefined) {
    delete (converted as Record<string, unknown>)['description'];
  }
  return converted;
}
