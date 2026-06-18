/**
 * Cloud-side simulator.
 *
 * Wraps the IAM policy evaluator with the wire-level error shapes
 * the real AWS / GCS / SQS / OpenSearch APIs return when a request is
 * denied at the cloud boundary.
 *
 * Purpose: the in-process adapter test in object-store.test.ts proves
 * the in-process guard fires before any cloud SDK call. This module
 * proves the *cloud* (the thing the in-process guard is defending in
 * depth against) ALSO denies the request, with the exact error code a
 * real caller would see.
 *
 * Faithful error shapes:
 *
 *   S3 (GetObject/PutObject): NoSuchKey / AccessDenied — see
 *     https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
 *
 *   SQS (SendMessage): AccessDeniedException — see
 *     https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/CommonErrors.html
 *
 *   OpenSearch (ESHttp*): User is not authorized — see
 *     https://docs.aws.amazon.com/opensearch-service/latest/developerguide/security.html
 *
 *   GCS HMAC scope: 403 Forbidden with `storage.objects.get` denied
 *     because the HMAC service account's IAM role does not grant
 *     `roles/storage.objectViewer` on that bucket prefix.
 *
 * The simulator is not a network server — it returns plain objects
 * with the AWS-shaped error code so the test can assert against it.
 */

import {
  evaluate,
  type AuthzDecision,
  type IamPolicy,
} from './iam-policy.js';

// ---- Common error shape ---------------------------------------------------

export interface CloudError {
  code: string;
  status: number;
  message: string;
  /** The decision that produced the denial (for diagnostics). */
  decision: AuthzDecision;
}

export class CloudAccessDeniedError extends Error {
  readonly code: string;
  readonly status: number;
  readonly decision: AuthzDecision;
  constructor(err: CloudError) {
    super(err.message);
    this.name = 'CloudAccessDeniedError';
    this.code = err.code;
    this.status = err.status;
    this.decision = err.decision;
  }
}

// ---- Session tag binding --------------------------------------------------

/**
 * The per-tenant STS session. The cloud-side IAM policy is evaluated
 * with this tag set. For FORA, `TenantID` is the gate.
 */
export interface StsSession {
  tenant_id: string;
  session_name: string;
  expires_at_ms: number;
}

// ---- S3 -------------------------------------------------------------------

export interface S3GetObjectRequest {
  bucket: string;
  key: string;
  session: StsSession;
}

export interface S3PutObjectRequest extends S3GetObjectRequest {
  body: Uint8Array | string;
}

/**
 * S3 GetObject evaluated against the per-tenant permission policy.
 * Returns the synthetic response body, or throws CloudAccessDeniedError
 * with code 'AccessDenied' (matching the real AWS error response).
 */
export function s3GetObject(
  policy: IamPolicy,
  req: S3GetObjectRequest,
): { body: Uint8Array } {
  const decision = evaluate(policy, {
    action: 's3:GetObject',
    resource: `arn:aws:s3:::${req.bucket}/${req.key}`,
    context: {
      'aws:PrincipalTag/TenantID': req.session.tenant_id,
      // s3:prefix condition key for ListBucket — not used here, but
      // populated for parity with the real request envelope.
      's3:prefix': req.key,
    },
  });
  if (!decision.allowed) {
    throw new CloudAccessDeniedError({
      code: 'AccessDenied',
      status: 403,
      message:
        `An error occurred (AccessDenied) when calling the GetObject operation: ` +
        `User: arn:aws:sts::123456789012:assumed-role/fora-object-store-${req.session.tenant_id}/${req.session.session_name} ` +
        `is not authorized to perform: s3:GetObject on resource: "arn:aws:s3:::${req.bucket}/${req.key}" ` +
        `(${decision.reason}${decision.matchedSid ? `: ${decision.matchedSid}` : ''})`,
      decision,
    });
  }
  // Synthetic response body.
  return { body: new TextEncoder().encode(`s3:${req.bucket}/${req.key}`) };
}

