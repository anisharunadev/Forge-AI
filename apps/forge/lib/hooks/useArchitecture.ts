'use client';

/**
 * TanStack Query hooks for the Architecture Center (F-301..F-310).
 *
 * Step 58 wires the Architecture page to the real backend. Each hook
 * maps to a single FastAPI endpoint under `/architecture/*`. Types come
 * from `@/lib/architecture/types` which mirrors
 * `backend/app/schemas/architecture.py` (snake_case wire shapes).
 *
 * Conventions follow `apps/forge/lib/query/hooks.ts`:
 *   - **Tenant scoping (Rule 2)** — every list call accepts the relevant
 *     `project_id` (or tenant-scoped) filter so the same hooks work for
 *     both the org-level Architecture page and project-scoped sub-pages.
 *   - **Cache invalidation** — mutations invalidate the relevant query
 *     keys (e.g. creating an ADR invalidates `archQueryKeys.adrs.all`).
 *   - **Typed artifacts (Rule 4)** — every input is typed against the
 *     backend schema; the dialog/form layer enforces additional
 *     client-side validation (e.g. title min length).
 *   - **Toast feedback** — mutations toast `sonner` success / error
 *     notifications so the user always sees the outcome.
 *
 * Stale times:
 *   - 60s for most read queries (matches dashboard / agents convention).
 *   - 5min for version listings (rarely change within a session).
 *   - 30s for approvals (frequent status changes, near real-time feel).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api/client';
import {
  createSecurityReport,
  getSecurityPosture,
  getSecurityReportById,
  listSecurityReports,
  updateSecurityReportStatus,
} from '@/lib/api/architecture';
import type {
  ADR,
  ADRCreateInput,
  ADRFilter,
  ADRListResponse,
  ADRSupersedeInput,
  AcceptanceCriteria,
  APIContract,
  APIContractCreateInput,
  APIContractListResponse,
  APIContractValidationResponse,
  ApprovalFilter,
  ArchitectureApproval,
  ArchitectureApprovalDecisionInput,
  ArchitectureApprovalListResponse,
  ArchitectureApprovalRequestInput,
  ArchitectureDiff,
  ArchitectureVersion,
  ArchitectureVersionCreateInput,
  ArchitectureVersionDiffFilter,
  ArchitectureVersionListFilter,
  ArchitectureVersionListResponse,
  ArchitectureVersionRollbackInput,
  ContractFilter,
  CoverageReport,
  LineageFilter,
  LineageGraph,
  OrphansFilter,
  Risk,
  RiskCreateInput,
  RiskRegister,
  RiskRegisterCreateInput,
  RiskRegisterFilter,
  RiskRegisterListResponse,
  RiskUpdateInput,
  SecurityPosture,
  SecurityReport,
  SecurityReportCreateInput,
  SecurityReportFilter,
  SecurityReportListResponse,
  SecurityReportStatusUpdateInput,
  StandardAttestInput,
  StandardAttestation,
  StandardAttestationFilter,
  StandardAttestationListResponse,
  StandardAttestationRevokeInput,
  TaskBreakdown,
  TaskBreakdownCreateInput,
  TaskBreakdownFilter,
  TaskBreakdownListResponse,
  TaskUpdateInput,
  TraceabilityFilter,
  TraceabilityMatrix,
  ValidationResult,
} from '@/lib/architecture/types';

// ---------------------------------------------------------------------------
// URL helper — drop undefined / empty values so the backend only sees
// the constraints the caller actually set.
// ---------------------------------------------------------------------------

function buildQuery(filter?: unknown): string {
  const params = new URLSearchParams();
  if (filter && typeof filter === 'object') {
    for (const [k, v] of Object.entries(filter as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, String(v));
      }
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Query keys — centralized so any mutation can invalidate the right
// slice without string-typing itself into a corner.
// ---------------------------------------------------------------------------

export const archQueryKeys = {
  all: ['architecture'] as const,
  adrs: {
    all: () => [...archQueryKeys.all, 'adrs'] as const,
    list: (filter?: ADRFilter) => [...archQueryKeys.adrs.all(), 'list', filter ?? {}] as const,
    detail: (id: string) => [...archQueryKeys.adrs.all(), 'detail', id] as const,
  },
  contracts: {
    all: () => [...archQueryKeys.all, 'contracts'] as const,
    list: (filter?: ContractFilter) => [...archQueryKeys.contracts.all(), 'list', filter ?? {}] as const,
    detail: (id: string) => [...archQueryKeys.contracts.all(), 'detail', id] as const,
  },
  riskRegisters: {
    all: () => [...archQueryKeys.all, 'risk-registers'] as const,
    list: (filter?: RiskRegisterFilter) =>
      [...archQueryKeys.riskRegisters.all(), 'list', filter ?? {}] as const,
    detail: (id: string) => [...archQueryKeys.riskRegisters.all(), 'detail', id] as const,
    top: (id: string, topN: number) =>
      [...archQueryKeys.riskRegisters.all(), 'top', id, topN] as const,
  },
  taskBreakdowns: {
    all: () => [...archQueryKeys.all, 'task-breakdowns'] as const,
    list: (filter?: TaskBreakdownFilter) =>
      [...archQueryKeys.taskBreakdowns.all(), 'list', filter ?? {}] as const,
    detail: (id: string) => [...archQueryKeys.taskBreakdowns.all(), 'detail', id] as const,
  },
  approvals: {
    all: () => [...archQueryKeys.all, 'approvals'] as const,
    list: (filter?: ApprovalFilter) =>
      [...archQueryKeys.approvals.all(), 'list', filter ?? {}] as const,
    detail: (id: string) => [...archQueryKeys.approvals.all(), 'detail', id] as const,
  },
  versions: {
    all: () => [...archQueryKeys.all, 'versions'] as const,
    list: (filter: ArchitectureVersionListFilter) =>
      [...archQueryKeys.versions.all(), 'list', filter] as const,
    diff: (filter: ArchitectureVersionDiffFilter) =>
      [...archQueryKeys.versions.all(), 'diff', filter] as const,
  },
  standards: {
    all: () => [...archQueryKeys.all, 'standards'] as const,
    attestations: (filter?: StandardAttestationFilter) =>
      [...archQueryKeys.standards.all(), 'attestations', filter ?? {}] as const,
    checks: (artifactType: string, artifactId: string) =>
      [...archQueryKeys.standards.all(), 'check', artifactType, artifactId] as const,
  },
  traceability: {
    all: () => [...archQueryKeys.all, 'traceability'] as const,
    matrix: (filter?: TraceabilityFilter) =>
      [...archQueryKeys.traceability.all(), 'matrix', filter ?? {}] as const,
    lineage: (filter: LineageFilter) =>
      [...archQueryKeys.traceability.all(), 'lineage', filter] as const,
    orphans: (filter?: OrphansFilter) =>
      [...archQueryKeys.traceability.all(), 'orphans', filter ?? {}] as const,
    breakingChanges: (contractId: string) =>
      [...archQueryKeys.traceability.all(), 'breaking-changes', contractId] as const,
  },
  acceptance: {
    all: () => [...archQueryKeys.all, 'acceptance'] as const,
    coverage: (projectId: string) =>
      [...archQueryKeys.acceptance.all(), 'coverage', projectId] as const,
  },
  // M5-G4 — Security Report slice. Keeps the Security tab queryable
  // via the same TanStack Query key hierarchy as the rest of the
  // Architecture Center.
  security: {
    all: () => [...archQueryKeys.all, 'security'] as const,
    list: (filter?: SecurityReportFilter) =>
      [...archQueryKeys.security.all(), 'list', filter ?? {}] as const,
    detail: (id: string) => [...archQueryKeys.security.all(), 'detail', id] as const,
    posture: (projectId?: string) =>
      [...archQueryKeys.security.all(), 'posture', projectId ?? ''] as const,
  },
};

// ---------------------------------------------------------------------------
// ADRs (F-301)
// ---------------------------------------------------------------------------

export function useADRs(filter?: ADRFilter): UseQueryResult<ADRListResponse> {
  return useQuery({
    queryKey: archQueryKeys.adrs.list(filter),
    queryFn: () => api.get<ADRListResponse>(`/architecture/adrs${buildQuery(filter)}`),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useADR(id: string | null | undefined): UseQueryResult<ADR> {
  return useQuery({
    queryKey: archQueryKeys.adrs.detail(id ?? ''),
    queryFn: () => api.get<ADR>(`/architecture/adrs/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useCreateADR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ADRCreateInput) =>
      api.post<ADR>('/architecture/adrs', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.adrs.all() });
      toast.success('ADR generated');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to create ADR';
      toast.error(message);
    },
  });
}

export function useSupersedeADR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: ADRSupersedeInput & { id: string }) =>
      api.post<ADR>(`/architecture/adrs/${id}/supersede`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.adrs.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.adrs.detail(id) });
      toast.success('ADR superseded');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to supersede ADR';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// API Contracts (F-302)
// ---------------------------------------------------------------------------

export function useContracts(
  filter?: ContractFilter,
): UseQueryResult<APIContractListResponse> {
  return useQuery({
    queryKey: archQueryKeys.contracts.list(filter),
    queryFn: () => api.get<APIContractListResponse>(`/architecture/contracts${buildQuery(filter)}`),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useContract(
  id: string | null | undefined,
): UseQueryResult<APIContract> {
  return useQuery({
    queryKey: archQueryKeys.contracts.detail(id ?? ''),
    queryFn: () => api.get<APIContract>(`/architecture/contracts/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: APIContractCreateInput) =>
      api.post<APIContract>('/architecture/contracts', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.contracts.all() });
      toast.success('Contract generated');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to create contract';
      toast.error(message);
    },
  });
}

export function useValidateContract() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<APIContractValidationResponse>(`/architecture/contracts/${id}/validate`),
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Validation failed';
      toast.error(message);
    },
  });
}

export function usePublishContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<APIContract>(`/architecture/contracts/${id}/publish`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.contracts.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.contracts.detail(id) });
      toast.success('Contract published');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to publish contract';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Risk Registers (F-304)
// ---------------------------------------------------------------------------

export function useRiskRegisters(
  filter?: RiskRegisterFilter,
): UseQueryResult<RiskRegisterListResponse> {
  return useQuery({
    queryKey: archQueryKeys.riskRegisters.list(filter),
    queryFn: () =>
      api.get<RiskRegisterListResponse>(`/architecture/risk-registers${buildQuery(filter)}`),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useRiskRegister(
  id: string | null | undefined,
): UseQueryResult<RiskRegister> {
  return useQuery({
    queryKey: archQueryKeys.riskRegisters.detail(id ?? ''),
    queryFn: () => api.get<RiskRegister>(`/architecture/risk-registers/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useTopRisks(
  registerId: string | null | undefined,
  topN: number = 5,
): UseQueryResult<Risk[]> {
  return useQuery({
    queryKey: archQueryKeys.riskRegisters.top(registerId ?? '', topN),
    queryFn: () =>
      api.get<Risk[]>(`/architecture/risk-registers/${registerId}/top${buildQuery({ top_n: topN })}`),
    enabled: !!registerId,
    staleTime: 60_000,
  });
}

export function useCreateRiskRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RiskRegisterCreateInput) =>
      api.post<RiskRegister>('/architecture/risk-registers', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.riskRegisters.all() });
      toast.success('Risk register generated');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to create risk register';
      toast.error(message);
    },
  });
}

export function useAddRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      registerId,
      ...data
    }: RiskCreateInput & { registerId: string }) =>
      api.post<RiskRegister>(`/architecture/risk-registers/${registerId}/risks`, data),
    onSuccess: (_data, { registerId }) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.riskRegisters.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.riskRegisters.detail(registerId) });
      toast.success('Risk added');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to add risk';
      toast.error(message);
    },
  });
}

export function useUpdateRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      registerId,
      riskId,
      ...data
    }: RiskUpdateInput & { registerId: string; riskId: string }) =>
      api.patch<RiskRegister>(
        `/architecture/risk-registers/${registerId}/risks/${riskId}`,
        data,
      ),
    onSuccess: (_data, { registerId }) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.riskRegisters.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.riskRegisters.detail(registerId) });
      toast.success('Risk updated');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to update risk';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Task Breakdowns (F-303)
// ---------------------------------------------------------------------------

export function useTaskBreakdowns(
  filter?: TaskBreakdownFilter,
): UseQueryResult<TaskBreakdownListResponse> {
  return useQuery({
    queryKey: archQueryKeys.taskBreakdowns.list(filter),
    queryFn: () =>
      api.get<TaskBreakdownListResponse>(
        `/architecture/task-breakdowns${buildQuery(filter)}`,
      ),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useTaskBreakdown(
  id: string | null | undefined,
): UseQueryResult<TaskBreakdown> {
  return useQuery({
    queryKey: archQueryKeys.taskBreakdowns.detail(id ?? ''),
    queryFn: () => api.get<TaskBreakdown>(`/architecture/task-breakdowns/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useCreateTaskBreakdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TaskBreakdownCreateInput) =>
      api.post<TaskBreakdown>('/architecture/task-breakdowns', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.taskBreakdowns.all() });
      toast.success('Task breakdown generated');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to create task breakdown';
      toast.error(message);
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      breakdownId,
      taskId,
      ...data
    }: TaskUpdateInput & { breakdownId: string; taskId: string }) =>
      api.patch<TaskBreakdown>(
        `/architecture/task-breakdowns/${breakdownId}/tasks/${taskId}`,
        data,
      ),
    onSuccess: (_data, { breakdownId }) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.taskBreakdowns.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.taskBreakdowns.detail(breakdownId) });
      toast.success('Task updated');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to update task';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Approvals (F-305)
// ---------------------------------------------------------------------------

export function useApprovals(
  filter?: ApprovalFilter,
): UseQueryResult<ArchitectureApprovalListResponse> {
  return useQuery({
    queryKey: archQueryKeys.approvals.list(filter),
    queryFn: () =>
      api.get<ArchitectureApprovalListResponse>(
        `/architecture/approvals${buildQuery(filter)}`,
      ),
    // Approvals are tenant-scoped via the auth token; refresh more often
    // because status changes (approve / deny) are user-driven actions.
    staleTime: 30_000,
  });
}

export function useApproval(
  id: string | null | undefined,
): UseQueryResult<ArchitectureApproval> {
  return useQuery({
    queryKey: archQueryKeys.approvals.detail(id ?? ''),
    queryFn: () => api.get<ArchitectureApproval>(`/architecture/approvals/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useRequestApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ArchitectureApprovalRequestInput) =>
      api.post<ArchitectureApproval>('/architecture/approvals', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.approvals.all() });
      toast.success('Approval requested');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to request approval';
      toast.error(message);
    },
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: ArchitectureApprovalDecisionInput & { id: string }) =>
      api.post<ArchitectureApproval>(`/architecture/approvals/${id}/decide`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.approvals.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.approvals.detail(id) });
      toast.success('Decision recorded');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to record decision';
      toast.error(message);
    },
  });
}

export function useCancelApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: ArchitectureApprovalDecisionInput & { id: string }) =>
      api.post<ArchitectureApproval>(`/architecture/approvals/${id}/cancel`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: archQueryKeys.approvals.all() });
      qc.invalidateQueries({ queryKey: archQueryKeys.approvals.detail(id) });
      toast.success('Approval cancelled');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to cancel approval';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Standards Attestation (F-308)
// ---------------------------------------------------------------------------

export function useStandardAttestations(
  filter?: StandardAttestationFilter,
): UseQueryResult<StandardAttestationListResponse> {
  return useQuery({
    queryKey: archQueryKeys.standards.attestations(filter),
    queryFn: () =>
      api.get<StandardAttestationListResponse>(
        `/architecture/standards/attestations${buildQuery(filter)}`,
      ),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useStandardChecks(
  artifactType: string | null | undefined,
  artifactId: string | null | undefined,
) {
  return useQuery({
    queryKey: archQueryKeys.standards.checks(artifactType ?? '', artifactId ?? ''),
    queryFn: () =>
      api.get<unknown[]>(
        `/architecture/standards/check/${encodeURIComponent(artifactType as string)}/${artifactId}`,
      ),
    enabled: !!artifactType && !!artifactId,
    staleTime: 60_000,
  });
}

export function useAttestStandard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      ...data
    }: StandardAttestInput & { projectId: string }) =>
      api.post<StandardAttestation>(
        `/architecture/standards/attest${buildQuery({ project_id: projectId })}`,
        data,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.standards.all() });
      toast.success('Standards attestation recorded');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to attest standards';
      toast.error(message);
    },
  });
}

export function useRevokeAttestation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: StandardAttestationRevokeInput & { id: string }) =>
      api.post<StandardAttestation>(
        `/architecture/standards/attestations/${id}/revoke`,
        data,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.standards.all() });
      toast.success('Attestation revoked');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to revoke attestation';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Architecture Versioning (F-307)
// ---------------------------------------------------------------------------

export function useArchitectureVersions(
  filter: ArchitectureVersionListFilter | null | undefined,
): UseQueryResult<ArchitectureVersionListResponse> {
  return useQuery({
    queryKey: archQueryKeys.versions.list(
      filter ?? { artifact_type: '', artifact_id: '' },
    ),
    queryFn: () =>
      api.get<ArchitectureVersionListResponse>(`/architecture/versions${buildQuery(filter)}`),
    enabled: !!filter?.artifact_type && !!filter.artifact_id,
    // Versions rarely change within a session — keep cache warm longer.
    staleTime: 5 * 60_000,
  });
}

export function useVersionDiff(
  filter: ArchitectureVersionDiffFilter | null | undefined,
): UseQueryResult<ArchitectureDiff> {
  return useQuery({
    queryKey: archQueryKeys.versions.diff(
      filter ?? { version_a: '', version_b: '' },
    ),
    queryFn: () => {
      // Backend uses `version_a` / `version_b`; the goal file mentioned
      // `from` / `to`. Match the actual backend contract.
      const qs = new URLSearchParams();
      if (filter?.version_a) qs.set('version_a', filter.version_a);
      if (filter?.version_b) qs.set('version_b', filter.version_b);
      return api.get<ArchitectureDiff>(`/architecture/versions/diff?${qs.toString()}`);
    },
    enabled: !!filter?.version_a && !!filter.version_b,
    staleTime: 5 * 60_000,
  });
}

export function useCreateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ArchitectureVersionCreateInput) =>
      api.post<ArchitectureVersion>('/architecture/versions', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.versions.all() });
      toast.success('Version snapshot created');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to create version';
      toast.error(message);
    },
  });
}

export function useRollbackVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ArchitectureVersionRollbackInput) =>
      api.post<ArchitectureVersion>('/architecture/versions/rollback', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.versions.all() });
      toast.success('Rolled back to selected version');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to rollback version';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Traceability (F-306)
// ---------------------------------------------------------------------------

export function useTraceability(
  filter?: TraceabilityFilter,
): UseQueryResult<TraceabilityMatrix> {
  return useQuery({
    queryKey: archQueryKeys.traceability.matrix(filter),
    queryFn: () =>
      api.get<TraceabilityMatrix>(`/architecture/traceability${buildQuery(filter)}`),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useLineage(
  filter: LineageFilter | null | undefined,
): UseQueryResult<LineageGraph> {
  return useQuery({
    queryKey: archQueryKeys.traceability.lineage(
      filter ?? { artifact_type: '', artifact_id: '' },
    ),
    queryFn: () => {
      const artifactType = filter?.artifact_type ?? '';
      const artifactId = filter?.artifact_id ?? '';
      const path = `/architecture/lineage/${encodeURIComponent(artifactType)}/${artifactId}`;
      return api.get<LineageGraph>(`${path}${buildQuery({ direction: filter?.direction })}`);
    },
    enabled: !!filter?.artifact_type && !!filter.artifact_id,
    staleTime: 60_000,
  });
}

export function useOrphans(
  filter?: OrphansFilter,
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: archQueryKeys.traceability.orphans(filter),
    queryFn: () => api.get<unknown>(`/architecture/orphans${buildQuery(filter)}`),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

export function useBreakingChanges(
  contractId: string | null | undefined,
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: archQueryKeys.traceability.breakingChanges(contractId ?? ''),
    queryFn: () =>
      api.get<unknown>(`/architecture/breaking-changes/${contractId}`),
    enabled: !!contractId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Acceptance Criteria (F-310)
// ---------------------------------------------------------------------------

export function useAcceptanceCriteria(
  artifactType: string | null | undefined,
  artifactId: string | null | undefined,
): UseQueryResult<AcceptanceCriteria> {
  return useQuery({
    queryKey: [
      ...archQueryKeys.acceptance.all(),
      'criteria',
      artifactType ?? '',
      artifactId ?? '',
    ] as const,
    queryFn: () =>
      api.post<AcceptanceCriteria>('/architecture/acceptance/generate', {
        artifact_type: artifactType,
        artifact_id: artifactId,
      }),
    enabled: !!artifactType && !!artifactId,
    staleTime: 60_000,
  });
}

export function useCoverageReport(
  projectId: string | null | undefined,
): UseQueryResult<CoverageReport> {
  return useQuery({
    queryKey: archQueryKeys.acceptance.coverage(projectId ?? ''),
    queryFn: () =>
      api.get<CoverageReport>(
        `/architecture/acceptance/coverage${buildQuery({ project_id: projectId })}`,
      ),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useValidateAcceptance() {
  return useMutation({
    mutationFn: ({
      criteriaId,
      codeArtifactId,
    }: {
      criteriaId: string;
      codeArtifactId: string;
    }) =>
      api.post<ValidationResult>('/architecture/acceptance/validate', {
        criteria_id: criteriaId,
        code_artifact_id: codeArtifactId,
      }),
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Validation failed';
      toast.error(message);
    },
  });
}

export function useLinkAcceptanceToTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ criteriaId, testId }: { criteriaId: string; testId: string }) =>
      api.post<AcceptanceCriteria>(
        `/architecture/acceptance/${criteriaId}/link-test`,
        { test_id: testId },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: archQueryKeys.acceptance.all() });
      toast.success('Test linked');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to link test';
      toast.error(message);
    },
  });
}

// ---------------------------------------------------------------------------
// Security Reports (M5-G4 — new surface)
// ---------------------------------------------------------------------------
//
// Aggregate hook surface so the page-level integration has a single
// import. Each individual hook is also exported directly for fine-grained
// consumers (drawer detail view, command palette, etc.).

export interface UseArchitectureSecurityApi {
  /** List hook — paginated findings. Accepts severity/category/status/project filters. */
  useReports: (filter?: SecurityReportFilter) => UseQueryResult<SecurityReportListResponse>;
  /** Single-record hook — opens the detail drawer. */
  useReportById: (id: string | null | undefined) => UseQueryResult<SecurityReport>;
  /** Posture aggregate — drives SecurityPostureCard + Posture Trend tab. */
  usePosture: (projectId?: string) => UseQueryResult<SecurityPosture>;
  /** Mutation — create a new finding. */
  useCreateReport: () => ReturnType<
    typeof useMutation<SecurityReport, Error, SecurityReportCreateInput>
  >;
  /** Mutation — change status (open / mitigating / accepted / closed). */
  useUpdateReportStatus: () => ReturnType<
    typeof useMutation<SecurityReport, Error, SecurityReportStatusUpdateInput & { id: string }>
  >;
}

