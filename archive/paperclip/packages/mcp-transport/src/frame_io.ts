/**
 * @fora/mcp-transport — stdio JSON-RPC frame I/O
 *
 * Content-Length framed JSON-RPC 2.0 messages, one frame at a time:
 *
 *   Content-Length: <N>\r\n
 *   \r\n
 *   <json object of N bytes>
 *
 * The reader is async-iterable: `readFrames()` yields decoded JSON-RPC
 * messages forever (until EOF or abort). The writer is fire-and-forget —
 * `writeFrame` enqueues JSON onto the child's stdin and resolves once the
 * underlying socket has flushed.
 *
 * NOTE: the MCP TypeScript SDK 1.x (`@modelcontextprotocol/sdk/client/stdio`)
 * uses newline-delimited JSON for its own stdio transport, NOT the
 * Content-Length framing implemented here. This module is provided for
 * interop with non-SDK MCP servers (or future transports) that do speak
 * the LSP-style Content-Length wire format. The production
 * `StdioChildProcessTransport` wires the SDK's `StdioClientTransport`
 * directly, so the runtime never goes through this file.
 */

import type { Readable, Writable } from 'node:stream';

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * Maximum body size we will accept for a single Content-Length frame.
 * 64 KiB is a generous cap for a JSON-RPC envelope; anything larger is
 * almost certainly a corrupted length prefix.
 */
export const MAX_FRAME_BYTES = 64 * 1024;

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg);
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !('id' in msg) && 'method' in msg;
}

/**
 * Write a single JSON-RPC frame to a writable stream. Returns a promise that
 * resolves when the underlying write has flushed.
 */
export function writeFrame(
  out: Writable,
  msg: JsonRpcMessage,
): Promise<void> {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return new Promise<void>((resolve, reject) => {
    // `Buffer` is a `Uint8Array` subclass but the Node stream types use
    // `Uint8Array<ArrayBuffer>` (vs `Buffer`'s `Uint8Array<ArrayBufferLike>`),
    // so a runtime-correct cast is required here.
    const payload = Buffer.concat([header as unknown as Uint8Array, body as unknown as Uint8Array]) as unknown as Uint8Array;
    out.write(payload, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Async-iterable reader over a stream of Content-Length framed JSON-RPC
 * messages. Stops on EOF or when `abortSignal` fires.
 */
export async function* readFrames(
  input: Readable,
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<JsonRpcMessage> {
  let buf = Buffer.alloc(0);
  // We use the Node stream interface directly to keep this package
  // dependency-light.
  const queue: JsonRpcMessage[] = [];
  let waiter: ((v: JsonRpcMessage | null) => void) | null = null;
  let ended = false;

  const onData = (chunk: Buffer | string): void => {
    const c: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    // Same `Uint8Array<ArrayBuffer>` vs `Buffer` mismatch as in writeFrame;
    // runtime concatenation is fine.
    buf = Buffer.concat([buf as unknown as Uint8Array, c as unknown as Uint8Array] as unknown as readonly Uint8Array[]);
    let off = 0;
    while (true) {
      const headerEnd = buf.indexOf('\r\n\r\n', off);
      if (headerEnd === -1) break;
      const header = buf.subarray(off, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m || !m[1]) {
        // Malformed header — discard one byte and resync.
        off += 1;
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (len > MAX_FRAME_BYTES) {
        // Pathological header — drop the entire bogus frame and resync.
        // Without this, a header claiming an absurd body length would
        // stall the parser forever waiting for data that never arrives.
        off = bodyStart;
        continue;
      }
      if (buf.length < bodyStart + len) break; // need more data
      const body = buf.subarray(bodyStart, bodyStart + len).toString('utf8');
      off = bodyStart + len;
      try {
        const msg = JSON.parse(body) as JsonRpcMessage;
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(msg);
        } else {
          queue.push(msg);
        }
      } catch {
        // Malformed JSON — drop and continue.
      }
    }
    if (off > 0) buf = buf.subarray(off);
  };

  const onEnd = (): void => {
    ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  };

  const onError = (err: Error): void => {
    ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
    // Surface errors by ending the generator; caller can detect via `done`.
    void err;
  };

  input.on('data', onData);
  input.on('end', onEnd);
  input.on('error', onError);

  const onAbort = (): void => {
    ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (true) {
      if (queue.length > 0) {
        const m = queue.shift()!;
        yield m;
        continue;
      }
      if (ended) return;
      const msg = await new Promise<JsonRpcMessage | null>((resolve) => {
        waiter = resolve;
      });
      if (msg === null) return;
      yield msg;
    }
  } finally {
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('error', onError);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}