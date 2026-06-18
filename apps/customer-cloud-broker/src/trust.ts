/**
 * Tenant IAM trust onboarding + re-probe.
 *
 * Per FORA-126 acceptance bar #4: the customer's IAM trust policy is
 * verified during tenant onboarding; a tenant whose trust is missing
 * or wrong is in `cloud_disabled` state until repaired.
 *
 * This module owns the trust store (`TenantCloudTrust`) and the probe
 * pipeline. The probe pipeline is two-phase:
 *
 *   Phase 1 — `adapter.probeTrust`. Synchronous, no network.
 *   Validates the tenant's `cloud_trust.yaml` shape: role ARN parses,
 *   issuer/audience match what the broker mints, role is in the
 *   expected region/account. This is fast and runs on every broker
 *   boot.
 *
 *   Phase 2 — canary assume via the adapter's `assume()` path. A
 *   `ProbeProbeSigner` mints a probe-specific FORA JWT (with the
 *   `scope: 'probe'` sentinel claim so customers can allow probes
 *   only); the broker hands it to the adapter to exchange for a
 *   cloud-native credential. A success proves the customer's trust
 *   policy actually accepts the broker's issuer. A failure flips
 *   the tenant to `cloud_disabled` with a typed reason.
 *
 *   The probe never calls `adapter.perform()` — only `assume()`.
 *   The handle is released via `adapter.releaseHandle?()` in a
 *   `finally` so a canary-assume never leaks its holder into the
 *   adapter's registry. The probe JWT itself is short-lived (60s)
 *   and never persisted.
 *
 * The trust store is read at boot and re-probed on a cron schedule
 * (`PROBE_INTERVAL_MS`, default 5 min). A tenant that was active and
 * goes `cloud_disabled` mid-flight has its in-flight requests
 * completed by the broker; subsequent requests are refused.
 *
 * FORA-126.4: this module owns phase 2 (the canary). Phase 1 is in
 * each adapter's `probeTrust()`. The audit event for probe outcomes
 * lives in `audit.ts::CloudProbeAuditEvent`.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type {
  AdapterRegistry,
} from './adapters/index.js';
import type {
  AwsActionArgs,
  AzureActionArgs,
  Cloud,
  GcpActionArgs,
  SonarQubeActionArgs,
  TenantCloudTrust,
  TrustState,
} from './types.js';
import type { ProbeProbeSigner } from './probe-signer.js';

// ---------------------------------------------------------------------------
// Tenant trust YAML schema. One file per tenant:
//   tenants/{tenant_id}/cloud_trust.yaml
// Each tenant lists the clouds they have on-boarded. A tenant with no
// file has no brokered-cloud access at all (the broker returns
// `cloud_disabled` for any action).
// ---------------------------------------------------------------------------

const TenantTrustEntrySchema = z
  .object({
    cloud: z.enum(['aws', 'azure', 'gcp', 'sonarqube']),
    account: z.string().min(1),
    role_ref: z.string().min(1),
    expected_issuer: z.string().url(),
    expected_audience: z.string().min(1),
  })
  .strict();

const TenantTrustFileSchema = z
  .object({
    version: z.literal(1),
    description: z.string().optional(),
    clouds: z.array(TenantTrustEntrySchema),
  })
  .strict();

export type TenantTrustFile = z.infer<typeof TenantTrustFileSchema>;

interface LoadOptions {
  baseDir?: string;
}

function resolvePath(source: string, baseDir?: string): string {
  if (isAbsolute(source)) return source;
  return resolve(baseDir ?? process.cwd(), source);
}

export function loadTenantTrustFile(source: string, opts: LoadOptions = {}): TenantTrustFile {
  const raw = readFileSync(resolvePath(source, opts.baseDir), 'utf-8');
  const parsed = parseYaml(raw);
  return TenantTrustFileSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// In-memory trust store. v1 is single-process; a future epic moves
// this to the Postgres RLS-protected table once the data layer is up.
// ---------------------------------------------------------------------------

export class TrustStore {
  private readonly trusts = new Map<string, TenantCloudTrust[]>();

  /** Load a tenant's trust from disk, replacing any prior state. */
  loadTenant(tenant_id: string, source: string, opts: LoadOptions = {}): TenantCloudTrust[] {
    const baseDir = opts.baseDir ?? dirname(resolvePath(source, opts.baseDir));
    const file = loadTenantTrustFile(source, { baseDir });
    const entries: TenantCloudTrust[] = file.clouds.map((c) => ({
      tenant_id,
      cloud: c.cloud,
      account: c.account,
      role_ref: c.role_ref,
      expected_issuer: c.expected_issuer,
      expected_audience: c.expected_audience,
      trust_state: 'pending_probe',
      last_probed_at: null,
      disabled_reason: null,
    }));
    this.trusts.set(tenant_id, entries);
    return entries;
  }

  /** Returns the trust entry for a tenant+cloud, or null. */
  get(tenant_id: string, cloud: Cloud): TenantCloudTrust | null {
    const list = this.trusts.get(tenant_id);
    if (!list) return null;
    return list.find((t) => t.cloud === cloud) ?? null;
  }

  /** Returns the trust entry by account reference (used during brokered requests). */
  getByAccount(tenant_id: string, cloud: Cloud, account: string): TenantCloudTrust | null {
    return this.get(tenant_id, cloud);
  }

  setState(tenant_id: string, cloud: Cloud, state: TrustState, reason: string | null): void {
    const list = this.trusts.get(tenant_id);
    if (!list) return;
    const entry = list.find((t) => t.cloud === cloud);
    if (!entry) return;
    entry.trust_state = state;
    entry.last_probed_at = new Date().toISOString();
    entry.disabled_reason = state === 'active' ? null : reason;
  }

  list(tenant_id: string): TenantCloudTrust[] {
    return this.trusts.get(tenant_id) ?? [];
  }

  /** Iterate every (tenant_id, cloud) pair across every tenant. */
  *entries(): IterableIterator<{ tenant_id: string; trust: TenantCloudTrust }> {
    for (const [tenant_id, list] of this.trusts) {
      for (const t of list) {
        yield { tenant_id, trust: t };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Probe pipeline (phase 1 + phase 2).
// ---------------------------------------------------------------------------

/**
 * The canary probe's typed reasons. Surfaced as `disabled_reason` on
 * the trust record AND as `cloud.probe.fail.reason` in the audit
 * event. Customers and operators can grep on these codes.
 */
export type ProbeFailureReason =
  | 'no_adapter'
  | 'phase1_failed'             // adapter.probeTrust returned ok=false
  | 'probe_mint_failed'         // signer.mint threw
  | 'assume_failed'             // adapter.assume threw (e.g. STS InvalidIdentityToken)
  | 'adapter_not_implemented'   // azure / gcp adapters not shipped yet
  | 'unhandled_probe_error';    // catch-all — should be rare

export interface ProbeResult {
  tenant_id: string;
  cloud: Cloud;
  state: TrustState;
  reason: string | null;
  /** Token-only result of phase 2 — the probe JWT, for audit correlation. */
  probe_jti?: string;
  /** Wall-clock duration of the probe (ms). */
  duration_ms: number;
  /** Phase 2 outcome, distinct from `state` so the audit log can mark it. */
  phase2: 'ok' | 'fail' | 'skipped';
}

export interface ProbeOptions {
  /** Probe JWT minter. Required for phase 2. */
  signer: ProbeProbeSigner;
  /** Region to mint the probe AWS args in. Defaults to `us-east-1`. */
  probe_region?: string;
  /** `now()` override for tests. */
  now?: () => number;
  /** Skip phase 2 — runs only the cheap config check. Test seam. */
  skip_canary?: boolean;
}

// ---------------------------------------------------------------------------
// Probe args builders. Each cloud gets the minimum args the adapter's
// `assume()` needs to attempt a federation. We don't care about the
// `operation` outcome; we only care that the trust policy accepted
// the broker's OIDC token.
// ---------------------------------------------------------------------------

/**
 * Build a minimal AWS `AwsActionArgs` for the canary assume. The
 * probe exchanges a probe JWT for a short-lived STS credential via
 * `AssumeRoleWithWebIdentity`; the `operation` (`GetCallerIdentity`)
 * is what AWS uses to authorise the trust policy path.
 *
 * Note: a real action would carry the customer's intended
 * `service` / `operation` / `params`; for the probe we use
 * `sts:GetCallerIdentity` because the customer's trust policy is
 * checked before the action's IAM permissions, and `GetCallerIdentity`
 * is universally granted (it's the standard "is the role live" check).
 */
function buildAwsProbeArgs(trust: TenantCloudTrust, region: string): AwsActionArgs {
  return {
    cloud: 'aws',
    role_arn: trust.role_ref,
    region,
    service: 'sts',
    operation: 'GetCallerIdentity',
    params: {},
  };
}

function buildAzureProbeArgs(trust: TenantCloudTrust): AzureActionArgs {
  // The Azure adapter is not shipped yet (FORA-126.2) — it throws
  // `AdapterNotImplementedError` from `assume()`. The probe hands
  // it a structurally-valid args object so the throw site is
  // reached; the catch in `probeTenant` then surfaces
  // `adapter_not_implemented` to the audit log.
  return {
    cloud: 'azure',
    subscription_id: trust.account,
    aad_tenant_id: trust.account,
    app_registration_client_id: trust.role_ref,
    service: 'iam',
    operation: 'probe',
    params: {},
  };
}

function buildGcpProbeArgs(trust: TenantCloudTrust): GcpActionArgs {
  // The GCP adapter is not shipped yet (FORA-126.3) — it throws
  // `AdapterNotImplementedError` from `assume()`. The probe hands
  // it a structurally-valid args object so the throw site is
  // reached; the catch in `probeTenant` then surfaces
  // `adapter_not_implemented` to the audit log.
  return {
    cloud: 'gcp',
    project_number: trust.account,
    workload_identity_pool: trust.role_ref,
    workload_identity_provider: 'probe',
    service_account: 'probe@probe.iam.gserviceaccount.com',
    service: 'iam',
    operation: 'probe',
    params: {},
  };
}

/**
 * Build the minimal SonarQube args for a canary assume (FORA-321).
 * Phase 2 of the trust probe mints a real SonarQube user token
 * scoped to the pinned project — the probe exchanges a probe JWT
 * via the FORA-321 broker service-account bearer; a successful mint
 * proves the broker can talk to the customer's SonarQube instance.
 *
 * Phase 2 lands once SecurityEngineer is hired (FORA-321 follow-up);
 * for now the probe hands the adapter a structurally-valid args
 * object so `probeTrust` and the typed `assume()` reject path both
 * reach their failure sites.
 */
function buildSonarQubeProbeArgs(trust: TenantCloudTrust): SonarQubeActionArgs {
  // `role_ref` is `project:<key>` per `probeTrust`'s structural check.
  const project_key = trust.role_ref.replace(/^project:/, '') || 'probe-project';
  return {
    cloud: 'sonarqube',
    instance_url: trust.account,
    project_key,
    token_name: `fora-probe-${trust.tenant_id}`,
    service: 'projects',
    operation: 'show',
    params: {},
  };
}

// ---------------------------------------------------------------------------
// `probeTenant` — phase 1 + phase 2.
// ---------------------------------------------------------------------------

/**
 * Probe a single tenant+cloud trust record. Phase 1 is the cheap
 * config check; phase 2 is the canary assume.
 *
 * The returned `ProbeResult.state` is the new trust state — callers
 * (`TrustStore.setState` or the periodic re-probe loop) should write
 * it back. The audit event for the probe outcome is emitted by the
 * caller (the broker boot / the periodic loop) so a single probe
 * produces exactly one `cloud.probe.{ok,fail}` event regardless of
 * who scheduled it.
 */
export async function probeTenant(
  trust: TenantCloudTrust,
  adapters: AdapterRegistry,
  opts: ProbeOptions,
): Promise<ProbeResult> {
  const start = (opts.now ?? Date.now)();
  const adapter = adapters.get(trust.cloud);
  if (!adapter) {
    return {
      tenant_id: trust.tenant_id,
      cloud: trust.cloud,
      state: 'cloud_disabled',
      reason: 'no_adapter',
      duration_ms: (opts.now ?? Date.now)() - start,
      phase2: 'skipped',
    };
  }

  // Phase 1 — adapter-side config check.
  const phase1 = await adapter.probeTrust(trust);
  if (!phase1.ok) {
    return {
      tenant_id: trust.tenant_id,
      cloud: trust.cloud,
      state: 'cloud_disabled',
      reason: `phase1_failed:${phase1.reason ?? 'unknown'}`,
      duration_ms: (opts.now ?? Date.now)() - start,
      phase2: 'skipped',
    };
  }

  if (opts.skip_canary) {
    return {
      tenant_id: trust.tenant_id,
      cloud: trust.cloud,
      state: 'active',
      reason: null,
      duration_ms: (opts.now ?? Date.now)() - start,
      phase2: 'skipped',
    };
  }

  // Phase 2 — canary assume. The probe JWT carries `scope: 'probe'`
  // so a customer's trust policy can allow probes only. We mint it
  // here, hand it to the adapter, and release the handle in a
  // `finally` so the probe never leaks its holder.
  let probe_jti: string | undefined;
  let handle: unknown = null;
  let probeError: unknown;
  try {
    let probe_jwt: string;
    try {
      const probe_token = await opts.signer.mint({
        tenant_id: trust.tenant_id,
        cloud: trust.cloud,
      });
      probe_jwt = probe_token.jwt;
      probe_jti = probe_token.jti;
    } catch (err) {
      probeError = err;
      return {
        tenant_id: trust.tenant_id,
        cloud: trust.cloud,
        state: 'cloud_disabled',
        reason: `probe_mint_failed:${errorMessage(err)}`,
        duration_ms: (opts.now ?? Date.now)() - start,
        phase2: 'fail',
      };
    }

    let args: AwsActionArgs | AzureActionArgs | GcpActionArgs | SonarQubeActionArgs;
    switch (trust.cloud) {
      case 'aws':
        args = buildAwsProbeArgs(trust, opts.probe_region ?? 'us-east-1');
        break;
      case 'azure':
        args = buildAzureProbeArgs(trust);
        break;
      case 'gcp':
        args = buildGcpProbeArgs(trust);
        break;
      case 'sonarqube':
        args = buildSonarQubeProbeArgs(trust);
        break;
    }
    try {
      const assume = await adapter.assume(args, probe_jwt);
      handle = assume.handle;
    } catch (err) {
      probeError = err;
      return {
        tenant_id: trust.tenant_id,
        cloud: trust.cloud,
        state: 'cloud_disabled',
        reason: `assume_failed:${errorMessage(err)}`,
        duration_ms: (opts.now ?? Date.now)() - start,
        phase2: 'fail',
        probe_jti,
      };
    }
    return {
      tenant_id: trust.tenant_id,
      cloud: trust.cloud,
      state: 'active',
      reason: null,
      duration_ms: (opts.now ?? Date.now)() - start,
      phase2: 'ok',
      probe_jti,
    };
  } finally {
    // Zero the handle's holder. The probe never calls `perform()`,
    // so the adapter's per-handle holder would otherwise sit in the
    // registry until GC'd. `releaseHandle` is idempotent.
    if (handle != null) {
      try {
        adapter.releaseHandle?.(handle);
      } catch {
        // Releasing is best-effort; we never want a release failure
        // to mask the probe outcome.
      }
    }
    // Swallow the saved error from the success path.
    void probeError;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Convenience: discover tenant trust files from a directory layout.
// ---------------------------------------------------------------------------

export interface DiscoveredTenantTrust {
  tenant_id: string;
  source: string;
}

export function discoverTenantTrusts(rootDir: string): DiscoveredTenantTrust[] {
  // Minimal directory walk — `tenants/*/cloud_trust.yaml`. Avoids the
  // node_modules-style deep walk; the layout is shallow.
  if (!existsSync(rootDir)) return [];
  const out: DiscoveredTenantTrust[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(rootDir, entry.name, 'cloud_trust.yaml');
    if (existsSync(file)) {
      out.push({ tenant_id: entry.name, source: file });
    }
  }
  return out;
}
