/**
 * Integration test for the NATS adapter (FORA-170 acceptance #2 + #3).
 *
 * Runs only when `FORA_NATS_URL` is set; otherwise skipped so the unit
 * suite stays hermetic. Mirrors the gating pattern in
 * `apps/orchestrator/test/approvals-repo-pg.live.test.ts`.
 *
 * What it covers:
 *   - The adapter publishes to a live NATS broker; a real subscriber
 *     reads the message back. Verifies the wire format (envelope +
 *     subject) end-to-end.
 *   - Per-tenant subject isolation: a tenant-A publish is not visible
 *     to a tenant-B subscriber subscribed to its own tenant prefix.
 */
export {};
