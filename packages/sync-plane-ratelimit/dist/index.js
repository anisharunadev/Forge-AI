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
export { TokenBucket } from './token_bucket.js';
export { CircuitBreaker } from './circuit_breaker.js';
export { Coalescer, } from './coalescer.js';
export { OutboundReliability, } from './outbound.js';
export { InMemoryAuditSink, NoopAuditSink, makeEvent, } from './audit.js';
//# sourceMappingURL=index.js.map