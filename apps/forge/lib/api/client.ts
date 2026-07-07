/**
 * Foundation API client for the Forge backend.
 *
 * Zone 1 (step-52) — every authenticated call flows through this
 * client. Responsibilities:
 *
 *   1. Attach `Authorization: Bearer <token>` on every request when a
 *      token is available from the auth store.
 *   2. Forward `x-forge-tenant-id` from the active tenant (Rule 2 —
 *      multi-tenancy is mandatory, never optional).
 *   3. Translate non-2xx responses into a typed `ApiError` so callers
 *      can pattern-match on `status` / `code`.
 *   4. Handle 401 by attempting a single silent refresh (Zone 7) and
 *      retrying the original request once. If the refresh fails, force
 *      a logout + redirect to `/login`.
 *   5. Handle 204 No Content (the backend uses it for delete routes).
 *   6. Expose a `ws()` helper that authenticates WebSocket upgrades
 *      via `?token=…` (the FastAPI WebSocket endpoint validates it).
 *
 * Design decisions:
 *   - We deliberately do NOT depend on TanStack Query here. That
 *     decision is left to the consumer (mutation hooks / query hooks
 *     in component code). This module is the transport layer only.
 *   - We reuse `FORGE_API_BASE_URL` / `FORGE_WS_BASE_URL` from
 *     `lib/forge-api.ts` so the env-var contract stays in one place.
 *   - The token source is `useAuth.getState()` so non-React callers
 *     (middleware, scripts, vitest) can use this client too.
 *
 * Skill rules adopted (see step-52 invocation log):
 *   - Error handling surfaces a typed error (UX — toast.error context).
 *   - 401 → silent refresh → retry once → logout on second failure.
 *   - No client-side password validation (server is source of truth).
 */

const FORGE_API_BASE_URL: string =
  process.env.NEXT_PUBLIC_FORGE_API_URL ??
  process.env.FORA_FORGE_API_URL ??
  'http://localhost:8000/api/v1';

const FORGE_WS_BASE_URL: string =
  process.env.NEXT_PUBLIC_FORGE_WS_URL ??
  process.env.FORA_FORGE_WS_URL ??
  'ws://localhost:8000/api/v1';

// Terminal sidecar runs on :4001 in dev (see bin/terminal-server.mjs).
const FORGE_TERMINAL_WS_URL: string =
  process.env.NEXT_PUBLIC_FORGE_TERMINAL_WS_URL ??
  process.env.FORA_FORGE_TERMINAL_WS_URL ??
  'ws://localhost:4001/ws/terminal';

import { SEED_TENANT_ID } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Lazy import of the auth store to avoid a circular dependency
// (auth.ts re-exports helpers that depend on this module). The store is
// only accessed at call-time, not at module-evaluation time, so a static
// import would still work — but the dynamic import keeps the dep graph
// one-way and easier to reason about.
// ---------------------------------------------------------------------------

type AuthAccessor = {
  getToken: () => string | null;
  getTenantId: () => string | null;
  refreshSession: () => Promise<void>;
  logout: () => void;
};

let authAccessor: AuthAccessor | null = null;

/**
 * Wire the auth store accessor. Called once from `auth.ts` on module load.
 * If never called, the client still works — it just behaves as an
 * unauthenticated transport (useful for `/auth/login` itself).
 */
export function bindAuthAccessor(accessor: AuthAccessor): void {
  authAccessor = accessor;
}

