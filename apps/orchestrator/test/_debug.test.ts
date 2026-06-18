import { describe, it, expect } from 'vitest';

describe('Response sanity check', () => {
  it('Response.json() works in this test env', async () => {
    const r = new Response(JSON.stringify({ a: 1 }), { status: 201 });
    const j = await r.json();
    expect(j).toEqual({ a: 1 });
  });
});
