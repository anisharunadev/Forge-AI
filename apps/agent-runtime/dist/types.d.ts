/**
 * v0 FORA Agent Runtime — type contracts.
 *
 * Mirrors design doc §3. Every type in this file is the public surface that
 * sub-agents, planners, reflectors, and the run record writer agree on.
 * The CTO signs the design doc; this file is the validator.
 *
 * Invariants:
 *   - No `any`. All shapes are structural.
 *   - IDs are branded strings so a ToolName cannot be assigned to a RunId
 *     by accident.
 *   - TypedError is a discriminated union; the stage machine and run
 *     record writer both pattern-match on `code` to decide recovery.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & {
    readonly [brand]: B;
};
/** Opaque, comparable identifiers. */
export type RunId = Brand<string, 'RunId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type ToolName = Brand<string, 'ToolName'>;
export type StepId = Brand<string, 'StepId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;
/** Cast helpers for boundaries that mint IDs (e.g., test fixtures, sink). */
export declare const asRunId: (s: string) => RunId;
export declare const asAgentId: (s: string) => AgentId;
export declare const asToolName: (s: string) => ToolName;
export declare const asStepId: (s: string) => StepId;
export declare const asIdempotencyKey: (s: string) => IdempotencyKey;
/** Stages the stage machine walks through. */
export type Stage = 'plan' | 'act' | 'observe' | 'reflect';
/** A side-effect tag on a tool handler — drives the boot-time validator. */
export type SideEffect = 'none' | 'read' | 'write';
/**
 * Per-stage tool allow-list and budget hints. The allow-list is the only
 * path from sub-agent intent to handler invocation (§5).
 */