export function useArchitectureSecurity(): UseArchitectureSecurityApi {
  const useReports = (filter?: SecurityReportFilter) =>
    useQuery({
      queryKey: archQueryKeys.security.list(filter),
      queryFn: () => listSecurityReports(filter),
      enabled: !!filter?.project_id,
      staleTime: 60_000,
    });

  const useReportById = (id: string | null | undefined) =>
    useQuery({
      queryKey: archQueryKeys.security.detail(id ?? ''),
      queryFn: () => getSecurityReportById(id as string),
      enabled: !!id,
      staleTime: 60_000,
    });

  const usePosture = (projectId?: string) =>
    useQuery({
      queryKey: archQueryKeys.security.posture(projectId),
      queryFn: () => getSecurityPosture(projectId),
      enabled: !!projectId,
      staleTime: 60_000,
    });

  const useCreateReport = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (data: SecurityReportCreateInput) => createSecurityReport(data),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: archQueryKeys.security.all() });
        toast.success('Security finding recorded');
      },
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : 'Failed to record security finding';
        toast.error(message);
      },
    });
  };

  const useUpdateReportStatus = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, ...data }: SecurityReportStatusUpdateInput & { id: string }) =>
        updateSecurityReportStatus(id, data),
      onSuccess: (_data, { id }) => {
        qc.invalidateQueries({ queryKey: archQueryKeys.security.all() });
        qc.invalidateQueries({ queryKey: archQueryKeys.security.detail(id) });
        toast.success('Status updated');
      },
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : 'Failed to update status';
        toast.error(message);
      },
    });
  };

  return { useReports, useReportById, usePosture, useCreateReport, useUpdateReportStatus };
}

/** Standalone list hook — convenient for one-off consumers. */
export function useSecurityReports(
  filter?: SecurityReportFilter,
): UseQueryResult<SecurityReportListResponse> {
  return useQuery({
    queryKey: archQueryKeys.security.list(filter),
    queryFn: () => listSecurityReports(filter),
    enabled: !!filter?.project_id,
    staleTime: 60_000,
  });
}

/** Standalone posture hook. */
export function useSecurityPosture(
  projectId?: string,
): UseQueryResult<SecurityPosture> {
  return useQuery({
    queryKey: archQueryKeys.security.posture(projectId),
    queryFn: () => getSecurityPosture(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
