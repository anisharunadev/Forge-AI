/**
 * @fora/sync-plane-ratelimit — outbound reliability for the Sync
 * Plane. Implements FORA-256 (Epic 11.6) per ADR-0010 §7.1 / §8.2
 * R-SYNC-03. Pattern reused from @fora/customer-cloud-broker
 * (FORA-126.5).
 *
 * Public API:
 *   - TokenBucket, CircuitBreaker — primitive building blocks
 *   - Coalescer                   — composite-edit coalescing (W=30s)
 *   - OutboundReliability         — orchestrator wiring all three
 *   - AuditSink / InMemoryAuditSink / NoopAuditSink
 *     + makeEvent / SyncAuditEventType
 */
export { TokenBucket, type TokenBucketOpts } from './token_bucket.js';
export { CircuitBreaker, type CircuitBreakerOpts, type BreakerState, type BreakerTransition } from './circuit_breaker.js';
export { Coalescer, type CoalesceConfig, type CoalesceFlushResult, type CompositeEdit, type EditKind, type OutboundEdit, type PlatformId, } from './coalescer.js';
export { OutboundReliability, type EnqueueDisposition, type OutboundConfig, type OutboundPlatformCallContext, type PlatformCall, type PlatformCallResult, type CompositeBody, } from './outbound.js';
export { InMemoryAuditSink, NoopAuditSink, makeEvent, type AuditSink, type SyncAuditEvent, type SyncAuditEventType, } from './audit.js';
