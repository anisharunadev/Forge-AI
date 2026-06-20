/**
 * Per-tenant scope guard adapter for `@fora/mcp-router` (FORA-48 §3.5 /
 * FORA-448).
 *
 * Implements the `CredentialResolver` port from `@fora/mcp-router` against
 * the customer-cloud-broker's `POST /credentials/resolve` route. The router
 * calls `resolve(tenant_id, server_name)` after the scope gate and before
 * the transport is invoked; we mint the per-(tenant, server) credential
 * material the transport will hand to the upstream MCP server.
 *
 * Fail-closed semantics (FORA-48 §3.5):
 *   - 200 with `{ok: true, credential: {...}}`  → `{ok: true, credential}`
 *   - 200 with `{ok: false, reason: '...'}`, 4xx → `{ok: false, reason}`
 *   - Any other status / network error / 5xx    → THROW (router surfaces
 *                                                  `resolver_unreachable`)
 *
 * The credential returned is opaque to the router — the transport reads it
 * from `ctx.credential` and forwards it to the upstream MCP. v1 of the
 * route returns a stub `{kind, server_name, tenant_id, issued_at_ms,
 * expires_at_ms}`; a future ADR lands a real federation token. The stub
 * is enough to prove the wire path; the format is broker-owned.
 *
 * `fetch` is injectable so tests can assert request shape without binding
 * to a real socket. `timeoutMs` defaults to 1500ms.
 */

export interface CredentialResolutionOk {
  readonly ok: true;
  readonly credential: unknown;
}

export type CredentialResolutionDenial = {
  readonly ok: false;
  readonly reason: string;
};

export type CredentialResolutionResult =
  | CredentialResolutionOk
  | CredentialResolutionDenial;

export interface CredentialResolverLike {
  resolve(tenant_id: string, server_name: string): Promise<CredentialResolutionResult>;
}

export interface HttpCredentialResolverOptions {
  baseUrl: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pathTemplate?: string;
  trace_id?: string | null;
}

export class HttpCredentialResolver implements CredentialResolverLike {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pathTemplate: string;
  private readonly trace_id: string | null;

  constructor(opts: HttpCredentialResolverOptions) {
    if (!opts.baseUrl) throw new Error('HttpCredentialResolver: baseUrl required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.pathTemplate = opts.pathTemplate ?? '/credentials/resolve';
    this.trace_id = opts.trace_id ?? null;
  }

  async resolve(tenant_id: string, server_name: string): Promise<CredentialResolutionResult> {
    if (!tenant_id) throw new Error('HttpCredentialResolver: tenant_id required');
    if (!server_name) throw new Error('HttpCredentialResolver: server_name required');
    const url = `${this.baseUrl}${this.pathTemplate}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const body = JSON.stringify({
      tenant_id,
      server_name,
      ...(this.trace_id ? { trace_id: this.trace_id } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (e: unknown) {
      clearTimeout(timer);
      throw new Error(
        `HttpCredentialResolver: ${url} unreachable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    clearTimeout(timer);

    if (res.status >= 200 && res.status < 300) {
      const payload = (await res.json()) as
        | { ok: true; credential: unknown }
        | { ok: false; reason: string }
        | { valid?: boolean };
      if ('ok' in payload && payload.ok === true) {
        return { ok: true, credential: payload.credential };
      }
      if ('ok' in payload && payload.ok === false) {
        return { ok: false, reason: payload.reason };
      }
      // 200 with no `ok` field — treat as denial so the router fails closed.
      return { ok: false, reason: 'unparseable_200' };
    }
    if (res.status >= 400 && res.status < 500) {
      let detail = '';
      try {
        const payload = (await res.json()) as { reason?: string; error?: string };
        detail = payload.reason ?? payload.error ?? '';
      } catch {
        // ignore
      }
      return { ok: false, reason: detail || `client_error_${res.status}` };
    }
    // 5xx → transport-class failure → throw (fail closed).
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(
      `HttpCredentialResolver: ${url} -> ${res.status}${detail ? `: ${detail}` : ''}`,
    );
  }
}