export function s3PutObject(
  policy: IamPolicy,
  req: S3PutObjectRequest,
): void {
  const decision = evaluate(policy, {
    action: 's3:PutObject',
    resource: `arn:aws:s3:::${req.bucket}/${req.key}`,
    context: {
      'aws:PrincipalTag/TenantID': req.session.tenant_id,
      's3:prefix': req.key,
    },
  });
  if (!decision.allowed) {
    throw new CloudAccessDeniedError({
      code: 'AccessDenied',
      status: 403,
      message:
        `An error occurred (AccessDenied) when calling the PutObject operation: ` +
        `User: arn:aws:sts::123456789012:assumed-role/fora-object-store-${req.session.tenant_id}/${req.session.session_name} ` +
        `is not authorized to perform: s3:PutObject on resource: "arn:aws:s3:::${req.bucket}/${req.key}" ` +
        `(${decision.reason}${decision.matchedSid ? `: ${decision.matchedSid}` : ''})`,
      decision,
    });
  }
}

// ---- SQS ------------------------------------------------------------------

/**
 * SQS SendMessage evaluated against the per-tenant policy.
 *
 * In production, SQS SendMessage's tenant isolation is two-fold:
 *
 *   1. The caller principal must have sqs:SendMessage on the queue
 *      ARN (IAM-level — this is what we simulate here).
 *   2. The consumer must reject messages whose MessageAttributes.tenant_id
 *      does not match the bound session (handled by the adapter's
 *      `receive` path's caller — outside cloud IAM).
 *
 * The per-tenant IAM scope here is the queue ARN, not the message
 * attributes. The runtime queues are split per-tenant (FORA-164 scope).
 */
export interface SqsSendMessageRequest {
  queue_arn: string;
  message_body: string;
  message_attributes: Record<string, { DataType: 'String'; StringValue: string }>;
  session: StsSession;
}

export interface SqsSendMessageResult {
  message_id: string;
}

export function sqsSendMessage(
  policy: IamPolicy,
  req: SqsSendMessageRequest,
): SqsSendMessageResult {
  const decision = evaluate(policy, {
    action: 'sqs:SendMessage',
    resource: req.queue_arn,
    context: {
      'aws:PrincipalTag/TenantID': req.session.tenant_id,
    },
  });
  if (!decision.allowed) {
    throw new CloudAccessDeniedError({
      code: 'AccessDeniedException',
      status: 403,
      message:
        `An error occurred (AccessDeniedException) when calling the SendMessage operation: ` +
        `User: arn:aws:sts::123456789012:assumed-role/fora-object-store-${req.session.tenant_id}/${req.session.session_name} ` +
        `is not authorized to perform: sqs:SendMessage on resource: "${req.queue_arn}" ` +
        `(${decision.reason}${decision.matchedSid ? `: ${decision.matchedSid}` : ''})`,
      decision,
    });
  }
  // Synthetic message id; the MessageDeduplicationId is part of the
  // adapter's request envelope (verified separately in the unit test).
  return { message_id: 'm-' + Math.random().toString(36).slice(2, 10) };
}

// ---- OpenSearch -----------------------------------------------------------

/**
 * OpenSearch tenant isolation has two layers:
 *
 *   1. The IAM-level gate: es:ESHttp* on the domain ARN, gated on the
 *      TenantID session tag (mirrors iam.tf OpenSearchTenantDomain).
 *
 *   2. The query-level gate: document-level security (DLS) and the
 *      routing=tenant_id enforced by the adapter. We model (2) here
 *      by checking that the search body's bool.filter includes
 *      `term: { tenant_id }`.
 *
 * For the verification we test (1) AND that the consumer-side index
 * does not contain tenant-B docs reachable by a tenant-A query —
 * which is a property of the routing key + filter, evaluated below.
 */
