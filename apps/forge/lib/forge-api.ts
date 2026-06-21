/**
 * Forge backend API client.
 *
 * Resolves the orchestrator base URL from environment variables so the same
 * code works in dev, CI, and production. Coexists with `lib/api.ts` which is
 * the legacy orchestrator REST client used by the persona dashboards.
 */

export const FORGE_API_BASE_URL: string =
  process.env.NEXT_PUBLIC_FORGE_API_URL ??
  process.env.FORA_FORGE_API_URL ??
  'http://localhost:8000/api/v1';

export const FORGE_WS_BASE_URL: string =
  process.env.NEXT_PUBLIC_FORGE_WS_URL ??
  process.env.FORA_FORGE_WS_URL ??
  'ws://localhost:8000/api/v1';

/**
 * WebSocket URL the xterm.js terminal pane connects to. Separate
 * from FORGE_WS_BASE_URL because terminal sessions are served by
 * a dedicated PTY sidecar (`bin/terminal-server.mjs`) on :4001 in
 * dev, not by the orchestrator event bus on :4000. The real
 * orchestrator will eventually expose its own terminal endpoint;
 * until then the sidecar fills the gap.
 */
export const FORGE_TERMINAL_WS_URL: string =
  process.env.NEXT_PUBLIC_FORGE_TERMINAL_WS_URL ??
  process.env.FORA_FORGE_TERMINAL_WS_URL ??
  'ws://localhost:4001/ws/terminal';

export interface ForgeFetchOptions extends RequestInit {
  /** Optional tenant id to forward as `x-forge-tenant-id`. */
  tenantId?: string;
}

export class ForgeApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ForgeApiError';
    this.status = status;
    this.body = body;
  }
}

export async function forgeFetch<T>(
  path: string,
  options: ForgeFetchOptions = {},
): Promise<T> {
  const { tenantId, headers, ...rest } = options;
  const url = path.startsWith('http')
    ? path
    : `${FORGE_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(tenantId ? { 'x-forge-tenant-id': tenantId } : {}),
      ...(headers ?? {}),
    },
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = null;
      }
    }
    throw new ForgeApiError(
      `Forge API ${response.status} ${response.statusText} on ${path}`,
      response.status,
      body,
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
