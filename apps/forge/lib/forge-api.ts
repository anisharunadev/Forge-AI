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
  /**
   * When true, return the raw `Response` instead of parsing JSON.
   * Used for SSE endpoints; the caller owns the ReadableStream.
   *
   * ponytail: stream mode skips both error-as-JSON and response.text() —
   * the caller handles non-2xx on the Response directly.
   */
  stream?: boolean;
}

/**
 * Best-effort extraction of the structured ``detail.error`` code
 * from a FastAPI-style error body. The orchestrator wraps every
 * failure in ``{ "detail": { "error": "<code>", ... } }`` so the
 * frontend can switch on a stable string instead of a numeric
 * status alone. Returns ``null`` when the body shape isn't
 * recognized.
 */
export function extractErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object') return null;
  const code = (detail as { error?: unknown }).error;
  if (typeof code !== 'string' || code.length === 0) return null;
  return code;
}

/**
 * Canonical wire-level error codes the copilot panel knows how to
 * render specialized toasts for. Track B (M10) — keeping these in
 * one place so the `ComposerInput` dispatch and the panel toast
 * listener can never drift apart.
 */
export const COPILOT_ERROR_CODES = {
  RATE_LIMIT_EXCEEDED: 'copilot.rate_limit_exceeded',
  GUARDRAIL_DENIED: 'copilot.guardrail_denied',
} as const;

export type CopilotErrorCode =
  (typeof COPILOT_ERROR_CODES)[keyof typeof COPILOT_ERROR_CODES];

export class ForgeApiError extends Error {
  status: number;
  body: unknown;
  /** Headers captured from the failing response (so callers can
   *  surface `Retry-After`, `x-request-id`, etc.). ``null`` when
   *  the failure happened before we received headers (network /
   *  CORS). */
  headers: Headers | null;
  /** Structured ``detail.error`` code from the orchestrator, or
   *  ``null`` when the body doesn't carry one. */
  errorCode: string | null;

  constructor(
    message: string,
    status: number,
    body: unknown,
    headers: Headers | null = null,
    errorCode: string | null = null,
  ) {
    super(message);
    this.name = 'ForgeApiError';
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.errorCode = errorCode;
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
      response.headers,
      extractErrorCode(body),
    );
  }

  if (options.stream) return response as unknown as T;

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
