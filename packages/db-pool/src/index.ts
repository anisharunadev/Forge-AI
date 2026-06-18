/**
 * Public surface of @fora/db-pool.
 *
 * Consumers (apps + future worker entry points) import from here, not
 * from deep paths. The wrapper is the *only* safe way to talk to the
 * FORA Postgres database; bypasses must be caught by review or by the
 * FORA-124 acceptance test that flips the feature flag to `enforced`.
 */

export { TenantAwarePool, parseEnforcement } from './pool.js';
export type {
  TenantAwarePoolOptions,
  EnforcementMode,
  UnderlyingPoolFactory,
  QueryArgs,
  ScopedClient,
} from './pool.js';
export {
  TenantClaimMismatchError,
  MissingRequestContextError,
  TenantIdSchema,
  NO_TENANT_SENTINEL,
} from './types.js';
export type { Claim, RequestContext, RequestEnvelope, TenantId, ActorId, AuditSink, TenancyAuditEvent } from './types.js';
export { InMemoryAuditSink } from './audit.js';
