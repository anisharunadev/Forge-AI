/**
 * Cron descriptor smoke — FORA-545 AC #4 + #5.
 *
 * The ACs call for daily orphan detection and a 90-day
 * re-attestation job. The sweepers themselves are unit-
 * tested in `./override.test.ts`; this file proves the
 * cron registration contract (schedule, command,
 * audit_event_type, idempotency) so the orchestrator /
 * k8s CronJob installer can wire them up without parsing
 * shell strings.
 *
 * No DB. Pure-function test on `registerConnectorCrons`.
 */

import { describe, it, expect } from 'vitest';
import { registerConnectorCrons } from '../src/cron.js';

const FROZEN_NOW = () => new Date('2026-06-20T00:00:00.000Z');

function getDescriptor(name: string) {
  const descriptors = registerConnectorCrons(FROZEN_NOW);
  const found = descriptors.find((d) => d.name === name);
  if (!found) {
    throw new Error(`descriptor missing: ${name}`);
  }
  return found;
}

describe('connector-config/cron descriptors (FORA-545)', () => {
  it('registers exactly two cron descriptors', () => {
    const descriptors = registerConnectorCrons(FROZEN_NOW);
    expect(descriptors).toHaveLength(2);
    const names = descriptors.map((d) => d.name).sort();
    expect(names).toEqual([
      'connector-config-attestation-sweep',
      'connector-config-orphan-sweep',
    ]);
  });

  it('orphan sweep runs daily at 03:00 UTC', () => {
    const d = getDescriptor('connector-config-orphan-sweep');
    expect(d.schedule).toBe('0 3 * * *');
    expect(d.audit_event_type).toBe('connector.binding.orphan_risk');
    expect(d.idempotent).toBe(true);
    expect(d.shared_with).toContain('FORA-545');
    expect(d.shared_with).toContain('FORA-391.3');
  });

  it('attestation sweep runs daily at 04:00 UTC', () => {
    const d = getDescriptor('connector-config-attestation-sweep');
    expect(d.schedule).toBe('0 4 * * *');
    expect(d.audit_event_type).toBe('connector.binding.attestation_expired');
    expect(d.idempotent).toBe(true);
    expect(d.shared_with).toContain('FORA-545');
  });

  it('sweep commands point at the @fora/connector-config sweep CLI', () => {
    const orphan = getDescriptor('connector-config-orphan-sweep');
    const attestation = getDescriptor('connector-config-attestation-sweep');
    expect(orphan.command).toEqual([
      'pnpm',
      '--filter',
      '@fora/connector-config',
      'sweep',
      'orphan',
    ]);
    expect(attestation.command).toEqual([
      'pnpm',
      '--filter',
      '@fora/connector-config',
      'sweep',
      'attestation',
    ]);
  });

  it('registered_at is stable when now() is frozen', () => {
    const a = registerConnectorCrons(FROZEN_NOW);
    const b = registerConnectorCrons(FROZEN_NOW);
    expect(a[0]?.registered_at).toBe(b[0]?.registered_at);
    expect(a[1]?.registered_at).toBe(b[1]?.registered_at);
  });

  it('registered_at reflects the injected clock', () => {
    const d = getDescriptor('connector-config-orphan-sweep');
    expect(d.registered_at).toBe('2026-06-20T00:00:00.000Z');
  });
});
