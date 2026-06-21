/**
 * Gate-table eval test (FORA-137 acceptance bar #1).
 *
 * Every (gate → role) pair from FORA-50 §6.1 / ADR-0008 §3 must match
 * the typed table in `gates.ts`. The matrix below is the spec, in
 * order; the test fails loud if a refactor drifts the table from the
 * spec. Per architecture.md §5, adding or changing a gate requires
 * an ADR; the gate table is a one-way door.
 */

import { describe, it, expect } from 'vitest';

import {
  GATES,
  GATE_BY_KIND,
  findGate,
  isStageTransition,
  pagesAt50Percent,
  ttlMs,
  type GateKind,
  type PaperclipPrimitive,
  type RoleOfRecord,
  type TtlTier,
} from '../src/gates.js';
import type { Stage } from '../src/types.js';

interface SpecRow {
  kind: GateKind;
  from: Stage | null;
  to: Stage | null;
  required_role: RoleOfRecord;
  primitive: PaperclipPrimitive;
  ttl: TtlTier;
  escalation: 'cto' | 'board' | 'none';
  continuation: 'wake_assignee' | 'wake_assignee_on_accept';
}

const SPEC: ReadonlyArray<SpecRow> = [
  // The seven stage transitions.
  {
    kind: 'ideation->architect',
    from: 'ideation',
    to: 'architect',
    required_role: 'product',
    primitive: 'request_confirmation',
    ttl: 'board_24h',
    escalation: 'board',
    continuation: 'wake_assignee',
  },
  {
    kind: 'architect->dev',
    from: 'architect',
    to: 'dev',
    required_role: 'cto',
    primitive: 'request_confirmation',
    ttl: 'cto_4h',
    escalation: 'board',
    continuation: 'wake_assignee',
  },
  {
    kind: 'dev->qa',
    from: 'dev',
    to: 'qa',
    required_role: 'qa',
    primitive: 'request_confirmation',
    ttl: 'engineering_1h',
    escalation: 'cto',
    continuation: 'wake_assignee',
  },
  {
    kind: 'qa->security',
    from: 'qa',
    to: 'security',
    required_role: 'security',
    primitive: 'request_confirmation',
    ttl: 'engineering_1h',
    escalation: 'cto',
    continuation: 'wake_assignee',
  },
  {
    kind: 'security->devops',
    from: 'security',
    to: 'devops',
    required_role: 'devops',
    primitive: 'request_confirmation',
    ttl: 'engineering_1h',
    escalation: 'cto',
    continuation: 'wake_assignee',
  },
  {
    kind: 'devops->docs',
    from: 'devops',
    to: 'docs',
    required_role: 'docs',
    primitive: 'request_confirmation',
    ttl: 'engineering_1h',
    escalation: 'cto',
    continuation: 'wake_assignee',
  },
  {
    kind: 'docs->done',
    from: 'docs',
    to: null,
    required_role: 'docs',
    primitive: 'request_confirmation',
    ttl: 'engineering_1h',
    escalation: 'cto',
    continuation: 'wake_assignee',
  },
  // The customer-facing launch gate.
  {
    kind: 'launch',
    from: null,
    to: null,
    required_role: 'board',
    primitive: 'request_board_approval',
    ttl: 'board_24h',
    escalation: 'none',
    continuation: 'wake_assignee_on_accept',
  },
];

describe('gates', () => {
  it('table has exactly the eight gates in the spec order', () => {
    expect(GATES).toHaveLength(8);
    expect(GATES.map((g) => g.kind)).toEqual([
      'ideation->architect',
      'architect->dev',
      'dev->qa',
      'qa->security',
      'security->devops',
      'devops->docs',
      'docs->done',
      'launch',
    ]);
  });

  for (const row of SPEC) {
    it(`gate ${row.kind} → role ${row.required_role} (TTL ${row.ttl})`, () => {
      const gate = findGate(row.kind);
      expect(gate).not.toBeNull();
      if (!gate) return;
      expect(gate.from).toBe(row.from);
      expect(gate.to).toBe(row.to);
      expect(gate.required_role).toBe(row.required_role);
      expect(gate.primitive).toBe(row.primitive);
      expect(gate.ttl).toBe(row.ttl);
      expect(gate.escalation).toBe(row.escalation);
      expect(gate.continuation).toBe(row.continuation);
      // Spot-check: lookup by kind matches the same gate.
      expect(GATE_BY_KIND[row.kind]).toBe(gate);
    });
  }

  it('every (gate → role) pair is in the spec', () => {
    for (const gate of GATES) {
      const spec = SPEC.find((r) => r.kind === gate.kind);
      expect(spec, `gate ${gate.kind} has no spec row`).toBeDefined();
    }
  });

  it('TTL tier mapping matches the spec', () => {
    expect(ttlMs('board_24h')).toBe(24 * 60 * 60 * 1000);
    expect(ttlMs('cto_4h')).toBe(4 * 60 * 60 * 1000);
    expect(ttlMs('engineering_1h')).toBe(60 * 60 * 1000);
  });

  it('every tier pages at 50% TTL (today)', () => {
    // A future automated tier may opt out; today every tier pages.
    expect(pagesAt50Percent('board_24h')).toBe(true);
    expect(pagesAt50Percent('cto_4h')).toBe(true);
    expect(pagesAt50Percent('engineering_1h')).toBe(true);
  });

  it('only the launch gate uses request_board_approval', () => {
    const perStage = GATES.filter((g) => g.kind !== 'launch');
    for (const g of perStage) {
      expect(g.primitive).toBe('request_confirmation');
    }
    const launch = findGate('launch');
    expect(launch?.primitive).toBe('request_board_approval');
  });

  it('only the launch gate uses wake_assignee_on_accept', () => {
    const perStage = GATES.filter((g) => g.kind !== 'launch');
    for (const g of perStage) {
      expect(g.continuation).toBe('wake_assignee');
    }
    const launch = findGate('launch');
    expect(launch?.continuation).toBe('wake_assignee_on_accept');
  });

  it('isStageTransition matches by (from, to) including the docs->done edge', () => {
    expect(isStageTransition('dev->qa', 'dev', 'qa')).toBe(true);
    expect(isStageTransition('dev->qa', 'dev', 'docs')).toBe(false);
    expect(isStageTransition('docs->done', 'docs', 'done')).toBe(true);
    expect(isStageTransition('docs->done', 'docs', 'dev')).toBe(false);
  });

  it('findGate returns null on miss', () => {
    // Cast to bypass the type guard — we want to assert the runtime
    // safety net.
    expect(findGate('launch' as GateKind)).not.toBeNull();
    expect(findGate('unknown' as GateKind)).toBeNull();
  });
});
