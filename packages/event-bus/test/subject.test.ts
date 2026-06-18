/**
 * @fora/event-bus — subject construction + tenant-isolation guard.
 *
 * Covers FORA-136 acceptance #5 (per-tenant subject isolation): a tenant-A
 * consumer cannot read tenant-B events.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSubject,
  parseSubject,
  assertSubjectTenant,
  tenantSubjectPrefix,
  isValidTenantId,
  isValidEventType,
  TenantMismatchError,
  InvalidInputError,
} from '../src/index.js';

describe('subject', () => {
  describe('buildSubject', () => {
    it('builds the canonical fora.events.<tenant>.<event>.v<major>', () => {
      expect(
        buildSubject({ tenantId: 'tnt_acme', eventType: 'run_created', major: 1 }),
      ).toBe('fora.events.tnt_acme.run_created.v1');
    });

    it('builds v2 subjects for breaking-change bumps', () => {
      expect(
        buildSubject({ tenantId: 'tnt_acme', eventType: 'run_created', major: 2 }),
      ).toBe('fora.events.tnt_acme.run_created.v2');
    });

    it('rejects malformed tenant ids', () => {
      expect(() => buildSubject({ tenantId: '', eventType: 'run_created', major: 1 })).toThrow(
        InvalidInputError,
      );
      expect(() =>
        buildSubject({ tenantId: 'tnt acme', eventType: 'run_created', major: 1 }),
      ).toThrow(InvalidInputError);
    });

    it('rejects malformed event types', () => {
      expect(() =>
        buildSubject({ tenantId: 'tnt_acme', eventType: 'RunCreated', major: 1 }),
      ).toThrow(InvalidInputError);
      expect(() => buildSubject({ tenantId: 'tnt_acme', eventType: '', major: 1 })).toThrow(
        InvalidInputError,
      );
    });

    it('rejects non-positive majors', () => {
      expect(() =>
        buildSubject({ tenantId: 'tnt_acme', eventType: 'run_created', major: 0 }),
      ).toThrow(InvalidInputError);
    });
  });

  describe('parseSubject', () => {
    it('round-trips a built subject', () => {
      const subj = buildSubject({ tenantId: 'tnt_acme', eventType: 'stage_completed', major: 1 });
      expect(parseSubject(subj)).toEqual({ tenantId: 'tnt_acme', eventType: 'stage_completed', major: 1 });
    });

    it('returns null on malformed input', () => {
      expect(parseSubject('not.a.subject')).toBeNull();
      expect(parseSubject('fora.events.tnt_acme')).toBeNull();
    });
  });

  describe('assertSubjectTenant — the producer guard', () => {
    it('passes when subject tenant matches the producer identity', () => {
      const subj = buildSubject({ tenantId: 'tnt_acme', eventType: 'run_created', major: 1 });
      expect(() => assertSubjectTenant(subj, 'tnt_acme')).not.toThrow();
    });

    it('throws TenantMismatchError when tenant does not match', () => {
      // Producer for tenant A publishes a subject for tenant B — refused.
      const subj = buildSubject({ tenantId: 'tnt_B', eventType: 'run_created', major: 1 });
      try {
        assertSubjectTenant(subj, 'tnt_A');
        throw new Error('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(TenantMismatchError);
        const err = e as TenantMismatchError;
        expect(err.code).toBe('TENANT_MISMATCH');
        expect(err.expectedTenantId).toBe('tnt_A');
        expect(err.actualTenantId).toBe('tnt_B');
        expect(err.subject).toBe(subj);
      }
    });

    it('throws on a malformed subject', () => {
      expect(() => assertSubjectTenant('not.a.subject', 'tnt_A')).toThrow(InvalidInputError);
    });
  });

  describe('tenantSubjectPrefix', () => {
    it('returns the per-tenant glob a consumer subscribes to', () => {
      expect(tenantSubjectPrefix('tnt_acme')).toBe('fora.events.tnt_acme.>');
    });
  });

  describe('validators', () => {
    it('accepts tenant ids in [a-zA-Z0-9_-]{1,64}', () => {
      expect(isValidTenantId('tnt_acme-corp')).toBe(true);
      expect(isValidTenantId('TNT_123')).toBe(true);
      expect(isValidTenantId('')).toBe(false);
      expect(isValidTenantId('tnt acme')).toBe(false);
      expect(isValidTenantId('a'.repeat(65))).toBe(false);
    });
    it('accepts snake_case event types of length 1..64', () => {
      expect(isValidEventType('run_created')).toBe(true);
      expect(isValidEventType('a')).toBe(true);
      expect(isValidEventType('RunCreated')).toBe(false);
      expect(isValidEventType('')).toBe(false);
      expect(isValidEventType('a'.repeat(65))).toBe(false);
    });
  });
});
