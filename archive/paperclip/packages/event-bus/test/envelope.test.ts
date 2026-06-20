/**
 * @fora/event-bus — envelope schema + version helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  parseSemver,
  isVersionSupported,
  EventEnvelopeSchema,
  parseEnvelope,
  SchemaVersionSchema,
} from '../src/index.js';

describe('envelope', () => {
  describe('SchemaVersionSchema', () => {
    it('accepts valid semver', () => {
      expect(SchemaVersionSchema.parse('1.0.0')).toBe('1.0.0');
      expect(SchemaVersionSchema.parse('2.10.3')).toBe('2.10.3');
    });
    it('rejects non-semver', () => {
      expect(() => SchemaVersionSchema.parse('1.0')).toThrow();
      expect(() => SchemaVersionSchema.parse('v1')).toThrow();
      expect(() => SchemaVersionSchema.parse('')).toThrow();
    });
  });

  describe('parseSemver', () => {
    it('extracts major/minor/patch', () => {
      expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });
    it('throws on malformed input', () => {
      expect(() => parseSemver('1.2')).toThrow();
    });
  });

  describe('isVersionSupported', () => {
    it('supports events at or below the consumer max major', () => {
      expect(isVersionSupported('1.0.0', 1)).toBe(true);
      expect(isVersionSupported('1.99.99', 1)).toBe(true);
      expect(isVersionSupported('2.0.0', 1)).toBe(false);
      expect(isVersionSupported('2.0.0', 2)).toBe(true);
    });
  });

  describe('EventEnvelopeSchema', () => {
    const valid = {
      v: '1.0.0',
      event_id: 'evt-123',
      run_id: 'run-456',
      tenant_id: 'tnt_acme',
      stage: 'dev',
      event_type: 'stage_started',
      occurred_at: '2026-06-17T12:34:56.789Z',
      actor: { type: 'agent', id: 'orchestrator' },
      payload: { run_id: 'run-456', stage: 'dev', owner: 'cto', started_at: '2026-06-17T12:34:56.789Z' },
    };
    it('accepts a valid envelope', () => {
      expect(EventEnvelopeSchema.parse(valid).event_id).toBe('evt-123');
    });
    it('rejects missing event_id', () => {
      const bad = { ...valid, event_id: '' };
      expect(() => EventEnvelopeSchema.parse(bad)).toThrow();
    });
    it('rejects unknown stage values', () => {
      const bad = { ...valid, stage: 'review' };
      expect(() => EventEnvelopeSchema.parse(bad)).toThrow();
    });
    it('allows null stage for run-level events', () => {
      const ok = { ...valid, stage: null };
      expect(EventEnvelopeSchema.parse(ok).stage).toBeNull();
    });
  });

  describe('parseEnvelope', () => {
    it('parses a wire-format JSON object', () => {
      const raw = JSON.stringify({
        v: '1.0.0',
        event_id: 'evt-1',
        run_id: 'run-1',
        tenant_id: 'tnt',
        stage: null,
        event_type: 'run_created',
        occurred_at: '2026-06-17T00:00:00.000Z',
        actor: { type: 'system', id: 'test' },
        payload: { run_id: 'run-1', tenant_id: 'tnt', goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
      });
      const parsed = parseEnvelope(JSON.parse(raw));
      expect(parsed.event_type).toBe('run_created');
    });
  });
});
