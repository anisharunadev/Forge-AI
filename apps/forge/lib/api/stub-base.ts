/**
 * Server-only stub port resolver.
 *
 * The dev orchestrator stub (`bin/orchestrator-stub.py`) writes its
 * bound port to `.stub-port` at startup. Server-side fetchers in
 * `lib/api.ts` need that port so they hit the same instance the
 * browser hits via `/api/proxy/*`.
 *
 * This file is imported only from server components and route
 * handlers. It uses `node:fs` directly — safe on the server, and
 * intentionally NOT imported from any client component to keep
 * webpack from trying to bundle `node:` modules into the browser.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';

let cached: string | null = null;
let resolved = false;

/**
 * Returns the stub's bound port, or null when no port file exists
 * (e.g. in production, serverless, or before the stub has started).
 * Result is cached after first read so subsequent calls are O(1).
 */
export function readStubPort(): string | null {
  if (resolved) return cached;
  resolved = true;
  try {
    const portFile = nodePath.join(process.cwd(), '.stub-port');
    if (!fs.existsSync(portFile)) return null;
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    if (raw && /^\d+$/.test(raw)) {
      cached = raw;
      return cached;
    }
  } catch {
    /* read-only fs / edge runtime: ignore */
  }
  return null;
}

export const STUB_BASE = (port: string) => `http://localhost:${port}`;