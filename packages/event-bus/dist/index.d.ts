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
export { SchemaVersionSchema, ActorSchema, EventEnvelopeSchema, parseSemver, isVersionSupported, type SchemaVersion, type Stage, type Actor, type EventEnvelope, type ParsedSemver, } from './envelope.js';
export { buildSubject, parseSubject, assertSubjectTenant, tenantSubjectPrefix, isValidTenantId, isValidEventType, } from './subject.js';
export { ALL_EVENT_TYPES, EVENT_SCHEMAS, CURRENT_EVENT_MAJOR, CURRENT_EVENT_VERSION, buildEnvelope, parseEnvelope, RunCreatedPayload, RunStartedPayload, StageStartedPayload, StageCompletedPayload, StageApprovedPayload, StageRejectedPayload, StageReturnedPayload, ApprovalRequestedPayload, ApprovalDecidedPayload, ApprovalExpiredPayload, GatePassedPayload, CostReportedPayload, BudgetExceededPayload, RunAbortedPayload, RunPausedPayload, RunResumedPayload, RunFinishedPayload, ErrorPayload, InvalidTransitionPayload, type EventType, type EventPayload, type TypedEvent, } from './events.js';
export { STATE_CHANGE_TO_EVENT, EVENT_TO_STATE_CHANGE, assertExhaustiveCoverage, eventTypeFor, type StateChangeKind, } from './state-changes.js';
export { NatsEventProducer, InMemoryEventProducer, type EventProducer, type NatsProducerConfig, type PublishOptions, type ProducerMessageHeaders, subjectMajorFromEnvelope, } from './producer.js';
export { NatsEventConsumer, InMemoryDedupeStore, TokenBucketRateLimiter, consumerSubjectFor, processOneEvent, type EventConsumer, type EventHandler, type HandlerRegistry, type NatsConsumerConfig, type ProcessOneEventConfig, type DedupeStore, type RateLimiter, type ProcessOutcome, } from './consumer.js';
export { replayRun, subjectForRow, type ReplaySource, type AgentRunEventRow, type ReplaySummary, } from './replay.js';
export { EventBusError, TenantMismatchError, SchemaValidationError, SchemaVersionUnsupportedError, TransportError, InvalidInputError, ClosedError, type EventBusErrorCode, } from './errors.js';
