/**
 * @fora/mcp-schemas — toJsonSchema + shapeToJsonSchema tests
 *
 * The conversion layer between the Zod shapes every MCP server defines and
 * the JSON-Schema strings the router / broker hand to callers. The contract
 * is: convert without throwing, preserve descriptions, survive a JSON
 * round-trip (the wire format), and default to JSON Schema 2019-09 (the
 * newest draft `zod-to-json-schema@3.x` supports).
 *
 * Coverage:
 *   - toJsonSchema on primitive Zod types
 *   - shapeToJsonSchema on a raw shape produces a { type: "object" } schema
 *   - per-field `.describe(...)` strings survive into property descriptions
 *   - empty shape -> { type: "object", properties: {}, required: [] }
 *   - target dialects (jsonSchema7, jsonSchema2019-09, openApi3, openAi)
 *   - JSON.stringify -> JSON.parse preserves the schema verbatim
 *   - title / description envelope stripping when caller didn't set them
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { shapeToJsonSchema, toJsonSchema } from '../src/to-json-schema.js';

describe('toJsonSchema', () => {
  it('converts a primitive Zod type to its JSON Schema form', () => {
    const out = toJsonSchema(z.string());
    expect(out).toMatchObject({ type: 'string' });
  });

  it('converts a Zod object schema to a { type: "object" } schema', () => {
    const out = toJsonSchema(z.object({ name: z.string() }));
    expect(out.type).toBe('object');
    const props = out.properties as Record<string, unknown>;
    expect(props.name).toMatchObject({ type: 'string' });
  });

  it('preserves .describe(...) on object properties as a "description"', () => {
    const out = toJsonSchema(
      z.object({
        ticketId: z.number().int().positive().describe('Zendesk ticket ID.'),
        body: z.string().min(1).describe('Comment body in plain text.'),
      }),
    );
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.ticketId?.description).toBe('Zendesk ticket ID.');
    expect(props.body?.description).toBe('Comment body in plain text.');
  });

  it('applies a $schema envelope for the 2019-09 target (default)', () => {
    const out = toJsonSchema(z.string());
    expect(out.$schema).toBe('https://json-schema.org/draft/2019-09/schema');
  });

  it('switches to draft-07 when target=jsonSchema7', () => {
    const out = toJsonSchema(z.string(), { target: 'jsonSchema7' });
    expect(out.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('switches to OpenAPI 3 when target=openApi3', () => {
    const out = toJsonSchema(z.string(), { target: 'openApi3' });
    // OpenAPI 3 does not emit a `$schema` URL — it lives under `nullable` instead.
    expect(out.$schema).toBeUndefined();
  });

  it('accepts the openAi target without throwing', () => {
    const out = toJsonSchema(z.string(), { target: 'openAi' });
    expect(out).toMatchObject({ type: 'string' });
  });

  it('applies opts.name as a $id and opts.description as a top-level description', () => {
    const out = toJsonSchema(z.string(), {
      name: 'MyString',
      description: 'a single string',
    });
    expect(out.$id).toBe('MyString');
    expect(out.description).toBe('a single string');
  });

  it('survives a JSON round-trip (the wire format)', () => {
    const out = toJsonSchema(
      z.object({ name: z.string(), count: z.number().int() }),
    );
    const wire = JSON.parse(JSON.stringify(out)) as unknown;
    expect(wire).toEqual(out);
  });
});

describe('shapeToJsonSchema', () => {
  it('returns { type: "object", properties, required } for a raw shape', () => {
    const out = shapeToJsonSchema({
      page: z.number().int().min(1).default(1).describe('Page number.'),
      perPage: z.number().int().min(1).max(100).default(50).describe('Page size.'),
    });
    expect(out.type).toBe('object');
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.page?.description).toBe('Page number.');
    expect(props.perPage?.description).toBe('Page size.');
  });

  it('returns an empty object schema for an empty shape', () => {
    const out = shapeToJsonSchema({});
    expect(out.type).toBe('object');
    const props = out.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual([]);
  });

  it('omits the wrapper title when opts.name is not provided', () => {
    const out = shapeToJsonSchema({ name: z.string() });
    expect(out.title).toBeUndefined();
  });

  it('omits the wrapper description when opts.description is not provided', () => {
    const out = shapeToJsonSchema({ name: z.string() });
    expect(out.description).toBeUndefined();
  });

  it('keeps the wrapper title when opts.name is provided', () => {
    const out = shapeToJsonSchema({ name: z.string() }, { name: 'Wrapper' });
    expect(out.title).toBe('Wrapper');
  });

  it('preserves per-field descriptions while the wrapper is stripped', () => {
    const out = shapeToJsonSchema({
      secretRef: z.string().min(1).describe('Opaque secret reference (e.g. `aws-sm://myapp/db`).'),
    });
    expect(out.title).toBeUndefined();
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.secretRef?.description).toBe(
      'Opaque secret reference (e.g. `aws-sm://myapp/db`).',
    );
  });

  it('handles z.literal(true) and z.enum (mutation confirm + status enums)', () => {
    const out = shapeToJsonSchema({
      confirm: z.literal(true).describe('Explicit confirmation.'),
      status: z.enum(['new', 'open', 'pending']),
    });
    const props = out.properties as Record<string, Record<string, unknown>>;
    // z.literal(true) collapses to { const: true } in zod-to-json-schema.
    expect(props.confirm?.const).toBe(true);
    expect(props.status?.enum).toEqual(['new', 'open', 'pending']);
  });

  it('handles z.array and nested z.object (tags + comment shapes)', () => {
    const out = shapeToJsonSchema({
      tags: z.array(z.string()).optional().describe('Tags to apply.'),
      comment: z
        .object({
          body: z.string().min(1).describe('Comment body.'),
          public: z.boolean().optional().describe('Public flag.'),
        })
        .optional()
        .describe('Optional comment.'),
    });
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.tags?.type).toBe('array');
    const commentProps = (props.comment?.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(commentProps.body?.description).toBe('Comment body.');
  });

  it('survives a JSON round-trip (the wire format)', () => {
    const out = shapeToJsonSchema({
      ticketId: z.number().int().positive().describe('Zendesk ticket ID.'),
      body: z.string().min(1).describe('Comment body.'),
    });
    const wire = JSON.parse(JSON.stringify(out)) as unknown;
    expect(wire).toEqual(out);
  });
});
