/**
 * @fora/mcp-router — public API
 *
 * The only surface the rest of the platform imports. Re-exports the typed
 * port, types, errors, in-memory router, and audit sinks.
 *
 * See FORA-48 §3.1 (v0.1 plan) and FORA-444 for the sub-goal that lands the
 * core port; FORA-448 wires the per-tenant scope guard (identity-broker +
 * customer-cloud-broker).
 */

export type {
  CredentialResolutionOutcome,
  CredentialResolver,
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
  McpResolvedCredential,
  McpRouter,
  McpToolDescriptor,
  ServerManifest,
  ServerName,
  TenantId,
  TenantScope,
  TenantValidationOutcome,
  TenantValidator,
  ToolName,
} from './types.js';

export { asServerName, asTenantId, asToolName } from './types.js';

export type {
  McpArgsInvalidError,
  McpCircuitOpenError,
  McpCredentialDeniedError,
  McpError,
  McpErrorEnvelope,
  McpErrorKind as McpErrorKindName,
  McpResolverUnreachableError,
  McpScopeDeniedError,
  McpTenantInvalidError,
  McpToolNotFoundError,
  McpUnavailableError,
  McpUpstreamError,
  McpValidatorUnreachableError,
} from './errors.js';

export {
  argsInvalid,
  circuitOpen,
  credentialDenied,
  isArgsInvalid,
  isCircuitOpen,
  isCredentialDenied,
  isMcpError,
  isResolverUnreachable,
  isScopeDenied,
  isTenantInvalid,
  isToolNotFound,
  isUnavailable,
  isUpstreamError,
  isValidatorUnreachable,
  resolverUnreachable,
  scopeDenied,
  tenantInvalid,
  toolNotFound,
  unavailable,
  upstreamError,
  validatorUnreachable,
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
