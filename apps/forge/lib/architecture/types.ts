/**
 * Typed artifacts for the Architecture Center.
 *
 * Mirrors the Pydantic schemas in
 * `backend/app/schemas/architecture.py`. Field names follow the backend's
 * snake_case wire convention — these are payload types, not domain types
 * (the UI should map them to camelCase in components as needed).
 *
 * Rule 4 (typed artifacts) — no free-form blobs. Every list is wrapped in
 * a `{items, total}` list-response envelope; every detail is a single
 * typed record. Mutations carry the request body shape that the backend
 * route declares.
 */

// ---------------------------------------------------------------------------
// Enums / unions — keep in lock-step with backend regex patterns and
// model Enum values.
// ---------------------------------------------------------------------------

/** Mirrors `ADR.status` (free-form string in the schema; UI narrows it). */
export type ADRStatus =
  | 'proposed'
  | 'accepted'
  | 'deprecated'
  | 'superseded';

/** Mirrors `APIContractResponse.status`. */
export type ContractStatus = 'draft' | 'published';

/** Mirrors `RiskResponse.status` (RISK_STATUSES). */
export type RiskStatus = 'open' | 'mitigating' | 'closed' | 'accepted';

/** Convenience grouping for the risk matrix. */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Mirrors `TaskBreakdownResponse.status` and `Task.status`. */
export type TaskBreakdownStatus = 'draft' | 'active' | 'completed' | 'archived';

/** Mirrors `ArchitectureApprovalResponse.status`. */
export type ApprovalStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'denied'
  | 'cancelled';

/** Mirrors `AttestationResponse.status`. */
export type AttestationStatus = 'attested' | 'failed' | 'revoked';

/** Mirrors `ArchitectureApprovalDecisionRequest.decision`. */
export type ApprovalDecision = 'approve' | 'deny';

/** Mirrors `ArchitectureApprovalRequest.artifact_type` and reviewer.role. */
export type ArchitectureArtifactType =
  | 'adr'
  | 'api_contract'
  | 'task_breakdown'
  | 'risk_register';

/** Mirrors `TaskBreakdownCreateRequest.source_type`. */
export type TaskBreakdownSourceType = 'adr' | 'api_contract' | 'risk_register';

/** Mirrors `RiskRegisterCreateRequest.source_type`. */
export type RiskRegisterSourceType = 'adr' | 'breakdown' | 'idea';

/** Mirrors `RiskCreate.category` (RISK_CATEGORIES). */
export type RiskCategory =
  | 'technical'
  | 'security'
  | 'operational'
  | 'business'
  | 'compliance';

/** Mirrors `LineageGraphResponse.direction`. */
export type LineageDirection = 'upstream' | 'downstream' | 'both';

// ---------------------------------------------------------------------------
// ADR (F-301)
// ---------------------------------------------------------------------------

