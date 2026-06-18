/**
 * @fora/sync-plane — public surface.
 *
 * Implements ADR-0010 §4 (Tier-1 field-ownership + Tier-2 HLC LWW + Tier-3
 * divergence queue) and §3.2 HLC. The downstream Sync Plane service
 * (FORA sub-task #1) consumes these modules; the divergence workbench
 * (sub-task #5) reads the `DivergenceQueue` API. The polling backstop
 * (sub-task #7) uses `Hlc` for ordering observed remote events.
 *
 * v0.1 — pure in-memory; Postgres swap planned per ADR-0010 §3.1.
 */

export {
  Hlc,
  hlcCompare,
  hlcEqual,
  hlcFromWire,
  hlcMax,
  hlcToWire,
  HlcClockSkewError,
  HlcParseError,
  MAX_COUNTER,
  MAX_SKEW_MS,
  type HlcConfig,
  type HlcTimestamp,
  type HlcWire,
} from './hlc.js';

export {
  buildOwnershipTable,
  defaultOwnershipFields,
  isValidTenantSlug,
  KNOWN_PLATFORMS,
  loadOwnership,
  OwnershipLoadError,
  parseOwnership,
  tenantOwnershipPath,
  type CreatorOwnerRule,
  type LoadOwnershipOptions,
  type MirrorPolicy,
  type OwnershipMode,
  type OwnershipRule,
  type OwnershipTable,
  type Platform,
  type SingleOwnerRule,
  type Tier2Rule,
} from './ownership.js';

export {
  DivergenceQueue,
  type AuditEmitter,
  type CandidateValue,
  type DivergenceQueueOptions,
  type ParkedEvent,
  type ResolutionReason,
  type ResolvedEvent,
} from './divergence-queue.js';

export {
  Resolver,
  type IssueContext,
  type ResolutionOutcome,
  type ResolverOptions,
  type SyncEvent,
} from './resolver.js';
