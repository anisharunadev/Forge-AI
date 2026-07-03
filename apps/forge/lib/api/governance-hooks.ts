/**
 * Governance Center — TanStack hooks (Step-72).
 *
 * Hits `backend/app/api/v1/governance_core.py` via the Foundation API
 * client (`@/lib/api/client`) so the JWT + tenant header are
 * auto-injected and 401s are transparently refreshed.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api/client';

import {
  governanceQueryKeys,
  type ApprovalRead,
  type AuditPage,
  type BoardConfirmationOutcome,
  type BoardConfirmationRead,
  type PolicyRead,
  type RbacRoleRead,
  type Violation,
  type ViolationPollResult,
} from '@/lib/api/governance';

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export function usePolicies(): UseQueryResult<ReadonlyArray<PolicyRead>, Error> {
  return useQuery<ReadonlyArray<PolicyRead>, Error>({
    queryKey: governanceQueryKeys.policies(),
    queryFn: () => api.get<ReadonlyArray<PolicyRead>>('/governance/policies'),
    staleTime: 30_000,
  });
}

export function useAcceptPolicy(): UseMutationResult<
  PolicyRead,
  Error,
  { policyId: string; actorId?: string }
> {
  const qc = useQueryClient();
  return useMutation<
    PolicyRead,
    Error,
    { policyId: string; actorId?: string }
  >({
    mutationFn: ({ policyId, actorId }) =>
      api.post<PolicyRead>(`/governance/policies/${policyId}/accept`, {
        actorId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.policies() });
    },
  });
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export function useApprovals(): UseQueryResult<
  ReadonlyArray<ApprovalRead>,
  Error
> {
  return useQuery<ReadonlyArray<ApprovalRead>, Error>({
    queryKey: governanceQueryKeys.approvals(),
    queryFn: () => api.get<ReadonlyArray<ApprovalRead>>('/governance/approvals'),
    staleTime: 15_000,
  });
}

export function useAcceptApproval(): UseMutationResult<
  ApprovalRead,
  Error,
  { approvalId: string; reason?: string; actorId?: string }
> {
  const qc = useQueryClient();
  return useMutation<
    ApprovalRead,
    Error,
    { approvalId: string; reason?: string; actorId?: string }
  >({
    mutationFn: ({ approvalId, reason, actorId }) =>
      api.post<ApprovalRead>(`/governance/approvals/${approvalId}/accept`, {
        actorId,
        reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.approvals() });
    },
  });
}

export function useDeclineApproval(): UseMutationResult<
  ApprovalRead,
  Error,
  { approvalId: string; reason?: string; actorId?: string }
> {
  const qc = useQueryClient();
  return useMutation<
    ApprovalRead,
    Error,
    { approvalId: string; reason?: string; actorId?: string }
  >({
    mutationFn: ({ approvalId, reason, actorId }) =>
      api.post<ApprovalRead>(`/governance/approvals/${approvalId}/decline`, {
        actorId,
        reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.approvals() });
    },
  });
}

// ---------------------------------------------------------------------------
// RBAC roles
// ---------------------------------------------------------------------------

export function useRbacRoles(): UseQueryResult<
  ReadonlyArray<RbacRoleRead>,
  Error
> {
  return useQuery<ReadonlyArray<RbacRoleRead>, Error>({
    queryKey: governanceQueryKeys.rbacRoles(),
    queryFn: () => api.get<ReadonlyArray<RbacRoleRead>>('/governance/rbac-roles'),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Board confirmations
// ---------------------------------------------------------------------------

export function useBoardConfirmations(): UseQueryResult<
  ReadonlyArray<BoardConfirmationRead>,
  Error
> {
  return useQuery<ReadonlyArray<BoardConfirmationRead>, Error>({
    queryKey: governanceQueryKeys.boardConfirmations(),
    queryFn: () =>
      api.get<ReadonlyArray<BoardConfirmationRead>>(
        '/governance/board-confirmations',
      ),
    staleTime: 30_000,
  });
}

export interface ConfirmBoardInput {
  subjectId: string;
  planRev: string;
  outcome: BoardConfirmationOutcome;
  prompt?: string;
  idempotencyKey?: string;
}

export function useConfirmBoard(): UseMutationResult<
  BoardConfirmationRead,
  Error,
  ConfirmBoardInput
> {
  const qc = useQueryClient();
  return useMutation<BoardConfirmationRead, Error, ConfirmBoardInput>({
    mutationFn: (body) =>
      api.post<BoardConfirmationRead>(
        '/governance/board-confirmations',
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: governanceQueryKeys.boardConfirmations(),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export function useViolations(
  severity: 'all' | 'low' | 'medium' | 'high' = 'all',
  days = 7,
): UseQueryResult<ReadonlyArray<Violation>, Error> {
  return useQuery<ReadonlyArray<Violation>, Error>({
    queryKey: [...governanceQueryKeys.violations(), severity, days],
    queryFn: () => {
      const params = new URLSearchParams();
      if (severity !== 'all') params.set('severity', severity);
      params.set('days', String(days));
      const qs = params.toString();
      return api.get<ReadonlyArray<Violation>>(
        `/governance/violations${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 30_000,
  });
}

export function useResolveViolation(): UseMutationResult<
  { id: string; status: 'RESOLVED'; resolved_by: string | null; resolved_at: string },
  Error,
  { violationId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ violationId }) =>
      api.post<{ id: string; status: 'RESOLVED'; resolved_by: string | null; resolved_at: string }>(
        `/governance/violations/${violationId}/resolve`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.violations() });
    },
  });
}

export function useReopenViolation(): UseMutationResult<
  { id: string; status: 'REOPENED'; reopened_by: string | null; reopened_at: string },
  Error,
  { violationId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ violationId }) =>
      api.post<{ id: string; status: 'REOPENED'; reopened_by: string | null; reopened_at: string }>(
        `/governance/violations/${violationId}/reopen`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: governanceQueryKeys.violations() });
    },
  });
}

export function usePollViolations(days = 1): UseQueryResult<ViolationPollResult, Error> {
  return useQuery<ViolationPollResult, Error>({
    queryKey: [...governanceQueryKeys.violations(), 'poll', days],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('days', String(days));
      return api.post<ViolationPollResult>(
        `/governance/violations/poll?${params.toString()}`,
      );
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Audit (paginated)
// ---------------------------------------------------------------------------

export function useAuditPage(
  page = 1,
  pageSize = 50,
): UseQueryResult<AuditPage, Error> {
  return useQuery<AuditPage, Error>({
    queryKey: [...governanceQueryKeys.audit(page), pageSize],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      return api.get<AuditPage>(`/audit?${params.toString()}`);
    },
    staleTime: 15_000,
  });
}