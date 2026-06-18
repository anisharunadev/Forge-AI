/**
 * Typed errors raised by the event bus.
 *
 * The contract is: a consumer or producer catches the bus-specific errors and
 * reacts; other errors are programmer mistakes (e.g. invalid input) and are
 * left to bubble. Every error here extends Error and carries a stable
 * `code` so cross-service error handling does not depend on message text.
 */
export type EventBusErrorCode = 
/** Raised when a producer publishes to a subject whose tenant prefix does not match the producer's tenant identity. */
'TENANT_MISMATCH'
/** Raised when an envelope or payload fails schema validation. */
 | 'SCHEMA_VALIDATION_FAILED'
/** Raised when a consumer rejects an event because its major schema version is newer than the consumer supports. */
 | 'SCHEMA_VERSION_UNSUPPORTED'
/** Raised when the underlying NATS client returns an error we want to surface. */
 | 'TRANSPORT_ERROR'
/** Raised when dedupe state cannot be persisted or queried. */
 | 'DEDUPE_STORE_ERROR'
/** Raised when the producer/consumer is used after close(). */
 | 'CLOSED'
/** Raised when a required tenant_id, run_id, or other field is empty or malformed. */
 | 'INVALID_INPUT';
export declare class EventBusError extends Error {
    readonly code: EventBusErrorCode;
    readonly cause?: unknown;
    constructor(code: EventBusErrorCode, message: string, cause?: unknown);
}
export declare class TenantMismatchError extends EventBusError {
    readonly expectedTenantId: string;
    readonly actualTenantId: string;
    readonly subject: string;
    constructor(expectedTenantId: string, actualTenantId: string, subject: string);
}
export declare class SchemaValidationError extends EventBusError {
    readonly eventType: string;
    readonly issues: ReadonlyArray<{
        path: string;
        message: string;
    }>;
    constructor(eventType: string, issues: ReadonlyArray<{
        path: string;
        message: string;
    }>);
}
export declare class SchemaVersionUnsupportedError extends EventBusError {
    readonly eventType: string;
    readonly eventMajor: number;
    readonly consumerMaxMajor: number;
    constructor(eventType: string, eventMajor: number, consumerMaxMajor: number);
}
export declare class TransportError extends EventBusError {
    constructor(message: string, cause?: unknown);
}
export declare class InvalidInputError extends EventBusError {
    constructor(message: string);
}
export declare class ClosedError extends EventBusError {
    constructor(what: string);
}
