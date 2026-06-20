/**
 * Per-tenant scope guard wire-up for the agent runtime (FORA-48 §3.5 /
 * FORA-448).
 *
 * The runtime is the chokepoint for every MCP call. This module is the
 * one place that knows how to construct an `McpRouter` with the
 * production HTTP scope-guard adapters wired in:
 *
 *   - `HttpTenantValidator`     → `@fora/identity-broker`
 *   - `HttpCredentialResolver`  → `@fora/customer-cloud-broker`
 *
 * Both adapters fail closed on transport failure (the router shapes the
 * failure as `validator_unreachable` / `resolver_unreachable` and never
 * spawns the upstream MCP process — AC #3).
 *
 * The `McpTransport` is the seam a future production transport plugs
 * into. v0.1 keeps the in-memory `InMemoryMcpRouter`'s default transport
 * (a stub that throws `no transport configured`); a follow-up wires the
 * real stdio / HTTP transport for MCP servers.
 *
 * The scope guard is intentionally optional. A test runtime can pass
 * `validator: undefined` / `resolver: undefined` to disable the
 * production guard and rely on the router's manifest-only scope gate
 * (FORA-444 baseline).
 */

import { InMemoryMcpRouter, type McpAuditSink } from '@fora/mcp-router';
import {
  HttpTenantValidator,
  type HttpTenantValidatorOptions,
} from '@fora/identity-broker';
import {
  HttpCredentialResolver,
  type HttpCredentialResolverOptions,
} from '@fora/customer-cloud-broker';

export interface BuildProductionMcpRouterOptions {
  /** Identity-broker base URL (e.g. `http://identity-broker:8080`). */
  identityBrokerUrl: string;
  /** Customer-cloud-broker base URL. */
  customerCloudBrokerUrl: string;
  /** Audit sink. Optional — defaults to the router's `NullAuditSink`. */
  audit?: McpAuditSink;
  /** Override the validator (e.g. for tests). When omitted, `HttpTenantValidator` is constructed. */
  validator?: HttpTenantValidator | null;
  /** Override the resolver (e.g. for tests). When omitted, `HttpCredentialResolver` is constructed. */
  resolver?: HttpCredentialResolver | null;
  /** Per-request timeout for both adapters. Default 1500ms. */
  timeoutMs?: number;
  /** Extra options forwarded to the validator constructor. */
  validatorOpts?: Omit<HttpTenantValidatorOptions, 'baseUrl' | 'timeoutMs'>;
  /** Extra options forwarded to the resolver constructor. */
  resolverOpts?: Omit<HttpCredentialResolverOptions, 'baseUrl' | 'timeoutMs'>;
}

/**
 * Build the production MCP router with the per-tenant scope guard
 * wired. Callers register their manifests on the returned router.
 *
 * The returned router is a regular `InMemoryMcpRouter` from
 * `@fora/mcp-router` — the only difference is the two adapters are
 * injected as constructor options. Tests can pass `validator: null` /
 * `resolver: null` to disable either stage.
 */
export function buildProductionMcpRouter(
  opts: BuildProductionMcpRouterOptions,
): InMemoryMcpRouter {
  const timeout = opts.timeoutMs ?? 1500;
  const validator =
    opts.validator !== undefined
      ? opts.validator
      : opts.identityBrokerUrl
        ? new HttpTenantValidator({
            baseUrl: opts.identityBrokerUrl,
            timeoutMs: timeout,
            ...(opts.validatorOpts ?? {}),
          })
        : null;
  const resolver =
    opts.resolver !== undefined
      ? opts.resolver
      : opts.customerCloudBrokerUrl
        ? new HttpCredentialResolver({
            baseUrl: opts.customerCloudBrokerUrl,
            timeoutMs: timeout,
            ...(opts.resolverOpts ?? {}),
          })
        : null;

  return new InMemoryMcpRouter({
    ...(opts.audit ? { audit: opts.audit } : {}),
    ...(validator ? { tenant_validator: validator } : {}),
    ...(resolver ? { credential_resolver: resolver } : {}),
  });
}
