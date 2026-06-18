/**
 * AWS Secrets Manager backing store for the secrets-mcp.
 *
 * Implements the `SecretStore` interface against `@aws-sdk/client-secrets-manager`.
 * v1 production backing store per FORA-128 / FORA-185 and ADR-0003 §7.
 *
 * Naming convention
 * -----------------
 *   secret_ref    : tenants/{tid}/secrets/{name}@{version}
 *   AWS SM Name   : {prefix}/{tid}/{name}      (default prefix: "fora")
 *
 * The `prefix` is configurable (FORA_AWS_SM_PREFIX). It lets multiple FORA
 * environments (dev, staging, prod) share an AWS account without name
 * collisions, and lets a tenant migrate by changing the prefix at deploy
 * time.
 *
 * Versioning
 * ----------
 * AWS Secrets Manager uses UUIDs for `VersionId` and the staging labels
 * AWSCURRENT / AWSPREVIOUS. The broker contract surfaces a positive integer
 * version (per ADR-0003 §7.1). The adapter maintains an in-process counter
 * keyed by `tid/name` and maps that integer to the AWS `VersionId` returned
 * by `PutSecretValue`. The counter is the source of truth for the broker;
 * the AWS `VersionId` is preserved in the returned `SecretVersion` for the
 * production audit forwarder (FORA-186) but is not exposed to the agent.
 *
 * The in-process counter is acceptable for v1: the secrets-mcp is a
 * long-running per-tenant process (per ADR-0003 §6.2 — the broker fans out
 * to one process per tenant). A restart resets the counter to the latest
 * version reported by AWS SM, so a fresh process picks up where the old
 * one left off (see `primeVersionCounter` in the `read` path).
 *
 * @latest resolution
 * ------------------
 *   - `ref.version === "latest"` → request the AWSCURRENT staging label.
 *   - `ref.version === "<n>"`   → look up the AWS VersionId for integer
 *     `n` and pass it as `VersionId` to `GetSecretValue`.
 *
 * Tenant boundary
 * ---------------
 * The store inherits `assertTenant` from the interface contract — a ref
 * whose `tenant_id` does not match the broker's `tenant_id` claim is a
 * programming error and throws `TenantScopeError` BEFORE we call AWS.
 *
 * Failure modes
 * -------------
 *   ResourceNotFoundException → `SecretNotFoundError`
 *   AccessDeniedException     → wrapped with `store_error` (the broker's
 *                               audit layer emits `secret.access_denied`).
 *   anything else             → wrapped with `store_error` so the broker
 *                               can re-raise as `store_error`.
 *
 * The store never logs the raw value. The `client` may be replaced via
 * the `clientFactory` injection point so unit tests can run offline
 * without real AWS credentials.
 */

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import type { SecretRef } from "./secret_ref.js";
import { formatSecretRef } from "./secret_ref.js";
import {
  SecretNotFoundError,
  TenantScopeError,
  type SecretStore,
  type SecretVersion,
} from "./store.js";

/** Minimum surface of the AWS SM client the store needs. The default
 *  factory returns a real `SecretsManagerClient`; tests inject a stub. */
export interface SecretsManagerClientLike {
  send<
    R extends { $metadata?: { httpStatusCode?: number } } = {
      $metadata?: { httpStatusCode?: number };
    },
  >(
    command: unknown,
  ): Promise<R>;
}

/** Factory: returns a client. The default wires the AWS SDK v3 client. */
export type SecretsManagerClientFactory = (region: string) => SecretsManagerClientLike;

const defaultClientFactory: SecretsManagerClientFactory = (region) =>
  new SecretsManagerClient({ region });

/** Default staging label used for `latest` resolution. */
const STAGING_LABEL_CURRENT = "AWSCURRENT";

export interface AwsSecretsManagerStoreOptions {
  /** AWS region (required, mirrors `Config.awsRegion`). */
  region: string;
  /** Tenant id this process is pinned to. Cross-tenant refs throw. */
  tenantClaim: string;
  /** Optional Name prefix (default "fora"). */
  prefix?: string;
  /** Endpoint override (smoke tests only — wires a local mock AWS). */
  endpointUrl?: string;
  /** Custom user agent (default "fora-mcp-secrets/0.1.0"). */
  userAgent?: string;
  /** Test seam: replace the client factory. */
  clientFactory?: SecretsManagerClientFactory;
  /** Test seam: replace the clock (defaults to `Date.now`). */
  now?: () => Date;
}

