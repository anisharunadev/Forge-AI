/**
 * @fora/mcp-router — public API
 *
 * The only surface the rest of the platform imports. Re-exports the typed
 * port, types, errors, in-memory router, and audit sinks.
 *
 * See FORA-48 §3.1 (v0.1 plan) and FORA-444 for the sub-goal that lands this.
 */

export type {
  Healthcheck,
  McpArgs,
  McpAuditEvent,
  McpErrorKind,
  McpInvocationError,
  McpInvocationResult,
  McpInvocationSuccess,
  McpRequestContext,
  McpResolution,
  McpResolutionResult,
  McpRouter,
  McpToolDescriptor,
  ServerManifest,
  ServerName,
  TenantId,
  TenantScope,
  ToolName,
} from './types.js';

export { asServerName, asTenantId, asToolName } from './types.js';

export type {
  McpArgsInvalidError,
  McpCircuitOpenError,
  McpError,
  McpErrorEnvelope,
  McpErrorKind as McpErrorKindName,
  McpScopeDeniedError,
  McpToolNotFoundError,
  McpUnavailableError,
  McpUpstreamError,
} from './errors.js';

export {
  argsInvalid,
  circuitOpen,
  isArgsInvalid,
  isCircuitOpen,
  isMcpError,
  isScopeDenied,
  isToolNotFound,
  isUnavailable,
  isUpstreamError,
  scopeDenied,
  toolNotFound,
  unavailable,
  upstreamError,
} from './errors.js';

export {
  InMemoryMcpRouter,
  ScriptedTransport,
  type Clock,
  type InMemoryMcpRouterOptions,
  type McpTransport,
  type Sleeper,
} from './in_memory_router.js';

export {
  defaultAuditSink,
  InMemoryAuditSink,
  NullAuditSink,
  type McpAuditSink,
} from './audit.js';