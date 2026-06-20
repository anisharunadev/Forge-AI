/**
 * @fora/mcp-breaker — public API
 *
 * Implements FORA-48 §3.3 (Epic 0.3.3 router sub-goal) per ADR-0013.
 *
 * Public surface:
 *   - McpCircuitBreaker              — the orchestrator (router calls these 3)
 *   - InMemoryBreakerStore           — dev/test persistence
 *   - CacheBrokerBreakerStore        — production persistence (via @fora/cache-broker)
 *   - InMemoryBreakerEventSink       — test/dev event sink
 *   - NoopBreakerEventSink           — opt-out event sink
 *   - BreakerStore, BreakerEventSink — interfaces for custom adapters
 *   - BreakerEvent, BreakerSnapshot  — observable types
 *   - BreakerPolicy, DEFAULT_POLICY  — knob set
 *   - CircuitOpenError               — typed error
 *   - inMemoryBreaker()              — convenience factory for tests + smoke
 *
 * Usage (router):
 *
 *   import { McpCircuitBreaker, CacheBrokerBreakerStore, CircuitOpenError } from '@fora/mcp-breaker';
 *
 *   const breaker = new McpCircuitBreaker({
 *     store: new CacheBrokerBreakerStore({ broker }),
 *     events: myEventBusSink,
 *   });
 *
 *   try {
 *     await breaker.beforeCall(ctx, { tenant_id, server_name: 'jira' });
 *     const result = await jiraTool.invoke(args);
 *     await breaker.recordSuccess(ctx, { tenant_id, server_name: 'jira' });
 *     return result;
 *   } catch (err) {
 *     if (!(err instanceof CircuitOpenError)) {
 *       await breaker.recordFailure(ctx, { tenant_id, server_name: 'jira' });
 *     }
 *     throw err;
 *   }
 */

export {
  type BreakerCallResult,
  type BreakerDecision,
  type BreakerPolicy,
  type BreakerSnapshot,
  type BreakerState,
  type CallOutcome,
  CircuitOpenError,
  DEFAULT_POLICY,
} from './types.js';

export {
  apply,
  decide,
  emptySnapshot,
  errorRate,
} from './state.js';

export {
  type BreakerEvent,
  type BreakerEventSink,
  type BreakerEventType,
  type TripReason,
  InMemoryBreakerEventSink,
  NoopBreakerEventSink,
  makeEvent,
} from './events.js';

export {
  type BreakerKey,
  type BreakerStore,
  type CacheBrokerBreakerStoreOptions,
  type McpCircuitBreakerOptions,
  CacheBrokerBreakerStore,
  InMemoryBreakerStore,
  McpCircuitBreaker,
  inMemoryBreaker,
} from './breaker.js';