export interface OpenSearchIndexRequest {
  domain_arn: string;
  index: string;
  doc_id: string;
  routing: string;
  body: { tenant_id: string };
  session: StsSession;
}

export interface OpenSearchSearchRequest {
  domain_arn: string;
  index: string;
  routing: string;
  query: {
    bool: {
      filter: { term: { tenant_id: string } }[];
    };
  };
  /** Synthetic docs that the index "contains". The test seeds both tenants. */
  docs: Array<{ id: string; tenant_id: string; body: unknown }>;
  session: StsSession;
}

export function openSearchIndex(
  policy: IamPolicy,
  req: OpenSearchIndexRequest,
): { result: 'created' } {
  const decision = evaluate(policy, {
    action: 'es:ESHttpPut',
    resource: req.domain_arn,
    context: {
      'aws:PrincipalTag/TenantID': req.session.tenant_id,
    },
  });
  if (!decision.allowed) {
    throw new CloudAccessDeniedError({
      code: 'security_exception',
      status: 403,
      message:
        `OpenSearch Security Plugin: User: arn:aws:sts::123456789012:assumed-role/fora-object-store-${req.session.tenant_id}/${req.session.session_name} ` +
        `is not authorized to perform: es:ESHttpPut on resource: "${req.domain_arn}" ` +
        `(${decision.reason}${decision.matchedSid ? `: ${decision.matchedSid}` : ''})`,
      decision,
    });
  }
  // Validate the routing key matches the session tenant — this is the
  // second line of defence: even if IAM let the request through, the
  // routing value binds the document to a shard that other tenants
  // cannot address.
  if (req.routing !== req.session.tenant_id) {
    throw new CloudAccessDeniedError({
      code: 'security_exception',
      status: 403,
      message:
        `OpenSearch routing mismatch: session tenant_id=${req.session.tenant_id} ` +
        `but routing=${req.routing}. Index rejects cross-tenant routing.`,
      decision: {
        allowed: false,
        reason: 'explicit_deny',
        matchedSid: 'OpenSearchRoutingBinding',
      },
    });
  }
  return { result: 'created' };
}

/**
 * OpenSearch search. The query MUST carry a `term: { tenant_id }`
 * filter; otherwise the index refuses. The cloud returns 0 hits that
 * belong to other tenants (the term filter is the gate; routing is
 * the optimisation).
 */
export function openSearchSearch(
  policy: IamPolicy,
  req: OpenSearchSearchRequest,
): { hits: Array<{ id: string; tenant_id: string }> } {
  // IAM gate first.
  const decision = evaluate(policy, {
    action: 'es:ESHttpPost',
    resource: req.domain_arn,
    context: {
      'aws:PrincipalTag/TenantID': req.session.tenant_id,
    },
  });
  if (!decision.allowed) {
    throw new CloudAccessDeniedError({
      code: 'security_exception',
      status: 403,
      message:
        `OpenSearch Security Plugin: User is not authorized to perform: es:ESHttpPost on resource: "${req.domain_arn}"`,
      decision,
    });
  }
  // DLS / routing gate — the consumer-side filter must equal the
  // session tenant. If the body does not carry the filter, the index
  // refuses the request.
  const filter = req.query.bool.filter.find((f) => 'term' in f);
  const filterTenant = filter?.term.tenant_id;
  if (!filterTenant) {
    throw new CloudAccessDeniedError({
      code: 'security_exception',
      status: 403,
      message: 'OpenSearch: missing tenant_id filter in bool.filter',
      decision: {
        allowed: false,
        reason: 'explicit_deny',
        matchedSid: 'OpenSearchDLS',
      },
    });
  }
  if (filterTenant !== req.session.tenant_id) {
    throw new CloudAccessDeniedError({
      code: 'security_exception',
      status: 403,
      message:
        `OpenSearch DLS: query tenant_id=${filterTenant} does not match session tenant_id=${req.session.tenant_id}`,
      decision: {
        allowed: false,
        reason: 'explicit_deny',
        matchedSid: 'OpenSearchDLS',
      },
    });
  }
  // Apply the filter against the synthetic docs.
  const hits = req.docs
    .filter((d) => d.tenant_id === filterTenant && d.id.startsWith(req.index))
    .map((d) => ({ id: d.id, tenant_id: d.tenant_id }));
  return { hits };
}