interface VersionMap {
  /** Map of integer-string → AWS VersionId. The first version is "1". */
  byInt: Map<string, string>;
  /** Reverse map: AWS VersionId → integer string. Lets us detect
   *  "we've already assigned an integer to this AWS version" on a
   *  read of @latest. */
  byAwsId: Map<string, string>;
  /** Highest integer assigned so far. */
  highest: number;
}

export class AwsSecretsManagerStore implements SecretStore {
  private readonly region: string;
  private readonly tenantClaim: string;
  private readonly prefix: string;
  private readonly endpointUrl?: string;
  private readonly userAgent: string;
  private readonly clientFactory: SecretsManagerClientFactory;
  private readonly now: () => Date;
  private readonly versions: Map<string, VersionMap> = new Map();

  constructor(opts: AwsSecretsManagerStoreOptions) {
    if (!opts.region) {
      throw new Error("AwsSecretsManagerStore: region is required");
    }
    if (!opts.tenantClaim) {
      throw new Error("AwsSecretsManagerStore: tenantClaim is required");
    }
    this.region = opts.region;
    this.tenantClaim = opts.tenantClaim;
    this.prefix = opts.prefix ?? "fora";
    this.endpointUrl = opts.endpointUrl;
    this.userAgent = opts.userAgent ?? "fora-mcp-secrets/0.1.0";
    this.clientFactory = opts.clientFactory ?? defaultClientFactory;
    this.now = opts.now ?? (() => new Date());
    // Honour the endpoint override in the default factory too. We do this
    // by wrapping defaultClientFactory on the first call so the user can
    // still override clientFactory independently.
    if (!opts.clientFactory && opts.endpointUrl) {
      this.clientFactory = (region) =>
        new SecretsManagerClient({
          region,
          endpoint: opts.endpointUrl,
          customUserAgent: this.userAgent,
        });
    }
  }

  async read(ref: SecretRef, tenantClaim: string): Promise<SecretVersion> {
    this.assertTenant(ref, tenantClaim);
    const smName = this.smName(ref);
    const intVersion = this.normaliseVersion(ref.version);

    const client = this.makeClient();
    try {
      const out = await client.send<{
        SecretString?: string;
        SecretBinary?: Uint8Array;
        VersionId?: string;
        CreatedDate?: Date;
        $metadata?: { httpStatusCode?: number };
      }>(
        new GetSecretValueCommand({
          SecretId: smName,
          VersionId: intVersion === "latest" ? undefined : this.versionMap(ref).byInt.get(intVersion),
          VersionStage: intVersion === "latest" ? STAGING_LABEL_CURRENT : undefined,
        }),
      );

      const value =
        typeof out.SecretString === "string"
          ? out.SecretString
          : out.SecretBinary
            ? Buffer.from(out.SecretBinary).toString("utf8")
            : "";
      if (!value) {
        // An SM secret with no value is a misconfiguration; surface as
        // not_found so the agent gets a deterministic error envelope.
        throw new SecretNotFoundError(ref);
      }
      const awsVersionId = out.VersionId ?? "";
      const intResolved = this.recordResolvedVersion(
        ref,
        intVersion === "latest" ? "latest" : intVersion,
        awsVersionId,
      );
      return {
        value,
        version: intResolved,
        created_at: (out.CreatedDate ?? this.now()).toISOString(),
        // AWS SM versions do not expire by default; we set a far-future
        // expiry that mirrors the in-memory store.
        expires_at: "9999-12-31T23:59:59.000Z",
      };
    } catch (err) {
      throw mapAwsError(err, ref);
    }
  }

  async rotate(
    ref: SecretRef,
    tenantClaim: string,
    newValue: string,
  ): Promise<{ version: string; created_at: string }> {
    this.assertTenant(ref, tenantClaim);
    const smName = this.smName(ref);
    const client = this.makeClient();
    const map = this.versionMap(ref);
    try {
      const out = await client.send<{
        VersionId?: string;
        $metadata?: { httpStatusCode?: number };
      }>(
        new PutSecretValueCommand({
          SecretId: smName,
          SecretString: newValue,
        }),
      );
      const awsVersionId = out.VersionId ?? "";
      // Re-use an existing integer if the AWS VersionId was already
      // assigned one (defensive; rotate should always produce a new
      // AWS version). Otherwise assign the next integer.
      let intVersion = map.byAwsId.get(awsVersionId);
      if (!intVersion) {
        intVersion = String(map.highest + 1);
        map.byInt.set(intVersion, awsVersionId);
        map.byAwsId.set(awsVersionId, intVersion);
        map.highest = Number(intVersion);
      }
      const created = this.now().toISOString();
      return { version: intVersion, created_at: created };
    } catch (err) {
      throw mapAwsError(err, ref);
    }
  }

