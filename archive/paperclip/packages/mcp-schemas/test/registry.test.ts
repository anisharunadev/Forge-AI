/**
 * @fora/mcp-schemas — SchemaRegistry port contract tests
 *
 * The InMemorySchemaRegistry is the reference implementation of the
 * `SchemaRegistry` port. These tests pin the contract: the router, the
 * orchestrator, and any future shared-cache implementation must match it.
 *
 * Coverage:
 *   - register replaces on second call
 *   - get / list / size / unregister basic behavior
 *   - insertion order preserved (Map iteration order is the spec)
 *   - defensive freeze on returned records
 *   - seed option at construction time
 *   - unregister is idempotent
 */

import { describe, expect, it } from 'vitest';

import { InMemorySchemaRegistry } from '../src/in-memory.js';
import type { ServerName, ToolSchema } from '../src/types.js';
import { asServerName, asToolName } from '../src/types.js';

const S = (s: string): ServerName => asServerName(s);
const T = (s: string) => asToolName(s);

const makeTool = (name: string, description: string): ToolSchema =>
  Object.freeze({
    name: T(name),
    description,
    input_schema: Object.freeze({
      type: 'object',
      properties: Object.freeze({}),
      required: Object.freeze([]),
    }),
  }) as ToolSchema;

describe('InMemorySchemaRegistry', () => {
  it('starts empty when no seed is supplied', () => {
    const reg = new InMemorySchemaRegistry();
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
    expect(reg.get(S('anything'))).toBeUndefined();
  });

  it('register stores a server record retrievable via get + list', () => {
    const reg = new InMemorySchemaRegistry();
    const tools = [makeTool('alpha', 'first tool'), makeTool('beta', 'second tool')];
    const stored = reg.register(S('svc-a'), tools);

    expect(stored.serverName).toBe(S('svc-a'));
    expect(stored.tools).toHaveLength(2);
    expect(stored.tools[0]?.name).toBe(T('alpha'));
    expect(stored.tools[1]?.name).toBe(T('beta'));

    expect(reg.size()).toBe(1);
    expect(reg.get(S('svc-a'))?.tools).toEqual(stored.tools);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0]?.serverName).toBe(S('svc-a'));
  });

  it('register replaces the prior record on the same server name', () => {
    const reg = new InMemorySchemaRegistry();
    reg.register(S('svc-a'), [makeTool('v1', 'v1 tool')]);
    const v2 = reg.register(S('svc-a'), [makeTool('v2', 'v2 tool')]);

    expect(reg.size()).toBe(1);
    expect(reg.get(S('svc-a'))?.tools[0]?.name).toBe(T('v2'));
    expect(v2.tools[0]?.description).toBe('v2 tool');
  });

  it('list preserves insertion order on first write', () => {
    const reg = new InMemorySchemaRegistry();
    reg.register(S('a'), []);
    reg.register(S('b'), []);
    reg.register(S('c'), []);
    expect(reg.list().map((r) => r.serverName)).toEqual([S('a'), S('b'), S('c')]);
  });

  it('re-registering an existing server moves it to the tail of list()', () => {
    const reg = new InMemorySchemaRegistry();
    reg.register(S('a'), []);
    reg.register(S('b'), []);
    reg.register(S('c'), []);
    reg.register(S('a'), []); // re-register a
    expect(reg.list().map((r) => r.serverName)).toEqual([S('b'), S('c'), S('a')]);
  });

  it('unregister drops the server and is idempotent', () => {
    const reg = new InMemorySchemaRegistry();
    reg.register(S('a'), []);
    expect(reg.unregister(S('a'))).toBe(true);
    expect(reg.unregister(S('a'))).toBe(false);
    expect(reg.unregister(S('nope'))).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it('seed option pre-populates the registry at construction time', () => {
    const reg = new InMemorySchemaRegistry({
      seed: [
        { serverName: S('alpha'), tools: [makeTool('a1', 'a1')] },
        { serverName: S('beta'), tools: [makeTool('b1', 'b1')] },
      ],
    });
    expect(reg.size()).toBe(2);
    expect(reg.get(S('alpha'))?.tools[0]?.name).toBe(T('a1'));
    expect(reg.get(S('beta'))?.tools[0]?.name).toBe(T('b1'));
  });

  it('returned records are deeply frozen so callers cannot mutate registry state', () => {
    const reg = new InMemorySchemaRegistry();
    const tool = makeTool('alpha', 'first tool');
    const stored = reg.register(S('svc-a'), [tool]);

    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.tools)).toBe(true);
    expect(Object.isFrozen(stored.tools[0])).toBe(true);
    expect(Object.isFrozen(stored.tools[0]?.input_schema)).toBe(true);

    expect(() => {
      // @ts-expect-error - intentionally mutating a frozen record
      stored.tools[0].description = 'tampered';
    }).toThrow();
  });

  it('list() returns a fresh array on every call (defensive copy)', () => {
    const reg = new InMemorySchemaRegistry();
    reg.register(S('a'), []);
    const a = reg.list();
    const b = reg.list();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('preserves the input tool array as a readonly view (no aliasing)', () => {
    const reg = new InMemorySchemaRegistry();
    const tools = [makeTool('alpha', 'first tool')];
    reg.register(S('svc-a'), tools);
    const fetched = reg.get(S('svc-a'));
    expect(fetched?.tools).not.toBe(tools);
    expect(fetched?.tools[0]).toEqual(tools[0]);
  });

  it('accepts an empty tools array (server with zero tools)', () => {
    const reg = new InMemorySchemaRegistry();
    const stored = reg.register(S('empty'), []);
    expect(stored.tools).toEqual([]);
    expect(reg.size()).toBe(1);
  });

  it('handles many servers without leaking state between them', () => {
    const reg = new InMemorySchemaRegistry();
    for (let i = 0; i < 50; i++) {
      reg.register(S(`svc-${i}`), [makeTool(`tool-${i}`, `desc-${i}`)]);
    }
    expect(reg.size()).toBe(50);
    expect(reg.get(S('svc-0'))?.tools[0]?.description).toBe('desc-0');
    expect(reg.get(S('svc-49'))?.tools[0]?.description).toBe('desc-49');
    reg.unregister(S('svc-25'));
    expect(reg.size()).toBe(49);
    expect(reg.get(S('svc-25'))).toBeUndefined();
  });
});