/** Mirrors `ADRResponse` in `backend/app/schemas/architecture.py`. */
export interface ADR {
  id: string;
  number: number;
  title: string;
  status: string;
  context: string;
  decision: string;
  consequences: Record<string, unknown>;
  alternatives: Array<Record<string, unknown>>;
  related_adrs: string[];
  generated_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

/** Mirrors `ADRListResponse`. */
export interface ADRListResponse {
  items: ADR[];
  total: number;
}

/** Mirrors `ADRCreateRequest`. */
export interface ADRCreateInput {
  project_id: string;
  title: string;
  problem: string;
  forces?: string[];
  constraints?: string[];
  related_adrs?: string[];
  related_artifacts?: string[];
}

/** Mirrors `ADRSupersedeRequest`. */
export interface ADRSupersedeInput {
  new_adr_id: string;
}

// ---------------------------------------------------------------------------
// API Contract (F-302)
// ---------------------------------------------------------------------------

/** Mirrors `APIContractResponse`. */
export interface APIContract {
  id: string;
  name: string;
  version: string;
  spec_type: string;
  spec_content: Record<string, unknown>;
  status: string;
  source_artifact_id: string | null;
  generated_by: string | null;
  approved_by: string | null;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

/** Mirrors `APIContractListResponse`. */
export interface APIContractListResponse {
  items: APIContract[];
  total: number;
}

/** Mirrors `APIContractCreateRequest`. */
export interface APIContractCreateInput {
  project_id: string;
  description: string;
  contract_type?: 'openapi' | 'graphql' | 'grpc';
  name?: string;
}

/** Mirrors `APIContractValidationResponse`. */
export interface APIContractValidationResponse {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Risk Register (F-304)
// ---------------------------------------------------------------------------

/** Mirrors `RiskResponse`. */
export interface Risk {
  id: string;
  title: string;
  category: string;
  likelihood: number;
  impact: number;
  score: number;
  mitigation: string;
  owner: string;
  status: string;
}

/** Mirrors `RiskRegisterResponse`. */
export interface RiskRegister {
  id: string;
  name: string;
  risks: Risk[];
  mitigation_strategy: string;
  status: string;
  generated_by: string | null;
  approved_by: string | null;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

/** Mirrors `RiskRegisterListResponse`. */
export interface RiskRegisterListResponse {
  items: RiskRegister[];
  total: number;
}

/** Mirrors `RiskCreate`. */
export interface RiskCreateInput {
  title: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  mitigation?: string;
  owner?: string;
  status?: RiskStatus;
}

/** Mirrors `RiskUpdateRequest`. */
export interface RiskUpdateInput {
  title?: string;
  category?: RiskCategory;
  likelihood?: number;
  impact?: number;
  mitigation?: string;
  owner?: string;
  status?: RiskStatus;
}

/** Mirrors `RiskRegisterCreateRequest`. */
export interface RiskRegisterCreateInput {
  source_type: RiskRegisterSourceType;
  source_id: string;
  project_id?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Task Breakdown (F-303)
// ---------------------------------------------------------------------------

/** Mirrors `Task` in `backend/app/schemas/architecture.py`. */
export interface TaskNode {
  id: string;
  title: string;
  description: string;
  estimate_hours: number;
  dependencies: string[];
  skills_required: string[];
  agents_suggested: string[];
  acceptance_criteria: string[];
  status: string;
}

/** Mirrors `TaskBreakdownResponse`. */
export interface TaskBreakdown {
  id: string;
  name: string;
  parent_artifact_type: string;
  parent_artifact_id: string;
  tasks: TaskNode[];
  total_estimate_hours: number;
  status: string;
  generated_by: string | null;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

/** Mirrors `TaskBreakdownListResponse`. */
export interface TaskBreakdownListResponse {
  items: TaskBreakdown[];
  total: number;
}

/** Mirrors `TaskBreakdownCreateRequest`. */
export interface TaskBreakdownCreateInput {
  project_id: string;
  source_type: TaskBreakdownSourceType;
  source_id: string;
  source_artifact_id?: string;
}

/** Mirrors `TaskUpdateRequest`. */
export interface TaskUpdateInput {
  title?: string;
  description?: string;
  estimate_hours?: number;
  dependencies?: string[];
  skills_required?: string[];
  agents_suggested?: string[];
  acceptance_criteria?: string[];
  status?: string;
}

// ---------------------------------------------------------------------------
// Approval Workflow (F-305)
// ---------------------------------------------------------------------------

/** Mirrors `ArchitectureApprovalReviewer`. */
export interface ArchitectureApprovalReviewer {
  role: string;
  status: 'pending' | 'approved' | 'denied';
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
}

/** Mirrors `ArchitectureApprovalResponse`. */
export interface ArchitectureApproval {
  id: string;
  artifact_type: string;
  artifact_id: string;
  requested_by: string;
  required_reviewers: string[];
  reviewers: ArchitectureApprovalReviewer[];
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

/** Mirrors `ArchitectureApprovalListResponse`. */
export interface ArchitectureApprovalListResponse {
  items: ArchitectureApproval[];
  total: number;
}

/** Mirrors `ArchitectureApprovalRequest`. */
export interface ArchitectureApprovalRequestInput {
  artifact_type: ArchitectureArtifactType;
  artifact_id: string;
  project_id?: string;
}

/** Mirrors `ArchitectureApprovalDecisionRequest`. */
export interface ArchitectureApprovalDecisionInput {
  decision: ApprovalDecision;
  reason?: string;
  reviewer_role?: string;
}

// ---------------------------------------------------------------------------
// Architecture Versioning (F-307)
// ---------------------------------------------------------------------------

/** Mirrors `ArchitectureVersionResponse`. */
export interface ArchitectureVersion {
  version_id: string;
  artifact_type: string;
  artifact_id: string;
  version_number: number;
  content_hash: string;
  snapshot_reason: string;
  actor_id: string;
  created_at: string;
}

/** Mirrors `ArchitectureVersionListResponse`. */
export interface ArchitectureVersionListResponse {
  items: ArchitectureVersion[];
  total: number;
}

/** Mirrors `ArchitectureVersionCreateRequest` body for `POST /versions`. */
export interface ArchitectureVersionCreateInput {
  artifact_type: string;
  artifact_id: string;
  snapshot_reason: string;
}

/** Mirrors `RollbackRequest` body for `POST /versions/rollback`. */
export interface ArchitectureVersionRollbackInput {
  artifact_type: string;
  artifact_id: string;
  version_id: string;
}

/** Mirrors `ArchitectureDiffResponse`. */
export interface ArchitectureDiff {
  added: unknown[];
  removed: unknown[];
  modified: unknown[];
}

// ---------------------------------------------------------------------------
// Standards Attestation (F-308)
// ---------------------------------------------------------------------------

/** Mirrors `StandardCheckResponse`. */
export interface StandardCheck {
  standard_id: string;
  standard_name: string;
  applicable: boolean;
  passed: boolean;
  reason: string;
}

/** Mirrors `AttestationResponse`. */
export interface StandardAttestation {
  id: string;
  artifact_type: string;
  artifact_id: string;
  tenant_id: string;
  project_id: string;
  attestor_id: string;
  status: string;
  checks: StandardCheck[];
  reason: string | null;
  attested_at: string;
  revoked_at: string | null;
  revoker_id: string | null;
  revocation_reason: string | null;
}

/** Mirrors `AttestationListResponse`. */
export interface StandardAttestationListResponse {
  items: StandardAttestation[];
  total: number;
}

/** Mirrors `AttestationRequest`. */
export interface StandardAttestInput {
  artifact_type: string;
  artifact_id: string;
}

/** Mirrors `AttestationRevokeRequest`. */
export interface StandardAttestationRevokeInput {
  reason: string;
}

// ---------------------------------------------------------------------------
// Traceability (F-306) — graph + lineage payloads
// ---------------------------------------------------------------------------

/** Mirrors `TraceabilityNode`. */
export interface TraceabilityNode {
  id: string;
  artifact_type: string;
  artifact_id: string | null;
  label: string;
  layer: string;
}

/** Mirrors `TraceabilityEdge`. */
export interface TraceabilityEdge {
  source: string;
  target: string;
  relationship: string;
}

/** Mirrors `TraceabilityMatrixResponse`. */
export interface TraceabilityMatrix {
  tenant_id: string;
  project_id: string;
  nodes: TraceabilityNode[];
  edges: TraceabilityEdge[];
  stats: Record<string, unknown>;
}

/** Mirrors `LineageGraphResponse`. */
export interface LineageGraph {
  artifact_type: string;
  artifact_id: string;
  direction: LineageDirection;
  nodes: TraceabilityNode[];
  edges: TraceabilityEdge[];
}

// ---------------------------------------------------------------------------
// Acceptance Criteria (F-310) — exposed by `/architecture/acceptance/*`.
// Kept here so the hook surface stays in one place.
// ---------------------------------------------------------------------------

/** Mirrors `AcceptanceCriterion`. */
export interface AcceptanceCriterion {
  id: string;
  given: string;
  when: string;
  then: string;
  priority: string;
}

/** Mirrors `AcceptanceCriteriaResponse`. */
export interface AcceptanceCriteria {
  id: string;
  source_artifact_type: string;
  source_artifact_id: string;
  criteria: AcceptanceCriterion[];
  test_links: Record<string, string>;
  tenant_id: string;
  project_id: string;
  created_at: string;
}

/** Mirrors `CoverageByArtifact`. */
export interface CoverageByArtifact {
  artifact_type: string;
  artifact_id: string;
  total_criteria: number;
  criteria_with_tests: number;
  coverage_pct: number;
}

/** Mirrors `CoverageReportResponse`. */
export interface CoverageReport {
  project_id: string;
  total_criteria: number;
  criteria_with_tests: number;
  coverage_pct: number;
  by_artifact: CoverageByArtifact[];
}

/** Mirrors `ValidationResultResponse`. */
export interface ValidationResult {
  criteria_id: string;
  code_artifact_id: string;
  passed: boolean;
  matched_steps: string[];
  missing_steps: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Filter / input shapes passed as query strings by the hook layer.
// Keep these aligned with the FastAPI `Query(...)` declarations.
// ---------------------------------------------------------------------------

export interface ADRFilter {
  project_id?: string;
  status?: ADRStatus | string;
}

export interface ContractFilter {
  project_id?: string;
}

export interface RiskRegisterFilter {
  project_id?: string;
  status?: RiskStatus | string;
}

export interface TaskBreakdownFilter {
  project_id?: string;
}

export interface ApprovalFilter {
  status?: ApprovalStatus | string;
  tenant_id?: string;
}

export interface StandardAttestationFilter {
  project_id?: string;
}

export interface TraceabilityFilter {
  project_id?: string;
}

export interface LineageFilter {
  artifact_type?: string;
  artifact_id?: string;
  direction?: LineageDirection;
}

export interface OrphansFilter {
  project_id?: string;
}

export interface ArchitectureVersionListFilter {
  artifact_type?: string;
  artifact_id?: string;
}

export interface ArchitectureVersionDiffFilter {
  version_a?: string;
  version_b?: string;
}

// ---------------------------------------------------------------------------
// Security Report (M5-G4 — new surface)
// ---------------------------------------------------------------------------

/** Mirrors `SecurityReportResponse.severity` (literal union). */
export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

/** Mirrors `SecurityReportResponse.category`. */
export type SecurityCategory =
  | 'auth'
  | 'data'
  | 'network'
  | 'dependency'
  | 'configuration'
  | 'cryptography'
  | 'logging';

/** Mirrors `SecurityReportResponse.status`. */
export type SecurityStatus = 'open' | 'mitigating' | 'accepted' | 'closed';

/** Mirrors `SecurityReportResponse`. */
export interface SecurityReport {
  id: string;
  tenant_id: string;
  project_id: string;
  source_adr_id: string | null;
  title: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  description: string;
  affected_service: string;
  recommendation: string;
  status: SecurityStatus;
  discovered_at: string;
  mitigated_at: string | null;
  generated_by: string | null;
}

/** Mirrors `SecurityReportListResponse`. */
export interface SecurityReportListResponse {
  items: SecurityReport[];
  total: number;
}

/** Mirrors `SecurityReportCreateRequest`. */
export interface SecurityReportCreateInput {
  project_id: string;
  title: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  description: string;
  affected_service: string;
  recommendation: string;
  source_adr_id?: string;
}

/** Mirrors `SecurityReportStatusUpdate`. */
export interface SecurityReportStatusUpdateInput {
  status: SecurityStatus;
  note?: string;
}

/** Mirrors `SecurityReportFilter` — passed as query params to list. */
export interface SecurityReportFilter {
  project_id?: string;
  severity?: SecuritySeverity;
  category?: SecurityCategory;
  status?: SecurityStatus;
  limit?: number;
}

/**
 * Deployment posture aggregate returned by
 * `GET /architecture/security-reports/posture`.
 *
 * `score` is a 0–100 risk-weighted figure (higher = healthier). The
 * counters `total_open` / `critical_open` / `high_open` drive the
 * SecurityPostureCard KPI strip.
 */
export interface SecurityPosture {
  tenant_id: string;
  project_id: string;
  total_open: number;
  critical_open: number;
  high_open: number;
  medium_open: number;
  low_open: number;
  score: number;
  by_category: Record<SecurityCategory, number>;
  top_affected_services: ReadonlyArray<{ service: string; count: number }>;
  trend: ReadonlyArray<{ date: string; score: number }>;
  computed_at: string;
}
