/**
 * Typed-artifact rule engine + RBAC tests — FORA-484 AC #4.
 */

import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_RULES,
  ARTIFACT_TYPES,
  ARTIFACT_ROLE_REGISTRY,
  RbacDeniedError,
  artifactsFor,
  assertRoleMayEmit,
  buildArtifactAuditEvent,
  mayEmit,
  resolveArtifacts,
  rulesForArtifactType,
  rulesForEventType,
} from '../src/registry.js';
import type { ConnectorEvent } from '../src/envelope.js';

describe('ARTIFACT_RULES catalog', () => {
  it('covers all seven artifact types', () => {
    const types = new Set(ARTIFACT_RULES.map((r) => r.artifact_type));
    expect(types.size).toBe(ARTIFACT_TYPES.length);
    for (const t of ARTIFACT_TYPES) expect(types.has(t)).toBe(true);
  });

  it('every rule has at least one trigger event_type', () => {
    for (const r of ARTIFACT_RULES) {
      expect(r.trigger_event_types.length).toBeGreaterThan(0);
      expect(r.allowed_roles.length).toBeGreaterThan(0);
    }
  });
});

describe('rulesForEventType', () => {
  it('jira.issue.ingested → requirement', () => {
    const rules = rulesForEventType('jira.issue.ingested');
    expect(rules.map((r) => r.artifact_type)).toContain('requirement');
  });

  it('github.pr.merged → code_patch AND task_breakdown', () => {
    const rules = rulesForEventType('github.pr.merged');
    const types = rules.map((r) => r.artifact_type);
    expect(types).toContain('code_patch');
    expect(types).toContain('task_breakdown');
  });

  it('confluence.page.published → adr AND deployment_plan', () => {
    const rules = rulesForEventType('confluence.page.published');
    const types = rules.map((r) => r.artifact_type);
    expect(types).toContain('adr');
    expect(types).toContain('deployment_plan');
  });

  it('teams.transcript.received → requirement (MVP-1 path)', () => {
    const rules = rulesForEventType('teams.transcript.received');
    expect(rules.map((r) => r.artifact_type)).toContain('requirement');
  });

  it('unknown event_type → empty list', () => {
    expect(rulesForEventType('not.a.real.event')).toHaveLength(0);
  });
});

describe('rulesForArtifactType', () => {
  it('adr triggers only on confluence.page.published', () => {
    const rules = rulesForArtifactType('adr');
    expect(rules.every((r) => r.trigger_event_types.includes('confluence.page.published'))).toBe(true);
  });
});

describe('RBAC', () => {
  it('architect may emit adr', () => {
    expect(mayEmit('adr', 'architect')).toBe(true);
  });

  it('developer may NOT emit adr', () => {
    expect(mayEmit('adr', 'developer')).toBe(false);
  });

  it('developer may emit code_patch', () => {
    expect(mayEmit('code_patch', 'developer')).toBe(true);
  });

  it('qa may emit security_report', () => {
    expect(mayEmit('security_report', 'qa')).toBe(true);
  });

  it('unknown role → false (default-deny)', () => {
    expect(mayEmit('code_patch', 'unknown-role')).toBe(false);
  });

  it('assertRoleMayEmit throws on deny', () => {
    expect(() => assertRoleMayEmit('adr', 'developer')).toThrow(RbacDeniedError);
  });

  it('every artifact_type has at least one allowed role', () => {
    for (const t of ARTIFACT_TYPES) {
      expect(ARTIFACT_ROLE_REGISTRY[t].length).toBeGreaterThan(0);
    }
  });
});

describe('resolveArtifacts', () => {
  it('returns requirement id for developer + jira.issue.ingested', () => {
    const out = resolveArtifacts('jira.issue.ingested', 'developer');
    expect(out).toHaveLength(1);
    expect(out[0]!.artifact_type).toBe('requirement');
    expect(out[0]!.artifact_id).toMatch(/^art-[0-9a-f]{16}$/);
  });

  it('returns empty when role is denied', () => {
    expect(resolveArtifacts('confluence.page.published', 'developer')).toHaveLength(0);
  });

  it('returns two artifact ids for architect on confluence.page.published', () => {
    const out = resolveArtifacts('confluence.page.published', 'architect');
    const types = out.map((a) => a.artifact_type);
    expect(types).toContain('adr');
    expect(types).toContain('deployment_plan');
  });
});

describe('artifactsFor', () => {
  it('returns only the artifact ids, RBAC-filtered', () => {
    const ids = artifactsFor({ event_type: 'github.pr.merged', actor_role: 'developer' });
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^art-[0-9a-f]{16}$/);
  });
});

describe('buildArtifactAuditEvent', () => {
  it('embeds the artifact id in artifacts_emitted', () => {
    const stubEvent = stubConnectorEvent('github.pr.opened', 'developer');
    const out = buildArtifactAuditEvent({
      base_event: stubEvent,
      artifact_id: 'art-abcdef0123456789',
      artifact_type: 'code_patch',
    });
    expect(out.artifacts_emitted).toEqual(['art-abcdef0123456789']);
  });

  it('refuses to fabricate when role is denied', () => {
    const stubEvent = stubConnectorEvent('confluence.page.published', 'developer');
    expect(() =>
      buildArtifactAuditEvent({
        base_event: stubEvent,
        artifact_id: 'art-x',
        artifact_type: 'adr',
      }),
    ).toThrow(RbacDeniedError);
  });
});

function stubConnectorEvent(event_type: ConnectorEvent['event_type'], role: string): ConnectorEvent {
  return {
    event_id: 'evt-aaaaaaaaaaaaaaaaaa',
    event_type,
    schema_version: '1.0.0',
    occurred_at: '2026-06-20T00:00:00.000Z',
    tenant_id: 'tnt_8XQ',
    project_id: 'prj_FORA',
    connector_id: 'github',
    binding_id: 'bind_42',
    actor: { type: 'agent', id: 'a', role },
    outcome: 'success',
    reason_code: '',
    latency_ms: 1,
    request: { op: 'pr.open', args_hash: '0'.repeat(64) },
    response: null,
    artifacts_emitted: [],
    audit_chain: { prev_event_hash: '0'.repeat(64), event_hash: '0'.repeat(64) },
  };
}