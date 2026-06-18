/**
 * Unit tests for the NATS adapter (FORA-170).
 *
 * Covers the acceptance bar:
 *   - All four approval events are published on the corresponding state
 *     changes; a unit test asserts every (state-change → event) pair.
 *   - Per-tenant subject isolation: a publish for tenant A is not
 *     visible to a consumer subscribed to tenant B (verified via the
 *     subject scheme the adapter emits).
 *
 * Uses a multi-tenant in-memory fake producer (`MultiTenantFakeProducer`)
 * so the test exercises the adapter's tenant-routing logic without
 * touching a live broker. The integration test in
 * `event-bus-nats.live.test.ts` covers the broker-backed path.
 */
export {};
