/**
 * @fora/mcp-transport — frame_io unit tests
 *
 * Verifies the Content-Length framed JSON-RPC encoder/decoder against an
 * in-memory stream pair. Per FORA-48 §3.4 the wire format must match the
 * canonical MCP stdio spec exactly.
 */

import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  isNotification,
  isResponse,
  readFrames,
  writeFrame,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../frame_io.js';

/** Build a paired in-memory Readable + Writable for round-trip tests. */
function pair(): { input: Readable; output: Writable; sink: Buffer } {
  const sink: Buffer = Buffer.alloc(0);
  const input = new Readable({ read() {} });
  const output = new Writable({
    write(chunk, _enc, cb) {
      // Append into `sink` so tests can later feed it back into `input`.
      (sink as unknown as { _writes: Buffer[] })._writes = [
        ...((sink as unknown as { _writes?: Buffer[] })._writes ?? []),
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      ];
      cb();
    },
  });
  return { input, output, sink };
}

/** Feed a buffer into the readable half of a pair. */
function feed(input: Readable, buffer: Buffer): void {
  input.push(buffer);
}

describe('writeFrame', () => {
  it('emits Content-Length header followed by JSON body', async () => {
    const { output, sink } = pair();
    const writes: Buffer[] = (sink as unknown as { _writes: Buffer[] })._writes = [];
    void output;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'ping' };
    await writeFrame(
      new Writable({
        write(chunk, _enc, cb) {
          writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          cb();
        },
      }),
      req,
    );
    const total = Buffer.concat(writes);
    const headerEnd = total.indexOf('\r\n\r\n');
    expect(headerEnd).toBeGreaterThan(-1);
    const header = total.subarray(0, headerEnd).toString('utf8');
    const body = total.subarray(headerEnd + 4).toString('utf8');
    expect(header).toMatch(/^Content-Length: \d+$/);
    const expectedLen = Number(/Content-Length: (\d+)/.exec(header)![1]);
    expect(expectedLen).toBe(Buffer.byteLength(body, 'utf8'));
    expect(JSON.parse(body)).toEqual(req);
  });
});

describe('readFrames', () => {
  it('decodes a single Content-Length framed message', async () => {
    const { input } = pair();
    const writer = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    void writer;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id: 7, method: 'tools/list' };
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
      body,
    ]);
    feed(input, frame);

    const gen = readFrames(input);
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual(msg);

    input.push(null); // EOF
    const end = await gen.next();
    expect(end.done).toBe(true);
  });

  it('decodes multiple frames in one chunk', async () => {
    const { input } = pair();
    const a: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'a' };
    const b: JsonRpcResponse = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    const bodyA = Buffer.from(JSON.stringify(a), 'utf8');
    const bodyB = Buffer.from(JSON.stringify(b), 'utf8');
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${bodyA.length}\r\n\r\n`, 'utf8'),
      bodyA,
      Buffer.from(`Content-Length: ${bodyB.length}\r\n\r\n`, 'utf8'),
      bodyB,
    ]);
    feed(input, frame);
    input.push(null); // EOF
    const out: unknown[] = [];
    for await (const m of readFrames(input)) out.push(m);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(a);
    expect(out[1]).toEqual(b);
  });

  it('skips malformed JSON and resyncs on the next valid frame', async () => {
    const { input } = pair();
    const good: JsonRpcRequest = { jsonrpc: '2.0', id: 9, method: 'ok' };
    const bodyGood = Buffer.from(JSON.stringify(good), 'utf8');
    // Garbage header + bad body followed by a clean frame. The decoder
    // must drop the truncated junk and resync.
    const garbage = Buffer.from('Content-Length: 999999\r\n\r\n{not-json');
    const frame = Buffer.concat([
      garbage,
      Buffer.from(`Content-Length: ${bodyGood.length}\r\n\r\n`, 'utf8'),
      bodyGood,
    ]);
    feed(input, frame);
    input.push(null); // EOF
    const out: unknown[] = [];
    for await (const m of readFrames(input)) out.push(m);
    expect(out).toEqual([good]);
  });
});

describe('isResponse / isNotification', () => {
  it('detects responses by id + result/error', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: {} } as never)).toBe(true);
    expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } } as never)).toBe(true);
  });

  it('detects notifications by method without id', () => {
    expect(isNotification({ jsonrpc: '2.0', method: 'notifications/message', params: {} } as never)).toBe(true);
    expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'x' } as never)).toBe(false);
  });
});
