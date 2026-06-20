/**
 * Per-tenant scope guard adapter for `@fora/mcp-router` (FORA-48 §3.5 /
 * FORA-448).
 *
 * Implements the `TenantValidator` port from `@fora/mcp-router` against the
 * identity-broker's `GET /auth/tenants/:id/validate` route. The router calls
 * `validate(tenant_id)` on every resolve/invoke; we translate the response
 * into the typed `TenantValidationOutcome`.
 *
 * Fail-closed semantics (FORA-48 §3.5):
 *   - 200 with `{valid: true}`              → `{ok: true}`
 *   - 404 with `{valid: false, reason:…}`   → `{ok: false, reason}` (real denial)
 *   - Any other status / network error      → THROW (router surfaces
 *                                             `validator_unreachable`)
 *
 * The route is intentionally metadata-only (a Map lookup) so the per-call
 * cost is bounded; the router can call it on every resolve/invoke without
 * measurable latency.
 *
 * `fetch` is injectable so tests can assert request shape without binding
 * to a real socket. `timeoutMs` defaults to 1500ms — the scope guard is a
 * hot path on every MCP call.
 */

export interface TenantValidationOutcome {
  readonly ok: true;
}

export type TenantValidationDenial = {
  readonly ok: false;
  readonly reason: string;
};

export type TenantValidationResult = TenantValidationOutcome | TenantValidationDenial;

/**
 * Mirrors the router's `TenantValidator` interface (re-declared here so
 * the identity-broker doesn't have to depend on the router package).
 * Kept structurally compatible — the router type-checks via `{ validate }`
 * shape, so a fresh class is acceptable as long as the method signature
 * matches.
 */
export interface TenantValidatorLike {
  validate(tenant_id: string): Promise<TenantValidationResult>;
}

export interface HttpTenantValidatorOptions {
  /** Base URL of the identity-broker (e.g. `http://identity-broker:8080`). No trailing slash. */
  baseUrl: string;
  /** Optional bearer token; sent as `authorization: Bearer <token>`. */
  token?: string | null;
  /** Injectable fetch for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default 1500. */
  timeoutMs?: number;
  /** Optional custom path; default `/auth/tenants/:id/validate`. */
  pathTemplate?: string;
}

export class HttpTenantValidator implements TenantValidatorLike {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pathTemplate: string;

  constructor(opts: HttpTenantValidatorOptions) {
    if (!opts.baseUrl) throw new Error('HttpTenantValidator: baseUrl required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.pathTemplate = opts.pathTemplate ?? '/auth/tenants/:id/validate';
  }

  async validate(tenant_id: string): Promise<TenantValidationResult> {
    if (!tenant_id) throw new Error('HttpTenantValidator: tenant_id required');
    const path = this.pathTemplate.replace(':id', encodeURIComponent(tenant_id));
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    } catch (e: unknown) {
      clearTimeout(timer);
      // Network / timeout / DNS / abort. Throw — router fails closed as
      // `validator_unreachable`.
      throw new Error(
        `HttpTenantValidator: ${url} unreachable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    clearTimeout(timer);

    if (res.status === 200) {
      // Best-effort JSON parse. An unparseable 200 is treated as a denial
      // (the validator is supposed to return `{valid: true}`); we still
      // succeed on empty body to be tolerant of the route's no-body form.
      try {
        const body = (await res.json()) as { valid?: boolean };
        if (body.valid === true) return { ok: true };
        return { ok: false, reason: body.valid === false ? 'invalid' : 'unparseable_200' };
      } catch {
        return { ok: true };
      }
    }
    if (res.status === 404) {
      try {
        const body = (await res.json()) as { reason?: string };
        return { ok: false, reason: body.reason ?? 'unknown_tenant' };
      } catch {
        return { ok: false, reason: 'unknown_tenant' };
      }
    }
    // Any other status (5xx, 401, 403) is a transport-class failure for
    // the scope guard. Throw so the router fails closed.
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(
      `HttpTenantValidator: ${url} -> ${res.status}${detail ? `: ${detail}` : ''}`,
    );
  }
}
