import { describe, it, expect } from 'vitest';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Response in stub', () => {
  it('response.json() works inside the stub function', async () => {
    const r = jsonResponse(400, { error: { code: 'X', message: 'y' } });
    expect(r.status).toBe(400);
    expect(typeof r.json).toBe('function');
    const j = await r.json();
    expect(j).toEqual({ error: { code: 'X', message: 'y' } });
  });
});