export interface StagePolicy {
    plan: {
        allowedTools: ReadonlySet<ToolName>;
    };
    act: {
        allowedTools: ReadonlySet<ToolName>;
    };
    observe: {
        allowedTools: ReadonlySet<ToolName>;
    };
    reflect: {
        allowedTools: ReadonlySet<ToolName>;
    };
}
/** Optional per-step idempotency key — the planner can mint one. */
export interface StepCost {
    /** Optional ceiling override for the planner's pre-stage budget check. */
    tokens?: number;
    usd?: number;
}
/** Inputs to a `Runtime.invoke` call. */
export interface RunInputs {
    /** Natural-language intent the planner turns into a `Plan`. */
    intent: string;
    /** Per-run context, free-form, opaque to the runtime. */
    context: Record<string, unknown>;
    /** Tenant ID for cross-cutting attribution. */
    tenantId: string;
    /** Caller-supplied trace id (e.g. Paperclip `trace_id`). */
    traceId: string;
    /**
     * Optional: a maximum number of `replan` cycles before the run is
     * aborted. Default is 3 if omitted.
     */
    maxReplans?: number;
    /**
     * Optional budget ceilings. Any axis that is omitted is uncapped.
     * Pre-stage checks throw `BudgetExceeded` on the first violation.
     */
    budget?: {
        tokenCeiling?: number;
        usdCeiling?: number;
        wallClockCeilingMs?: number;
    };
}
/** A single plan step emitted by the planner. */
export interface PlanStep {
    stepId: StepId;
    tool: ToolName;
    /** Structured, JSON-serializable input. Validated by the handler. */
    input: unknown;
    /**
     * The handler that will be invoked. The runtime resolves the concrete
     * function from the registered handler map.
     */
    handlerId: string;
    /**
     * Per-step idempotency key. The runtime will dedupe retries and replays
     * against this key. Handlers registered with `sideEffect: 'write'` MUST
     * have a non-empty key (validator enforces for the *handler*; the
     * *step* may override per-call).
     */
    idempotencyKey?: IdempotencyKey;
}
/** A plan is an ordered list of steps, plus optional replan hints. */
export interface Plan {
    planId: string;
    steps: PlanStep[];
    /** If set, the runtime re-enters `plan` after `reflect` instead of finishing. */
    replanOnFailure?: boolean;
    /** Human-readable intent the planner is addressing. */
    intent: string;
    /**
     * Token/USD usage the planner consumed to emit this plan. Recorded by
     * the budget meter at the planner LLM site.
     */
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        tokens?: number;
        usd?: number;
    };
}
/** The tool handler function shape. */
export type ToolHandler<TIn = unknown, TOut = unknown> = (input: TIn, ctx: ToolCtx) => Promise<TOut> | TOut;
/** Per-invocation context exposed to a tool handler. */
export interface ToolCtx {
    runId: RunId;
    agentId: AgentId;
    stage: Stage;
    stepId: StepId;
    traceId: string;
    tenantId: string;
    /** Abort signal — fired when the run is cancelled. */
    signal: AbortSignal | undefined;
}
/** What `act` produced. Drives `observe` and the run record. */
export interface Observation {
    stepId: StepId;
    tool: ToolName;
    output: unknown;
    /** True if the handler threw. The output, if any, is in `errorOutput`. */
    ok: boolean;
    errorOutput?: unknown;
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
    /** Idempotency key that was used, if any. */
    idempotencyKey?: IdempotencyKey;
    /**
     * If the output was a `ToolResult`, the runtime extracts the cost hint
     * and records it in the budget meter at the tool-handler site.
     */
    costHint?: {
        tokens?: number;
        usd?: number;
    };
    /**
     * Set when the idempotency store returned a cached result for this
     * step, instead of the handler running. The dedupe hit is recorded in
     * the run record as `IdempotencyHit`.
     */
    idempotencyHit?: {
        key: IdempotencyKey;
        storedAt: string;
    };
}
/** Optional structured return type — handlers may return a `ToolResult` shape. */
export interface ToolResult<T = unknown> {
    output: T;
    costHint?: {
        tokens?: number;
        usd?: number;
    };
}
/** Type guard for the optional `ToolResult` shape. */
export declare function asToolResult<T>(v: unknown): ToolResult<T> | null;
/** What `reflect` decides. Drives the next iteration or `finish`. */
export interface Reflection {
    /** Plan to run next. If set, the runtime re-enters `plan` with this. */
    nextPlan?: Plan;
    /** Free-form note from the reflector (recorded in the run record). */
    note: string;
    /** True if the run is done and should be finalized. */
    done: boolean;
    /**
     * Token/USD usage the reflector consumed. Recorded by the budget meter
     * at the reflector LLM site.
     */
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        tokens?: number;
        usd?: number;
    };
}
/** A registered sub-agent definition. */
export interface SubAgentDefinition {
    agentId: AgentId;
    /** Per-stage allow-lists and budget hints. */
    stagePolicy: StagePolicy;
    /** All tool handlers this agent owns, keyed by `handlerId`. */
    handlers: ReadonlyMap<string, RegisteredHandler>;
    /** A planner: inputs → plan. */
    plan: (inputs: RunInputs) => Promise<Plan>;
    /** A reflector: observations + plan → reflection. */
    reflect: (args: {
        plan: Plan;
        observations: Observation[];
    }) => Promise<Reflection>;
}
/** A handler plus the metadata the boot-time validator checks. */
export interface RegisteredHandler {
    handlerId: string;
    toolName: ToolName;
    /** Side-effect tag. `write` handlers MUST have an `idempotencyKey`. */
    sideEffect: SideEffect;
    /** Required for `sideEffect: 'write'`. Boot-time validator enforces. */
    idempotencyKey?: IdempotencyKey;
    /** Per-handler retry policy; defaults to no retry. */
    retry?: {
        maxAttempts: number;
        backoff: {
            base: number;
            factor: number;
            max: number;
            fullJitter: boolean;
        };
    };
    /** The callable. Typed as `unknown` to avoid an import cycle. */
    invoke: ToolHandler;
}
/** Finalized run record — written to `workspace/runs/{runId}.json`. */
export interface RunRecord {
    runId: RunId;
    agentId: AgentId;
    tenantId: string;
    traceId: string;
    startedAt: string;
    finishedAt: string;
    /**
     * Terminal status. `succeeded` / `failed` / `aborted` cover the
     * normal control-flow paths; `budget_exceeded` and `cancelled` are
     * added in 0.2.3 for the budget meter and cancellation token.
     */
    status: 'succeeded' | 'failed' | 'aborted' | 'budget_exceeded' | 'cancelled';
    steps: RunRecordStep[];
    /** Replan cycle counter, ≥ 0. */
    replanCycles: number;
    /** Captured typed errors, in order. Empty on success. */
    errors: TypedError[];
    /** Final reflection, if the run reached it. */
    finalReflection?: Reflection;
    /**
     * Final budget snapshot, if a budget was supplied. Recorded on every
     * termination path.
     */
    budget?: {
        ceiling: {
            tokenCeiling?: number;
            usdCeiling?: number;
            wallClockCeilingMs?: number;
        };
        spent: {
            tokens: number;
            usd: number;
            wallClockMs: number;
        };
    };
}
export interface RunRecordStep {
    stepId: StepId;
    planId: string;
    tool: ToolName;
    handlerId: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    ok: boolean;
    output?: unknown;
    errorOutput?: unknown;
    /** Idempotency key that was used, if any. */
    idempotencyKey?: IdempotencyKey;
    /**
     * True when the runtime short-circuited the handler call and replayed
     * a cached result. The dedupe hit is also surfaced in the live stream
     * as `IdempotencyHit`.
     */
    idempotencyHit?: {
        key: IdempotencyKey;
        storedAt: string;
    };
    /** Stage this step ran in (always `'act'` for v0). */
    stage: 'act';
}
/**
 * Cancellation token. Exposed on `ToolCtx` for handlers that want to
 * short-circuit internal awaits. v0 stubs the signal to `undefined`;
 * 0.2.3 wires the real `AbortController`.
 */
export interface CancelToken {
    readonly isCancelled: boolean;
    readonly whenCancelled: Promise<{
        reason: string;
    }>;
    readonly reason: string | undefined;
}
/**
 * Typed errors. Codes are stable; messages are not. The run record writer
 * pattern-matches on `code` to decide what to record and how to surface.
 */
export type TypedError = {
    code: 'NotAllowed';
    message: string;
    tool: ToolName;
    stage: Stage;
    runId: RunId;
} | {
    code: 'IdempotencyMissing';
    message: string;
    handlerId: string;
    runId: RunId;
} | {
    code: 'HandlerThrew';
    message: string;
    handlerId: string;
    runId: RunId;
    cause: string;
} | {
    code: 'AbortRequested';
    message: string;
    runId: RunId;
} | {
    code: 'ReplanBudgetExhausted';
    message: string;
    runId: RunId;
    maxReplans: number;
} | {
    code: 'UnknownAgent';
    message: string;
    agentId: AgentId;
} | {
    code: 'AgentAlreadyRegistered';
    message: string;
    agentId: AgentId;
} | {
    code: 'BudgetExceeded';
    message: string;
    runId: RunId;
    stage: Stage;
    ceiling: {
        tokenCeiling?: number;
        usdCeiling?: number;
        wallClockCeilingMs?: number;
    };
    spent: {
        tokens: number;
        usd: number;
        wallClockMs: number;
    };
} | {
    code: 'Cancelled';
    message: string;
    runId: RunId;
    reason: string;
};
/** Helper: build a typed error. */
export declare function makeError<E extends TypedError>(e: E): E;
export {};
