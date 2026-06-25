'use client';

/**
 * TanStack Query hook for the Ideation Center "Approve / Deny /
 * Request changes" CTA (Forge AI-440 / Pillar 1 Phase 2).
 *
 * Mirrors the canonical shape established by `usePushIdeaToJira` in
 * `usePushIdeaToJira.ts` — same generic arguments, same Idempotency-Key
 * contract via `request<T>()` in `lib/api.ts`. The actual fetch lives
 * in `lib/ideation/data.ts::decideApproval` so the hook stays a thin
 * TanStack wrapper (matches the Phase 1 decision to co-locate the
 * ideation fetcher with the rest of `lib/ideation/data.ts`).
 *
 * The endpoint is `POST /v1/ideation/approvals/{id}/decide` and the
 * server-side handler (`backend/app/api/v1/ideation/approvals.py:90`)
 * accepts `{ decision, reason }` in the body. The decision verb enum
 * is locked by `backend/app/db/models/ideation.py:121`:
 *
 *     'approve' | 'deny' | 'request_changes'
 *
 * On success the caller should refetch the approvals list (e.g. via
 * `useApiData('/v1/ideation/approvals').refresh()`) so the row
 * reflects the new server-side state.
 */

import { useMutation } from '@tanstack/react-query';

import {
  decideApproval,
  type ApprovalDecisionVerb,
  type DecideApprovalResult,
} from '@/lib/ideation/data';

/** Stable query keys so the mutation cache survives HMR / route changes. */
export const approvalDecideQueryKeys = {
  detail: (approvalId: string) =>
    ['ideation', 'approval', 'decide', approvalId] as const,
};

/** Variables passed to `useApprovalDecide().mutate(...)`. */
export interface ApprovalDecideVariables {
  readonly approvalId: string;
  readonly decision: ApprovalDecisionVerb;
  readonly reason?: string;
}

/**
 * Mutation hook — record a PM decision on a pending approval.
 *
 * On success the caller can chain a refetch of the approvals list
 * (`useApiData('/v1/ideation/approvals').refresh()`) to pull the
 * canonical row state from the server.
 */
export function useApprovalDecide() {
  return useMutation<DecideApprovalResult, Error, ApprovalDecideVariables>({
    mutationFn: ({ approvalId, decision, reason }) =>
      decideApproval(approvalId, decision, reason),
  });
}
