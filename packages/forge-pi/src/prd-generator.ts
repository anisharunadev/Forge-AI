/**
 * PRD generator — from idea/ticket/signal to typed artifact.
 *
 * Rule 4 (Typed Artifacts Only) — output is a `PrdDraft`, never a free-form
 * blob. The originating input is preserved in `originated_from` for audit.
 */

import type { PrdDraft, TenantScopedContext } from './types';

export interface PrdInput {
  title: string;
  problem: string;
  proposed_solution: string;
  success_metrics: string[];
  originated_from:
    | { kind: 'idea'; idea_id: string }
    | { kind: 'cluster'; cluster_id: string }
    | { kind: 'signal'; signal_id: string };
}

export async function generatePrd(
  ctx: TenantScopedContext,
  input: PrdInput,
): Promise<PrdDraft> {
  return {
    ...ctx,
    draft_id: `prd_${input.originated_from.kind}_${Date.now()}`,
    title: input.title,
    problem: input.problem,
    proposed_solution: input.proposed_solution,
    success_metrics: input.success_metrics,
    originated_from: input.originated_from,
    draft_status: 'draft',
    created_at: new Date().toISOString(),
  };
}