// ---- GCS ------------------------------------------------------------------

/**
 * GCS HMAC-key scope binding.
 *
 * GCS does not have IAM in the AWS sense; it has IAM roles on buckets
 * bound to HMAC service-account keys. The closest analogue to the
 * per-tenant IAM policy is: each tenant has its own HMAC key, whose
 * service account is granted `roles/storage.objectViewer` on
 * `tenants/<tenant_id>/**` only.
 *
 * The verifier below mirrors that: given an HMAC-key-bound request,
 * does the bucket IAM allow the operation on the requested prefix?
 *
 * Faithful error shape: 403 Forbidden with
 * `storage.objects.get access denied` for the bucket + object.
 */
export interface GcsHmacKey {
  /** The tenant this HMAC key is bound to. */
  tenant_id: string;
  /** The roles granted on the bucket. Mirrors the bucket IAM binding. */
  bucket_role_bindings: Array<{
    bucket: string;
    /** glob on the object name, e.g. `tenants/tnt_A/*` */
    object_name_pattern: string;
    /** The set of GCS roles this binding grants. */
    roles: Array<'roles/storage.objectViewer' | 'roles/storage.objectCreator'>;
  }>;
}

export interface GcsGetObjectRequest {
  bucket: string;
  object_name: string;
  hmac_key: GcsHmacKey;
}

export function gcsGetObject(req: GcsGetObjectRequest): { body: Uint8Array } {
  // 1. HMAC key tenant must match the object's tenant prefix.
  // GCS does not enforce this directly, but the bucket IAM binding
  // scopes the role to a single tenant's prefix. A key whose tenant
  // is tnt_B cannot resolve `tenants/tnt_A/...` because no binding
  // matches.
  const binding = req.hmac_key.bucket_role_bindings.find(
    (b) => b.bucket === req.bucket && matchPattern(b.object_name_pattern, req.object_name),
  );
  if (!binding) {
    throw new CloudAccessDeniedError({
      code: '403 Forbidden',
      status: 403,
      message:
        `gcs: storage.objects.get access denied. ` +
        `HMAC key bound to tenant_id=${req.hmac_key.tenant_id} cannot access object ${req.bucket}/${req.object_name} — no IAM binding matches.`,
      decision: {
        allowed: false,
        reason: 'no_matching_statement',
      },
    });
  }
  if (!binding.roles.includes('roles/storage.objectViewer')) {
    throw new CloudAccessDeniedError({
      code: '403 Forbidden',
      status: 403,
      message:
        `gcs: HMAC key for tenant_id=${req.hmac_key.tenant_id} lacks roles/storage.objectViewer on ${req.bucket}/${req.object_name}.`,
      decision: {
        allowed: false,
        reason: 'explicit_deny',
        matchedSid: 'GcsMissingObjectViewerRole',
      },
    });
  }
  return { body: new TextEncoder().encode(`gcs:${req.bucket}/${req.object_name}`) };
}

/** Minimal GCS-flavoured glob matcher (no `?`, just `*`). */
function matchPattern(pattern: string, value: string): boolean {
  let re = '^';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (/[.+^${}()|[\]\\]/.test(ch)) re += '\\' + ch;
    else re += ch;
  }
  re += '$';
  return new RegExp(re).test(value);
}

// ---- Backend label helpers ------------------------------------------------

/** Canonical error code per backend for assertion-friendly comparison. */
export type BackendName = 's3' | 'sqs' | 'opensearch' | 'gcs';
