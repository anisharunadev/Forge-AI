/**
 * Typed errors raised by the event bus.
 *
 * The contract is: a consumer or producer catches the bus-specific errors and
 * reacts; other errors are programmer mistakes (e.g. invalid input) and are
 * left to bubble. Every error here extends Error and carries a stable
 * `code` so cross-service error handling does not depend on message text.
 */
export class EventBusError extends Error {
    code;
    cause;
    constructor(code, message, cause) {
        super(message);
        this.name = 'EventBusError';
        this.code = code;
        if (cause !== undefined)
            this.cause = cause;
    }
}
export class TenantMismatchError extends EventBusError {
    expectedTenantId;
    actualTenantId;
    subject;
    constructor(expectedTenantId, actualTenantId, subject) {
        super('TENANT_MISMATCH', `Subject "${subject}" does not match producer tenant_id "${expectedTenantId}" (got "${actualTenantId}")`);
        this.expectedTenantId = expectedTenantId;
        this.actualTenantId = actualTenantId;
        this.subject = subject;
        this.name = 'TenantMismatchError';
    }
}
export class SchemaValidationError extends EventBusError {
    eventType;
    issues;
    constructor(eventType, issues) {
        super('SCHEMA_VALIDATION_FAILED', `Event "${eventType}" failed schema validation: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
        this.eventType = eventType;
        this.issues = issues;
        this.name = 'SchemaValidationError';
    }
}
export class SchemaVersionUnsupportedError extends EventBusError {
    eventType;
    eventMajor;
    consumerMaxMajor;
    constructor(eventType, eventMajor, consumerMaxMajor) {
        super('SCHEMA_VERSION_UNSUPPORTED', `Event "${eventType}" is at major v${eventMajor}; consumer supports up to v${consumerMaxMajor}`);
        this.eventType = eventType;
        this.eventMajor = eventMajor;
        this.consumerMaxMajor = consumerMaxMajor;
        this.name = 'SchemaVersionUnsupportedError';
    }
}
export class TransportError extends EventBusError {
    constructor(message, cause) {
        super('TRANSPORT_ERROR', message, cause);
        this.name = 'TransportError';
    }
}
export class InvalidInputError extends EventBusError {
    constructor(message) {
        super('INVALID_INPUT', message);
        this.name = 'InvalidInputError';
    }
}
export class ClosedError extends EventBusError {
    constructor(what) {
        super('CLOSED', `${what} is closed`);
        this.name = 'ClosedError';
    }
}
//# sourceMappingURL=errors.js.map