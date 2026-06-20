/**
 * @fora/connector-config — public surface.
 *
 * The tenant-scoped connector configuration service per Plan 4
 * (FORA-391) sub-task FORA-485. Consumers (the orchestration
 * glue, the MCP adapters, the health-check worker) import from
 * here, not from deep paths.
 *
 * ---- Sub-modules ------------------------------------------------------------
 *
 *   ./repo        — connector_binding CRUD (TenantAwarePool-backed)
 *   ./resolver    — five-step resolver with explicit MISS handling
 *   ./audit       — connector.binding.* audit emitter
 *   ./override    — override rules + divergence logic
 *   ./onboarding  — tenant onboarding + re-attestation + health-check
 *   ./types       — domain types + errors
 *
 * Spec source: Plan 4 (FORA-391.3). Owner: SeniorEngineer.
 */

export * from './types.js';
export {
  ConnectorBindingRepo,
  connectorBindingRepo,
} from './repo.js';
export {
  ConnectorConfigResolver,
  InProcessConnectorConfigCache,
  resolveBinding,
  resolveBindingOrThrow,
  cacheKey,
} from './resolver.js';
export type {
  ConnectorConfigCache,
  ConnectorConfigCacheKey,
  ResolverDeps,
} from './resolver.js';
export {
  buildEvent,
  createInMemoryAuditSink,
  mintEventId,
  systemActor,
  userActor,
} from './audit.js';
export type {
  ConnectorBindingAuditSink,
  ConnectorBindingActor,
  ConnectorBindingEvent,
  ConnectorBindingEventType,
  ConnectorBindingEventBase,
  ConnectorBindingCreatedMetadata,
  ConnectorBindingActivatedMetadata,
  ConnectorBindingRevokedMetadata,
  ConnectorBindingDivergedMetadata,
  ConnectorBindingAttestedMetadata,
  ConnectorBindingAttestationExpiredMetadata,
  ConnectorBindingOrphanRiskMetadata,
  ConnectorBindingMissingMetadata,
  ConnectorBindingInheritedResolvedMetadata,
  ConnectorBindingHealthCheckMetadata,
} from './audit.js';
export {
  buildDivergenceRecord,
  checkDivergenceRules,
  createProjectOverride,
  detectExpiredAttestations,
  detectOrphanRisk,
  emitDivergence,
  probeInheritedAuthMethod,
} from './override.js';
export type {
  CreateProjectOverrideInput,
  DivergenceRecord,
} from './override.js';
export {
  registerConnectorCrons,
  runAttestationSweep,
  runOrphanSweep,
} from './cron.js';
export type {
  ConnectorCronDescriptor,
  ConnectorSweepWorkerArgs,
  SweepAction,
  SweepRunResult,
} from './cron.js';
export {
  createAndActivateTenantDefault,
  isRealAuthMethod,
  onboardTenant,
  reAttestBinding,
  recordHealthCheck,
  revokeForgeOperatorFallbacks,
} from './onboarding.js';
export type { CreatedTenantDefault } from './onboarding.js';