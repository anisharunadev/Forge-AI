/**
 * `secret_ref` grammar for the FORA secrets-mcp.
 *
 * Per ADR-0003 §7, every secret is addressed by a stable, tenant-scoped
 * reference. The grammar is:
 *
 *     tenants/{tenant_id}/secrets/{name}@{version}
 *
 * where `version` is optional and defaults to `latest`. The grammar is
 * a closed surface: changing it is a one-way door (see ADR-0003 §10
 * sub-decision 4). A `secret_ref` is the *only* identifier an agent
 * sees; raw values never cross the broker boundary.
 *
 * Why a structured grammar instead of an opaque ARN:
 *   - The broker can parse, validate, and (where it must) rewrite the
 *     ref without leaking tenant identity to a downstream SDK.
 *   - The same parser runs at the model boundary, in CI lint rules,
 *     and in the audit emitter — one source of truth.
 *   - The grammar is forward-compatible: a future ADR may add
 *     `tenants/{tid}/vault/{vault}/secrets/{name}@{version}` for a
 *     Vault backing store without breaking existing refs.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Character set for the tenant_id. We allow the FORA tenant-id shape
 * (alphanumeric, underscore, dash; first char must be a letter or
 * digit). Tenant ids are minted by the identity broker (see FORA-123);
 * this regex is the parser's safety net, not the source of truth.
 */
const TenantIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "tenant_id must match /^[A-Za-z0-9][A-Za-z0-9_-]*$/");

/**
 * Character set for a secret `name`. A name is opaque to the broker —
 * it is the per-tenant name the customer assigned when provisioning
 * the secret. We allow letters, digits, underscore, dash, dot, and
 * forward slash (so tenants can namespace, e.g. `ci/github_pat`).
 */
const SecretNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/, "secret name must match /^[A-Za-z0-9][A-Za-z0-9_./-]*$/");

/**
 * Version grammar. Either a positive integer (1, 2, 3, …) or the
 * literal "latest". AWS Secrets Manager uses AWSCURRENT / AWSPREVIOUS
 * style labels; we normalise to a positive integer when the backing
 * store is AWS SM and to a string when the backing store is Vault
 * (future ADR). The grammar is one-way; do not change without an ADR.
 */
const VersionSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (v) => v === "latest" || /^[1-9][0-9]{0,9}$/.test(v),
    "version must be 'latest' or a positive integer (1, 2, …)",
  );

const SecretRefSchema = z
  .object({
    tenant_id: TenantIdSchema,
    name: SecretNameSchema,
    version: VersionSchema,
  })
  .strict();

export type SecretRef = z.infer<typeof SecretRefSchema>;
export type SecretVersion = SecretRef["version"];

export function parseSecretRef(input: string): SecretRef {
  // We accept a leading `secrets/` (the customer-facing form) or a
  // bare `tenants/{tid}/secrets/{name}@{version}`. Both reduce to
  // the same internal form before validation.
  const raw = input.trim();
  const candidates: string[] = [];
  if (raw.startsWith("secrets/")) {
    candidates.push(`tenants/_local/${raw}`);
  }
  candidates.push(raw);

  for (const candidate of candidates) {
    // Format: tenants/{tid}/secrets/{name}@{version}
    //   prefix     : "tenants/"
    //   tenant_id  : up to "secrets/"
    //   name       : up to "@"
    //   version    : after "@" (optional — default to "latest")
    const m = candidate.match(/^tenants\/([^/]+)\/secrets\/([^/@]+)(?:@(.+))?$/);
    if (!m) continue;
    const [, tenant_id, name, version] = m;
    const parsed = SecretRefSchema.safeParse({
      tenant_id,
      name,
      version: version ?? "latest",
    });
    if (parsed.success) return parsed.data;
  }

  throw new SecretRefError(
    `Invalid secret_ref: ${JSON.stringify(input)}. ` +
      `Expected tenants/{tenant_id}/secrets/{name}@{version} ` +
      `(version optional; default "latest").`,
  );
}

export function formatSecretRef(ref: SecretRef): string {
  return `tenants/${ref.tenant_id}/secrets/${ref.name}@${ref.version}`;
}

export class SecretRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretRefError";
  }
}

/**
 * Fingerprint is a short, non-reversible identifier of a resolved
 * secret value. It is what the agent sees in the redacted envelope
 * and what the audit log records next to the `secret_ref`. v1 is
 * hex-encoded SHA-256, truncated to 16 chars (64 bits) — enough
 * collision resistance for an audit trail without exposing the
 * raw value via a long digest.
 */
export function fingerprint(value: string): string {
  // Node's crypto module is the only standard lib we have at this
  // layer; the web-crypto equivalent is intentionally not used here
  // because the secrets-mcp runs in Node, not a browser.
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/**
 * Redacted envelope — what the agent sees in the `resolve` response.
 * The raw value is NEVER included. The shape is fixed by ADR-0003 §7.2
 * and is the contract every backing store must honour.
 */
export interface RedactedSecret {
  /** Always `true` for a resolve result. A future `peek` tool may return `false`. */
  redacted: true;
  /** The canonical secret_ref, reformatted by the parser. */
  secret_ref: string;
  /** Byte length of the resolved value (UTF-8). */
  value_len: number;
  /** Non-reversible 16-char hex digest of the resolved value. */
  fingerprint: string;
  /** ISO-8601 expiry of the resolved value (backing-store defined). */
  expires_at: string;
  /** Resolution timestamp (broker clock, ISO-8601). */
  resolved_at: string;
  /** Version that was actually resolved (the integer or "latest"). */
  version: string;
}

export function redact(ref: SecretRef, rawValue: string, expiresAt: string): RedactedSecret {
  return {
    redacted: true,
    secret_ref: formatSecretRef(ref),
    value_len: Buffer.byteLength(rawValue, "utf8"),
    fingerprint: fingerprint(rawValue),
    expires_at: expiresAt,
    resolved_at: new Date().toISOString(),
    version: ref.version,
  };
}
