/**
 * Ports — the interfaces the orchestrator depends on.
 *
 * Per ADR-0001 §2.3 and FORA-50 spec §7, the Master Orchestrator is the only
 * component that talks to the Agent Runtime, Memory, Cost, and Audit
 * directly. This module is the typed seam; concrete implementations live
 * in their respective sub-goals (FORA-30, FORA-32, FORA-36, FORA-75) and
 * are wired by the runtime factory.
 *
 * Everything here is a pure interface. The first-pass CTO module ships
 * in-memory implementations (./memory-store.ts, ./memory-bus.ts) so the
 * engine is unit-testable end-to-end without standing up the full NATS
 * stack; production wires the real EventBus + RunStore once the DB
 * migrations land in FORA-30 / FORA-32.
 */
export {};
//# sourceMappingURL=ports.js.map