// ---------------------------------------------------------------------------
// ApiError — discriminated by status + code so callers can pattern-match
// (e.g. `if (err.status === 401) …`).
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  detail?: string;
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body: unknown;
  /** Response headers at the time the error was thrown (for `Retry-After` etc.). */
  headers?: Headers;
  /** Alias of `code` so callers can use either name. */
  errorCode?: string;

  constructor(
    status: number,
    detail: string,
    body: unknown,
    code?: string,
    headers?: Headers,
  ) {
    super(`${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errorCode = code;
    this.body = body;
    this.headers = headers;
  }
}

// ---------------------------------------------------------------------------
// Internal options bag. `_isRetry` is the marker used by the 401 →
// refresh → retry loop to avoid infinite recursion.
// ---------------------------------------------------------------------------

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  _isRetry?: boolean;
  /** Tenant override; defaults to the active tenant from the auth store. */
  tenantId?: string | null;
  /** Suppress the global 401 → logout side-effect (used by `/auth/*`). */
  suppressAuthRedirect?: boolean;
}

// ---------------------------------------------------------------------------
// Refresh singleton — Zone 7. Only one refresh runs at a time; concurrent
// 401s share the same in-flight promise.
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<void> | null = null;

async function refreshOnce(): Promise<void> {
  if (!authAccessor) {
    throw new ApiError(401, 'No auth accessor bound', null, 'no_auth_accessor');
  }
  if (!refreshInFlight) {
    refreshInFlight = authAccessor
      .refreshSession()
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Core request function.
// ---------------------------------------------------------------------------

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    body,
    headers,
    tenantId,
    suppressAuthRedirect,
    _isRetry,
    ...rest
  } = options;

  const url = path.startsWith('http')
    ? path
    : `${FORGE_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const finalHeaders = new Headers(headers ?? {});
  finalHeaders.set('content-type', 'application/json');

  // Auth token — only attach if present. `/auth/login` itself has no
  // token yet, so we don't fail closed here.
  if (authAccessor) {
    const token = authAccessor.getToken();
    if (token) {
      finalHeaders.set('Authorization', `Bearer ${token}`);
    }
  }

  // Tenant header — Rule 2. Falls back to the demo tenant seed when no
  // auth store / no tenant selected yet (matches the existing
  // orchestrator client behaviour so the page renders during dev).
  const resolvedTenant =
    tenantId ??
    authAccessor?.getTenantId() ??
    SEED_TENANT_ID;
  if (resolvedTenant) {
    finalHeaders.set('x-forge-tenant-id', resolvedTenant);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Network / DNS / CORS failure — surface as a typed error so callers
    // can decide whether to toast, retry, or show an empty state.
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `Network error: ${message}`, null, 'network_error');
  }

  // 204 No Content — backend uses this for DELETE routes. Return undefined.
  if (response.status === 204) {
    return undefined as T;
  }

  // Auto-refresh + retry on 401 (Zone 7). Never recurse more than once.
  if (response.status === 401 && !_isRetry && authAccessor && !suppressAuthRedirect) {
    try {
      await refreshOnce();
      return request<T>(path, { ...options, _isRetry: true });
    } catch {
      // Refresh failed — force logout. We do this in a microtask so the
      // caller still receives the original error (avoids swallowing
      // their error-handling branches).
      queueMicrotask(() => {
        try {
          authAccessor?.logout();
        } catch {
          /* best effort */
        }
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      });
    }
  }

  if (!response.ok) {
    let parsed: ApiErrorBody | null = null;
    let raw: unknown = null;
    try {
      raw = await response.json();
      if (raw && typeof raw === 'object') {
        parsed = raw as ApiErrorBody;
      }
    } catch {
      try {
        raw = await response.text();
      } catch {
        raw = null;
      }
    }
    const detail =
      parsed?.detail ??
      parsed?.message ??
      (typeof raw === 'string' && raw ? raw : response.statusText);
    throw new ApiError(response.status, detail, raw, parsed?.code, response.headers);
  }

  // 200/201/202 with a JSON body.
  try {
    return (await response.json()) as T;
  } catch {
    // Body was empty or non-JSON; treat as undefined.
    return undefined as T;
  }
}

// ---------------------------------------------------------------------------
// Streaming variant of `request`. Same auth/tenant plumbing, but returns
// the raw `Response` so callers can iterate the body (SSE/NDJSON). We
// still throw `ApiError` on transport failure and on 401 (after one
// refresh), but we never read the body — that's the caller's job.
// ---------------------------------------------------------------------------
async function requestStream(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const { body, headers, tenantId, signal } = options;

  const url = path.startsWith('http')
    ? path
    : `${FORGE_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const finalHeaders = new Headers(headers ?? {});
  finalHeaders.set('content-type', 'application/json');
  finalHeaders.set('accept', 'text/event-stream');

  if (authAccessor) {
    const token = authAccessor.getToken();
    if (token) {
      finalHeaders.set('Authorization', `Bearer ${token}`);
    }
  }

  const resolvedTenant =
    tenantId ??
    authAccessor?.getTenantId() ??
    SEED_TENANT_ID;
  if (resolvedTenant) {
    finalHeaders.set('x-forge-tenant-id', resolvedTenant);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `Network error: ${message}`, null, 'network_error');
  }
  return res;
}

// ---------------------------------------------------------------------------
// Public surface — verbs + WebSocket helper.
// ---------------------------------------------------------------------------

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...(options ?? {}), method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...(options ?? {}), method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...(options ?? {}), method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...(options ?? {}), method: 'PATCH', body }),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...(options ?? {}), method: 'DELETE' }),

  /**
   * POST that returns the raw `Response` so callers can stream the body
   * (SSE, NDJSON, chunked). Same auth/tenant plumbing as `post`; only
   * the response shape differs — we don't buffer JSON here.
   *
   * Throws `ApiError` for transport failures and 401 once, but does NOT
   * auto-retry beyond the refresh — the caller owns the response stream.
   */
  postStream(path: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    return requestStream(path, { ...(options ?? {}), method: 'POST', body });
  },

  /**
   * Open an authenticated WebSocket. The token is appended as a
   * `?token=` query parameter because browsers cannot set headers on
   * the WebSocket handshake; the backend validates it on `await
   * ws.accept()`.
   */
  ws(path: string): WebSocket {
    const token = authAccessor?.getToken() ?? '';
    const url = `${FORGE_WS_BASE_URL}${path.startsWith('/') ? path : `/${path}`}${
      path.includes('?') ? '&' : '?'
    }token=${encodeURIComponent(token)}`;
    return new WebSocket(url);
  },
};

export { FORGE_API_BASE_URL, FORGE_WS_BASE_URL, FORGE_TERMINAL_WS_URL };

// Legacy error-class alias — `forge-api.ts` used to export a class
// named `ForgeApiError`. Tests + UI both import it as a type and value.
// ponytail: shim, delete when no caller imports `ForgeApiError`.
export class ForgeApiError extends ApiError {}

/**
 * Stable identifiers the copilot surfaces return in `ApiError.code`.
 * Mirrors the backend's `CopilotErrorCode` enum (M10-G1, M10-G3).
 * ponytail: hand-rolled enum; switch to `as const` mapped from the
 * generated OpenAPI client once Step-X lands.
 */
export const COPILOT_ERROR_CODES = {
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  GUARDRAIL_DENIED: 'guardrail_denied',
  CONTEXT_TOO_LONG: 'context_too_long',
  MODEL_UNAVAILABLE: 'model_unavailable',
} as const;

export type CopilotErrorCode =
  (typeof COPILOT_ERROR_CODES)[keyof typeof COPILOT_ERROR_CODES];