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
  | 'TENANT_MISMATCH'
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

export class EventBusError extends Error {
  public readonly code: EventBusErrorCode;
  public readonly cause?: unknown;

  constructor(code: EventBusErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'EventBusError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class TenantMismatchError extends EventBusError {
  constructor(
    public readonly expectedTenantId: string,
    public readonly actualTenantId: string,
    public readonly subject: string,
  ) {
    super(
      'TENANT_MISMATCH',
      `Subject "${subject}" does not match producer tenant_id "${expectedTenantId}" (got "${actualTenantId}")`,
    );
    this.name = 'TenantMismatchError';
  }
}

export class SchemaValidationError extends EventBusError {
  constructor(
    public readonly eventType: string,
    public readonly issues: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(
      'SCHEMA_VALIDATION_FAILED',
      `Event "${eventType}" failed schema validation: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
    this.name = 'SchemaValidationError';
  }
}

export class SchemaVersionUnsupportedError extends EventBusError {
  constructor(
    public readonly eventType: string,
    public readonly eventMajor: number,
    public readonly consumerMaxMajor: number,
  ) {
    super(
      'SCHEMA_VERSION_UNSUPPORTED',
      `Event "${eventType}" is at major v${eventMajor}; consumer supports up to v${consumerMaxMajor}`,
    );
    this.name = 'SchemaVersionUnsupportedError';
  }
}

export class TransportError extends EventBusError {
  constructor(message: string, cause?: unknown) {
    super('TRANSPORT_ERROR', message, cause);
    this.name = 'TransportError';
  }
}

export class InvalidInputError extends EventBusError {
  constructor(message: string) {
    super('INVALID_INPUT', message);
    this.name = 'InvalidInputError';
  }
}

export class ClosedError extends EventBusError {
  constructor(what: string) {
    super('CLOSED', `${what} is closed`);
    this.name = 'ClosedError';
  }
}
