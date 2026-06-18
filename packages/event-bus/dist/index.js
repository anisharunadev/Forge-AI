/**
 * @fora/event-bus — public surface.
 *
 * Exports:
 *   - 19 typed event payloads, the `EventType` union, and `EVENT_SCHEMAS`
 *   - Envelope parsing + version helpers
 *   - Subject construction + tenant-isolation guard
 *   - Producer / consumer interfaces + NATS-backed implementations
 *   - Dedupe store + token-bucket rate limiter (consumer-side)
 *   - Replay contract (re-publish from `agent_run_events`)
 *   - (state-change → event_type) mapping for the Orchestrator
 *
 * See ADR-0006 + FORA-50 spec §5 for the bus substrate; this module is the
 * concrete v1.
 */
export { SchemaVersionSchema, ActorSchema, EventEnvelopeSchema, parseSemver, isVersionSupported, } from './envelope.js';
export { buildSubject, parseSubject, assertSubjectTenant, tenantSubjectPrefix, isValidTenantId, isValidEventType, } from './subject.js';
export { ALL_EVENT_TYPES, EVENT_SCHEMAS, CURRENT_EVENT_MAJOR, CURRENT_EVENT_VERSION, buildEnvelope, parseEnvelope, RunCreatedPayload, RunStartedPayload, StageStartedPayload, StageCompletedPayload, StageApprovedPayload, StageRejectedPayload, StageReturnedPayload, ApprovalRequestedPayload, ApprovalDecidedPayload, ApprovalExpiredPayload, GatePassedPayload, CostReportedPayload, BudgetExceededPayload, RunAbortedPayload, RunPausedPayload, RunResumedPayload, RunFinishedPayload, ErrorPayload, InvalidTransitionPayload, } from './events.js';
export { STATE_CHANGE_TO_EVENT, EVENT_TO_STATE_CHANGE, assertExhaustiveCoverage, eventTypeFor, } from './state-changes.js';
export { NatsEventProducer, InMemoryEventProducer, subjectMajorFromEnvelope, } from './producer.js';
export { NatsEventConsumer, InMemoryDedupeStore, TokenBucketRateLimiter, consumerSubjectFor, processOneEvent, } from './consumer.js';
export { replayRun, subjectForRow, } from './replay.js';
export { EventBusError, TenantMismatchError, SchemaValidationError, SchemaVersionUnsupportedError, TransportError, InvalidInputError, ClosedError, } from './errors.js';
//# sourceMappingURL=index.js.map