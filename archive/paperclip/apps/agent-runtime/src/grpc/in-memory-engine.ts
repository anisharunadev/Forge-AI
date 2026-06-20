/**
 * InMemoryStageEngine — a local copy of the orchestrator's test
 * double, used by the factory's `memory` backend so the agent-runtime
 * tests do not need to import from `@fora/orchestrator`.
 *
 * Mirrors apps/orchestrator/src/test-doubles.ts::InMemoryStageEngine
 * invariants. The source of truth is the orchestrator; this is a
 * structural duplicate for the factory's "memory" path.
 */

import type { Stage, StageEngine } from './client.js';

interface RunRow {
  currentStage: Stage | 'done';
  status: 'running' | 'paused' | 'done';
  lastAdvanceKey: string | null;
  reEntries: Set<string>;
}

const STAGE_SPINE: ReadonlyArray<Stage> = [
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
];

function isValidNextStage(from: Stage | 'done', to: Stage | 'done'): boolean {
  if (from === 'done') return false;
  const idx = STAGE_SPINE.indexOf(from);
  if (idx === -1) return false;
  const next = idx + 1 < STAGE_SPINE.length ? STAGE_SPINE[idx + 1]! : 'done';
  return next === to;
}

export class InMemoryStageEngine implements StageEngine {
  private runs = new Map<string, RunRow>();

  seed(args: { runId: string; currentStage: Stage }): void {
    this.runs.set(args.runId, {
      currentStage: args.currentStage,
      status: 'running',
      lastAdvanceKey: null,
      reEntries: new Set(),
    });
  }

  state(runId: string): { currentStage: Stage | 'done'; status: 'running' | 'paused' | 'done' } | null {
    const r = this.runs.get(runId);
    if (!r) return null;
    return { currentStage: r.currentStage, status: r.status };
  }

  async advance(args: {
    tenantId: string;
    runId: string;
    fromStage: Stage;
    toStage: Stage | 'done';
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage | 'done' }> {
    const r = this.runs.get(args.runId);
    if (!r) {
      throw new Error(`InMemoryStageEngine: unknown runId ${args.runId}`);
    }
    if (r.lastAdvanceKey === args.idempotencyKey) {
      return { currentStage: r.currentStage };
    }
    if (r.currentStage !== args.fromStage) {
      throw new Error(
        `advance: run ${args.runId} is at ${r.currentStage}, not ${args.fromStage}`,
      );
    }
    if (!isValidNextStage(r.currentStage, args.toStage)) {
      throw new Error(
        `advance: invalid transition ${r.currentStage} → ${args.toStage}`,
      );
    }
    r.currentStage = args.toStage;
    r.status = args.toStage === 'done' ? 'done' : 'running';
    r.lastAdvanceKey = args.idempotencyKey;
    return { currentStage: r.currentStage };
  }

  async reEnter(args: {
    tenantId: string;
    runId: string;
    fromStage: Stage;
    toStage: Stage;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage }> {
    const r = this.runs.get(args.runId);
    if (!r) {
      throw new Error(`InMemoryStageEngine: unknown runId ${args.runId}`);
    }
    const key = `${args.runId}->${args.toStage}`;
    if (r.reEntries.has(key)) {
      return { currentStage: args.toStage };
    }
    if (r.currentStage !== args.fromStage) {
      throw new Error(
        `reEnter: run ${args.runId} is at ${r.currentStage}, not ${args.fromStage}`,
      );
    }
    r.currentStage = args.toStage;
    r.status = 'running';
    r.reEntries.add(key);
    return { currentStage: args.toStage };
  }

  async pauseRun(args: { tenantId: string; runId: string; approvalId: string }): Promise<void> {
    const r = this.runs.get(args.runId);
    if (!r) return;
    if (r.status === 'done') return;
    r.status = 'paused';
  }
}
