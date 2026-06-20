/**
 * @fora/mcp-router — errors
 *
 * The `McpError` discriminated union. Every failure path in the router shapes
 * its result as one of these envelopes so the caller can switch on `kind`
 * instead of catching exceptions.
 *
 * Per FORA-48 §3.1: callers MUST treat errors as first-class data, never as
 * exceptions. The router may still throw on programmer errors (e.g. invalid
 * `manifest.healthcheck.kind`) — those are not part of the contract.
 */

import type { ServerName, ToolName, TenantId } from './types.js';

/** Discriminator for the McpError union. */
export type McpErrorKind =
  | 'unavailable'
  | 'scope_denied'
  | 'tool_not_found'
  | 'args_invalid'
  | 'upstream_error'
  | 'circuit_open';

/**
 * Common envelope fields. Every member of the union carries a `kind`, a
 * human-readable `message`, and the server that was the target.
 */
interface McpErrorBase {
  readonly kind: McpErrorKind;
  readonly message: string;
  readonly server: ServerName;
  readonly tool?: ToolName;
  readonly tenant_id?: TenantId;
  readonly at: string; // ISO 8601
}

/**
 * Router is up but the named server is not registered (or has been removed).
 * Distinct from `unavailable` in that the server does not exist in this router.
 */
export interface McpUnavailableError extends McpErrorBase {
  readonly kind: 'unavailable';
}

/**
 * The caller's scope (`tenant_id`, `agent_type`) is not authorized to resolve
 * or invoke the target server. Emitted by the tenant-scope gate.
 */
export interface McpScopeDeniedError extends McpErrorBase {
  readonly kind: 'scope_denied';
  readonly required_scope: 'global' | 'tenant' | 'agent';
  readonly caller_tenant_id: TenantId;
  readonly caller_agent_type?: string;
}

/** Tool name is not exposed by the server (or the manifest was loaded without it). */
export interface McpToolNotFoundError extends McpErrorBase {
  readonly kind: 'tool_not_found';
  readonly tool: ToolName;
  readonly available_tools?: readonly ToolName[];
}

/**
 * `args` failed JSON-Schema validation OR was rejected by the tool as
 * malformed. The router only carries this signal — actual schema validation
 * is the tool's job.
 */
export interface McpArgsInvalidError extends McpErrorBase {
  readonly kind: 'args_invalid';
  readonly tool: ToolName;
  readonly reason: string;
  readonly expected_schema?: Readonly<Record<string, unknown>>;
}

/**
 * Upstream MCP server returned a non-ok response (HTTP 5xx, bad JSON, etc).
 * The router wraps it; original error message is preserved.
 */
export interface McpUpstreamError extends McpErrorBase {
  readonly kind: 'upstream_error';
  readonly tool: ToolName;
  readonly upstream_message: string;
  readonly upstream_code?: string;
}

/**
 * Per-server circuit breaker is open. The router short-circuits invocations
 * for `cooldown_ms` after the failure threshold is exceeded. Surfaced as a
 * data field so callers can back off and retry.
 */
export interface McpCircuitOpenError extends McpErrorBase {
  readonly kind: 'circuit_open';
  readonly opened_at: string;
  readonly cooldown_ms: number;
  readonly failure_count: number;
}

/** The discriminated error envelope. Always returned with `status: 'error'`. */
export type McpError =
  | McpUnavailableError
  | McpScopeDeniedError
  | McpToolNotFoundError
  | McpArgsInvalidError
  | McpUpstreamError
  | McpCircuitOpenError;

/** Envelope returned by the router when an error fires. */
export interface McpErrorEnvelope {
  readonly status: 'error';
  readonly error: McpError;
}

/**
 * Type-narrowing helpers. Use these instead of inline `kind ===` chains
 * so call sites read cleanly.
 */
export const isMcpError = (e: McpErrorEnvelope): e is McpErrorEnvelope => e.status === 'error';

export const isScopeDenied = (e: McpErrorEnvelope): e is McpErrorEnvelope & { error: McpScopeDeniedError } =>
  e.status === 'error' && e.error.kind === 'scope_denied';

export const isToolNotFound = (e: McpErrorEnvelope): e is McpErrorEnvelope & { error: McpToolNotFoundError } =>
  e.status === 'error' && e.error.kind === 'tool_not_found';

export const isCircuitOpen = (e: McpErrorEnvelope): e is McpErrorEnvelope & { error: McpCircuitOpenError } =>
  e.status === 'error' && e.error.kind === 'circuit_open';

export const isArgsInvalid = (e: McpErrorEnvelope): e is McpErrorEnvelope & { error: McpArgsInvalidError } =>
  e.status === 'error' && e.error.kind === 'args_invalid';

export const isUpstreamError = (e: McpErrorEnvelope): e is McpErrorEnvelope & { error: McpUpstreamError } =>
  e.status === 'error' && e.error.kind === 'upstream_error';

export const isUnavailable = (e: McpErrorEnvelope): e is McpErrorEnvelope & { error: McpUnavailableError } =>
  e.status === 'error' && e.error.kind === 'unavailable';

// --- constructors (used by the in-memory router) ------------------------

const nowIso = (): string => new Date().toISOString();

export const unavailable = (
  server: ServerName,
  message = 'server not registered',
  tenant_id?: TenantId,
): McpErrorEnvelope => ({
  status: 'error',
  error: {
    kind: 'unavailable',
    message,
    server,
    ...(tenant_id ? { tenant_id } : {}),
    at: nowIso(),
  },
});

export const scopeDenied = (
  server: ServerName,
  required: 'global' | 'tenant' | 'agent',
  caller_tenant_id: TenantId,
  caller_agent_type: string | undefined,
  message = 'caller scope does not authorize this server',
): McpErrorEnvelope => ({
  status: 'error',
  error: {
    kind: 'scope_denied',
    message,
    server,
    required_scope: required,
    caller_tenant_id,
    ...(caller_agent_type !== undefined ? { caller_agent_type } : {}),
    at: nowIso(),
  },
});

export const toolNotFound = (
  server: ServerName,
  tool: ToolName,
  available_tools?: readonly ToolName[],
): McpErrorEnvelope => ({
  status: 'error',
  error: {
    kind: 'tool_not_found',
    message: `tool ${tool} not exposed by server ${server}`,
    server,
    tool,
    ...(available_tools ? { available_tools } : {}),
    at: nowIso(),
  },
});

export const argsInvalid = (
  server: ServerName,
  tool: ToolName,
  reason: string,
  expected_schema?: Readonly<Record<string, unknown>>,
): McpErrorEnvelope => ({
  status: 'error',
  error: {
    kind: 'args_invalid',
    message: `args rejected by ${server}:${tool}: ${reason}`,
    server,
    tool,
    reason,
    ...(expected_schema ? { expected_schema } : {}),
    at: nowIso(),
  },
});

export const upstreamError = (
  server: ServerName,
  tool: ToolName,
  upstream_message: string,
  upstream_code?: string,
): McpErrorEnvelope => ({
  status: 'error',
  error: {
    kind: 'upstream_error',
    message: `upstream error from ${server}:${tool}`,
    server,
    tool,
    upstream_message,
    ...(upstream_code ? { upstream_code } : {}),
    at: nowIso(),
  },
});

export const circuitOpen = (
  server: ServerName,
  opened_at: string,
  cooldown_ms: number,
  failure_count: number,
): McpErrorEnvelope => ({
  status: 'error',
  error: {
    kind: 'circuit_open',
    message: `circuit open for ${server}`,
    server,
    opened_at,
    cooldown_ms,
    failure_count,
    at: nowIso(),
  },
});