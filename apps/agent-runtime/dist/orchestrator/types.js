/**
 * Master Orchestrator — public type contracts.
 *
 * Per FORA-50 spec §2.2 (run lifecycle state machine), §2.3 (seven-stage
 * spine), §4.2 (gRPC seam), and ADR-0007 (gRPC wire format).
 *
 * This module is the **first-pass** CTO implementation per the FORA-135
 * suggested-owner note ("master-orchestrator planned hire or CTO first-pass").
 * The greenfield monorepo split called out in FORA-50 spec §2.0 lands in a
 * follow-up sub-task (see `proto/orchestrator.proto` header); for now the
 * module lives under `apps/agent-runtime/src/orchestrator/` so it can be
 * unit-tested and exercised end-to-end against the existing TS toolchain.
 *
 * Invariants:
 *   - No `any`. All shapes are structural.
 *   - Branded primitives for IDs (RunId, TenantId, EventId) so an EventId
 *     cannot be assigned to a RunId by accident.
 *   - Discriminated unions for Decision / Event / TypedError so the engine
 *     narrows exhaustively.
 */
export const asRunId = (s) => s;
export const asTenantId = (s) => s;
export const asEventId = (s) => s;
export const asActorId = (s) => s;
export const asIdempotencyKey = (s) => s;
//# sourceMappingURL=types.js.map