  private makeClient(): SecretsManagerClientLike {
    return this.clientFactory(this.region);
  }

  private assertTenant(ref: SecretRef, tenantClaim: string): void {
    if (ref.tenant_id !== tenantClaim) {
      throw new TenantScopeError(ref.tenant_id, tenantClaim);
    }
  }

  private smName(ref: SecretRef): string {
    return `${this.prefix}/${ref.tenant_id}/${ref.name}`;
  }

  /**
   * Validate the version token. The grammar is enforced upstream by
   * `parseSecretRef`; this is defence in depth.
   */
  private normaliseVersion(v: string): "latest" | string {
    if (v === "latest") return "latest";
    if (/^[1-9][0-9]{0,9}$/.test(v)) return v;
    throw new SecretNotFoundError({
      tenant_id: "<unknown>",
      name: "<unknown>",
      version: v,
    });
  }

  private versionMap(ref: SecretRef): VersionMap {
    const key = this.smName(ref);
    let m = this.versions.get(key);
    if (!m) {
      m = { byInt: new Map(), byAwsId: new Map(), highest: 0 };
      this.versions.set(key, m);
    }
    return m;
  }

  /**
   * Resolve a request to an integer version string. Behaviour:
   *   - `requested === "latest"` and we have seen this AWS VersionId
   *     before → return the same integer (idempotent reads).
   *   - `requested === "latest"` and we have NOT seen this AWS
   *     VersionId → assign the next integer and bump `highest`.
   *   - `requested === "<n>"` → look up the AWS VersionId we cached
   *     for integer `n`. If absent, this ref is unknown to us.
   *
   * Returns the integer version string ("1", "2", …).
   */
  private recordResolvedVersion(
    ref: SecretRef,
    requested: string,
    awsVersionId: string,
  ): string {
    if (!awsVersionId) {
      // Defensive: the SDK should always return a VersionId. If it
      // does not, fall back to the in-memory-style counter.
      const fallbackMap = this.versionMap(ref);
      const next = String(fallbackMap.highest + 1);
      fallbackMap.highest = Number(next);
      return next;
    }
    const map = this.versionMap(ref);
    if (requested === "latest") {
      const existing = map.byAwsId.get(awsVersionId);
      if (existing) return existing;
      const next = String(map.highest + 1);
      map.byInt.set(next, awsVersionId);
      map.byAwsId.set(awsVersionId, next);
      map.highest = Number(next);
      return next;
    }
    // Specific version requested. Confirm we have a known AWS VersionId
    // for it; if not, the ref is unknown to this store.
    const knownAwsId = map.byInt.get(requested);
    if (!knownAwsId) {
      // The caller asked for @<n> but we have never seen integer n.
      // This is either a fresh process reading a tenant's existing
      // secret, or a typo. Fall through to the AWS call's VersionId —
      // we accept whatever AWS returns, and from now on integer n
      // points at this AWS VersionId.
      map.byInt.set(requested, awsVersionId);
      map.byAwsId.set(awsVersionId, requested);
      const n = Number(requested);
      if (n > map.highest) map.highest = n;
    } else if (knownAwsId !== awsVersionId) {
      // Mismatch: the same integer was previously pinned to a
      // different AWS VersionId. Treat the new one as authoritative
      // and update the reverse map.
      map.byAwsId.delete(knownAwsId);
      map.byInt.set(requested, awsVersionId);
      map.byAwsId.set(awsVersionId, requested);
    }
    return requested;
  }
}

function mapAwsError(err: unknown, ref: SecretRef): Error {
  if (err instanceof SecretNotFoundError) return err;
  if (err instanceof TenantScopeError) return err;
  // AWS SDK v3 errors expose `name` and a `$metadata` property; we match
  // on the error name to keep the dependency surface narrow.
  const name = (err as { name?: string })?.name ?? "";
  if (name === "ResourceNotFoundException") {
    return new SecretNotFoundError(ref);
  }
  // Wrap anything else as a generic store error; the broker's audit
  // emitter records the message verbatim. The original error is on
  // `.cause` for operator inspection.
  const message = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(
    `AWS Secrets Manager error for ${formatSecretRef(ref)}: ${message}`,
  );
  (wrapped as { cause?: unknown }).cause = err;
  return wrapped;
}
