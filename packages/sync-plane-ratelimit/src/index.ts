/**
 * @fora/sync-plane-ratelimit — outbound reliability for the Sync
 * Plane. Implements FORA-487 (FORA-391 Plan 5) — the three-layer
 * cross-connector rate limiter + backoff service. v0.1 was FORA-256
 * (Epic 11.6) per ADR-0010 §7.1 and §8.2 R-SYNC-03. Pattern reused
 * from @fora/customer-cloud-broker (FORA-126.5).
 *
 * Public API:
 *   - TokenBucket, CircuitBreaker       — primitive building blocks
 *   - Coalescer                         — composite-edit coalescing (W=30s)
 *   - ProviderCeiling                   — Layer 1 (provider ceiling, hard)
 *   - TierTable                         — Layer 2 (per-tenant quota, configurable)
 *   - ActorBucketRegistry               — per-actor burst control (Layer 4)
 *   - OutboundReliability               — orchestrator wiring all layers
 *   - BackoffPolicy                     — pure retry-policy calculator
 *   - BackoffScheduler                  — retry orchestrator (FORA-487.3)
 *   - TenantWeightedFifo                — round-robin fairness queue
 *   - InMemorySyncOpStore               — FORA-401 sync_op dedupe (test seam)
 *   - uuidV7                            — Idempotency-Key generation
 *   - AuditSink / InMemoryAuditSink / NoopAuditSink
 *     + makeEvent / SyncAuditEventType
 */

export { TokenBucket, type TokenBucketOpts } from './token_bucket.js';
export { CircuitBreaker, type CircuitBreakerOpts, type BreakerState, type BreakerTransition } from './circuit_breaker.js';
export {
  Coalescer,
  type CoalesceConfig,
  type CoalesceFlushResult,
  type CompositeEdit,
  type EditKind,
  type OutboundEdit,
  type PlatformId,
} from './coalescer.js';
export {
  ProviderCeiling,
  defaultCeilingRegistry,
  type AuthMethod,
  type CeilingConfig,
  type CeilingRegistry,
  type ConnectorId,
  type ProviderCeilingOpts,
  type ProviderFeedback,
  type Scope,
} from './provider_ceiling.js';
export {
  TierTable,
  DEFAULT_TIERS,
  type ProjectOverride,
  type TenantTier,
  type TierLimits,
  type TierResolution,
  type TierTableOpts,
} from './tier_table.js';
export {
  ActorBucket,
  ActorBucketRegistry,
  type ActorBucketOpts,
} from './actor_bucket.js';
export {
  OutboundReliability,
  type EnqueueDisposition,
  type OutboundConfig,
  type OutboundPlatformCallContext,
  type PlatformCall,
  type PlatformCallResult,
  type CompositeBody,
} from './outbound.js';
export {
  BackoffPolicy,
  type BackoffPolicyOpts,
  type ParsedRetryAfter,
} from './backoff_policy.js';
export {
  BackoffScheduler,
  TenantWeightedFifo,
  defaultIsRetryable,
  type BackoffSchedulerOpts,
  type ExecutionResult,
  type HttpVerb,
  type PlatformCallResultForBackoff,
  type SchedulerCall,
} from './backoff_scheduler.js';
export {
  InMemorySyncOpStore,
  type SyncOpRecord,
  type SyncOpStore,
} from './sync_op_store.js';
export { uuidV7, uuidV7Timestamp } from './idempotency_key.js';
export {
  InMemoryAuditSink,
  NoopAuditSink,
  makeEvent,
  type AuditSink,
  type SyncAuditEvent,
  type SyncAuditEventType,
} from './audit.js';
