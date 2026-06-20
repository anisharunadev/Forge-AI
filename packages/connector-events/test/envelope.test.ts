/**
 * Envelope schema tests — FORA-484 AC #1.
 *
 * Validate the universal envelope shape, the regex constraints on
 * digests / event_id / event_hash, and the discriminated-union on
 * event_type (family verbs vs lifecycle verbs).
 */

import { describe, it, expect } from 'vitest';
import {
  ConnectorEventSchema,
  parseConnectorEvent,
  safeParseConnectorEvent,
  CONNECTOR_EVENT_SCHEMA_VERSION,
} from '../src/envelope.js';

const goodEvent = {
  event_id: 'evt-deadbeefcafef00d',
  event_type: 'jira.issue.observed',
  schema_version: CONNECTOR_EVENT_SCHEMA_VERSION,
  occurred_at: '2026-06-20T12:34:56.789Z',
  tenant_id: 'tnt_8XQ',
  project_id: 'prj_FORA',
  connector_id: 'jira',
  binding_id: 'bind_42',
  actor: { type: 'agent' as const, id: 'agent:developer', role: 'developer' },
  outcome: 'success' as const,
  reason_code: '',
  latency_ms: 42,
  request: { op: 'issue.get', args_hash: 'a'.repeat(64) },
  response: { status: 200, body_hash: 'b'.repeat(64), size: 1024 },
  artifacts_emitted: [],
  audit_chain: {
    prev_event_hash: 'c'.repeat(64),
    event_hash: 'd'.repeat(64),
  },
};

describe('envelope schema', () => {
  it('parses a well-formed event', () => {
    const parsed = ConnectorEventSchema.parse(goodEvent);
    expect(parsed.event_type).toBe('jira.issue.observed');
    expect(parsed.schema_version).toBe(CONNECTOR_EVENT_SCHEMA_VERSION);
  });

  it('rejects bad event_id', () => {
    const bad = { ...goodEvent, event_id: 'not-evt' };
    const r = safeParseConnectorEvent(bad);
    expect(r.success).toBe(false);
  });

  it('rejects non-hex args_hash', () => {
    const bad = { ...goodEvent, request: { op: 'x', args_hash: 'not-hex' } };
    const r = safeParseConnectorEvent(bad);
    expect(r.success).toBe(false);
  });

  it('accepts lifecycle verbs', () => {
    const lc = { ...goodEvent, event_type: 'connector.circuit.opened' };
    const r = safeParseConnectorEvent(lc);
    expect(r.success).toBe(true);
  });

  it('rejects unknown event_type', () => {
    const bad = { ...goodEvent, event_type: 'unknown.thing' };
    const r = safeParseConnectorEvent(bad);
    expect(r.success).toBe(false);
  });

  it('accepts a response of null', () => {
    const e = { ...goodEvent, response: null };
    const r = safeParseConnectorEvent(e);
    expect(r.success).toBe(true);
  });

  it('round-trips through JSON', () => {
    const json = JSON.stringify(goodEvent);
    const parsed = parseConnectorEvent(json);
    expect(parsed.event_id).toBe(goodEvent.event_id);
  });
});