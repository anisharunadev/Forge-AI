/**
 * @fora/object-store — RequestContext, KeyPrefixMismatchError, and the
 * `assertTenantPrefix` guard.
 *
 * The whole package is a thin facade whose only security job is to enforce:
 *
 *   "Every key passed to a cloud SDK is exactly `tenants/{tenant_id}/...`
 *    where `tenant_id` is the one in `RequestContext`."
 *
 * The cloud-side IAM policy is the real gate (see infra/object-store/iam.tf).
 * The in-process check is the cheap, loud first line of defence; the
 * signature/presign step is the second. Defense in depth.
 */

import { z } from 'zod';

// ---- Schemas ---------------------------------------------------------------

/** The principal that initiated the action. Carried in audit log rows. */
export const PrincipalSchema = z.enum(['board_user', 'agent', 'cloud_operator']);
export type Principal = z.infer<typeof PrincipalSchema>;

/**
 * What every adapter method takes as its first argument.
 *
 * `tenant_id` MUST be the claim from the verified FORA session token (see
 * @fora/session-tokens). It is never derived from the key, the URL, the
 * request body, or any untrusted source.
 */
export const RequestContextSchema = z.object({
  tenant_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, 'tenant_id must match [a-zA-Z0-9_-]+'),
  principal: PrincipalSchema,
  trace_id: z.string().min(1).max(128),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;

// ---- Errors ---------------------------------------------------------------

/**
 * Thrown by `assertTenantPrefix` when a key does not start with the expected
 * `tenants/{tenant_id}/` prefix. The in-process gate fails closed.
 *
 * The adapter wraps this in a `tenancy.denied` audit event with the offending
 * key truncated to 64 chars for log safety (see audit log shape in
 * workspace/memory/security.md §7).
 */
export class KeyPrefixMismatchError extends Error {
  readonly code = 'KEY_PREFIX_MISMATCH' as const;
  readonly tenant_id: string;
  readonly key: string;
  /** Truncated to 64 chars for log safety. */
  readonly log_safe_key: string;

  constructor(args: { tenant_id: string; key: string; reason: string }) {
    super(
      `key_prefix_mismatch: ${args.reason} ` +
        `(tenant_id=${args.tenant_id}, key=${truncateKey(args.key)})`,
    );
    this.name = 'KeyPrefixMismatchError';
    this.tenant_id = args.tenant_id;
    this.key = args.key;
    this.log_safe_key = truncateKey(args.key);
  }
}

function truncateKey(key: string): string {
  if (key.length <= 64) return key;
  return `${key.slice(0, 64)}…`;
}

// ---- Prefix guard ---------------------------------------------------------

/** The single source of truth for the tenant prefix shape. */
export const TENANT_KEY_PREFIX = (tenant_id: string): string => `tenants/${tenant_id}/`;

/**
 * The regex every key must match: `^tenants/{tenant_id}/...`.
 *
 * We compile a fresh RegExp per call to avoid `lastIndex` state bugs. The
 * operation is cheap and called once per adapter method invocation.
 */
function prefixRegex(tenant_id: string): RegExp {
  // Escape `tenant_id` in case future tenants carry regex metacharacters.
  // Current schema restricts to [a-zA-Z0-9_-] so this is defence in depth.
  const escaped = tenant_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^tenants/${escaped}/`);
}

/**
 * Refuse a key that does not begin with `tenants/{tenant_id}/`.
 *
 * @throws {KeyPrefixMismatchError} when the key fails the prefix check.
 */
export function assertTenantPrefix(tenant_id: string, key: string): void {
  if (key.length === 0) {
    throw new KeyPrefixMismatchError({
      tenant_id,
      key,
      reason: 'empty key',
    });
  }
  if (key.includes('..')) {
    // Path-traversal guard. The prefix check would also catch it, but
    // surface a precise reason for the audit log.
    throw new KeyPrefixMismatchError({
      tenant_id,
      key,
      reason: 'key contains ".."',
    });
  }
  const re = prefixRegex(tenant_id);
  if (!re.test(key)) {
    throw new KeyPrefixMismatchError({
      tenant_id,
      key,
      reason: `key does not start with tenants/${tenant_id}/`,
    });
  }
}

// ---- Audit event shape ----------------------------------------------------

/**
 * The shape of the `tenancy.denied` audit event the adapter emits when a
 * key fails the prefix check. Matches the audit log entry format in
 * workspace/memory/security.md §7.1.
 */
export interface TenancyDeniedEvent {
  event: 'tenancy.denied';
  tenant_id: string;
  principal: Principal;
  trace_id: string;
  resource: 'object_store';
  operation: 's3.get' | 's3.put' | 's3.delete' | 's3.list' | 's3.sign' | 'gcs.get' | 'gcs.put' | 'gcs.delete' | 'gcs.sign' | 'sqs.send' | 'sqs.receive' | 'opensearch.index' | 'opensearch.search' | 'opensearch.delete';
  deny_reason: 'key_prefix_mismatch';
  /** Truncated to 64 chars for log safety. */
  log_safe_key: string;
  ts: string;
}
