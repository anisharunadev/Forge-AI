/**
 * Typed ports for the gate router.
 *
 * The router depends only on these interfaces; concrete adapters
 * (Postgres, NATS, PagerDuty, Paperclip HTTP) live in the rest of
 * the package or in a follow-up sub-task. Tests inject in-memory
 * implementations (test-doubles.ts) so the algorithm is testable
 * without a live Postgres or Paperclip server.
 *
 * Per architecture.md §2.1 the Orchestrator is the only writer of run
 * state. The ports encode that contract: every state change goes
 * through `approvalsRepo` and every external side effect through the
 * other ports.
 */
/**
 * Raised by `ApprovalsRepo.applyDecision` when the row is already
 * terminal (already approved / rejected / expired). The HTTP layer
 * maps this to a 409 with code `INVALID_TRANSITION` per the spec
 * §4.1 error envelope. (The decide endpoint is idempotent on retry
 * of the SAME decision; this error fires only when the second
 * decision disagrees with the first.)
 */
export class ApprovalAlreadyDecidedError extends Error {
    typed;
    constructor(typed) {
        super(typed.message);
        this.typed = typed;
        this.name = 'ApprovalAlreadyDecidedError';
    }
}
//# sourceMappingURL=ports.js.map