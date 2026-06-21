/**
 * @fora/object-store — S3 adapter.
 *
 * The S3 adapter is the reference implementation of the FORA tenant-isolation
 * pattern. Every method:
 *
 *   1. Asserts the key matches `^tenants/{tenant_id}/...` (in-process gate).
 *   2. Sends the request with a credential provider that `sts:AssumeRole`s
 *      into the per-tenant role with `TenantID=${tenant_id}` as a session
 *      tag. The IAM policy at infra/object-store/iam.tf is the cloud-side
 *      gate — it grants `s3:GetObject` etc. only on
 *      `arn:aws:s3:::*\/tenants/${aws:PrincipalTag/TenantID}/*`.
 *   3. For presigned URLs, signs the expected prefix into the request via
 *      the same role. The role's `sts:AssumeRole` carries the session tag
 *      so the signed URL inherits the prefix bound.
 *
 * The bar: a `GetObject` for `tenants/tnt_A/blob` issued from a `tnt_B`
 * session returns `AccessDenied` from AWS itself, not just from us.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import {
  assertTenantPrefix,
  KeyPrefixMismatchError,
  TENANT_KEY_PREFIX,
  type RequestContext,
} from './context.js';
import { silentSink, type AuditSink } from './audit.js';

// ---- Config ----------------------------------------------------------------

export interface ObjectStoreS3Config {
  /** Bucket all tenant objects live under. */
  bucket: string;
  /** Region the bucket + STS live in. */
  region: string;
  /**
   * ARN of the per-tenant role the adapter assumes. The trust policy
   * allows the calling principal to `sts:AssumeRole` only with the
   * `TenantID` session tag set; see infra/object-store/iam.tf.
   */
  assume_role_arn: string;
  /**
   * Optional injected clients. Production should rely on the default
   * credential provider chain; tests inject mocks.
   */
  s3_client_factory?: (creds: { accessKeyId: string; secretAccessKey: string; sessionToken: string }) => S3Client;
  sts_client?: STSClient;
  /** Audit sink. Defaults to silent. Production wires this to the audit log. */
  audit_sink?: AuditSink;
}

// ---- Adapter ---------------------------------------------------------------

/**
 * Per-tenant, per-method credential cache. The role session is short-lived
 * (≤ 15 min) and reused until expiry. Keys are `${role_arn}|${tenant_id}`.
 */
interface CachedCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** Epoch ms when this credential set expires. */
  expires_at_ms: number;
}

const SESSION_DURATION_SECONDS = 15 * 60;

export class ObjectStoreS3Adapter {
  private readonly cfg: ObjectStoreS3Config;
  private readonly sts: STSClient;
  private readonly credsCache = new Map<string, CachedCreds>();
  private readonly sink: AuditSink;

  constructor(cfg: ObjectStoreS3Config) {
    this.cfg = cfg;
    this.sts = cfg.sts_client ?? new STSClient({ region: cfg.region });
    this.sink = cfg.audit_sink ?? silentSink;
  }

  // ---- getObject -----------------------------------------------------------

  async getObject(ctx: RequestContext, key: string): Promise<{
    body: ReadableStream<Uint8Array> | null;
    content_type: string | undefined;
    content_length: number | undefined;
  }> {
    this.guard(ctx, key, 's3.get');
    const client = await this.clientFor(ctx);
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    return {
      body: (res.Body?.transformToWebStream() ?? null) as ReadableStream<Uint8Array> | null,
      content_type: res.ContentType,
      content_length: res.ContentLength,
    };
  }

  // ---- putObject -----------------------------------------------------------

  async putObject(
    ctx: RequestContext,
    key: string,
    body: Uint8Array | string,
    content_type?: string,
  ): Promise<void> {
    this.guard(ctx, key, 's3.put');
    const client = await this.clientFor(ctx);
    await client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ...(content_type ? { ContentType: content_type } : {}),
      }),
    );
  }

  // ---- deleteObject --------------------------------------------------------

  async deleteObject(ctx: RequestContext, key: string): Promise<void> {
    this.guard(ctx, key, 's3.delete');
    const client = await this.clientFor(ctx);
    await client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
  }

  // ---- listObjects ---------------------------------------------------------

  /**
   * Lists keys under the tenant's prefix. The `prefix` argument is appended
   * to the tenant's mandatory prefix; passing an empty string lists the
   * tenant's full namespace.
   */
  async listObjects(
    ctx: RequestContext,
    sub_prefix = '',
    max_keys = 1000,
  ): Promise<{ key: string; size?: number; etag?: string }[]> {
    // Build the full prefix under the tenant's namespace, then assert it.
    const full = `${TENANT_KEY_PREFIX(ctx.tenant_id)}${sub_prefix}`;
    assertTenantPrefix(ctx.tenant_id, full);
    const client = await this.clientFor(ctx);
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: this.cfg.bucket,
        Prefix: full,
        MaxKeys: max_keys,
      }),
    );
    return (res.Contents ?? []).map((o) => {
      const out: { key: string; size?: number; etag?: string } = { key: o.Key ?? '' };
      if (o.Size !== undefined) out.size = o.Size;
      if (o.ETag !== undefined) out.etag = o.ETag;
      return out;
    });
  }

  // ---- getSignedUrl --------------------------------------------------------

  /**
   * Presigned URL bound to the tenant. The signing credential carries the
   * `TenantID` session tag; the IAM policy checks the session tag and
   * rejects any key outside `tenants/${TenantID}/`. A URL signed for
   * `tenants/tnt_A/...` cannot be used to GET `tenants/tnt_B/...` because
   * the URL is short-lived and the role only allows the bound prefix.
   */
  async getSignedUrl(
    ctx: RequestContext,
    key: string,
    operation: 'get' | 'put',
    expires_in_seconds = 300,
  ): Promise<string> {
    this.guard(ctx, key, 's3.sign');
    const client = await this.clientFor(ctx);
    const cmd =
      operation === 'get'
        ? new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key })
        : new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key });
    return getSignedUrl(client, cmd, { expiresIn: expires_in_seconds });
  }

  // ---- internals -----------------------------------------------------------

  /**
   * The single point of failure-closed tenant enforcement. Throws before
   * any cloud SDK call. Emits a `tenancy.denied` audit event on failure
   * and a `tenancy.allowed` event on success.
   */
  private guard(
    ctx: RequestContext,
    key: string,
    operation:
      | 's3.get' | 's3.put' | 's3.delete' | 's3.list' | 's3.sign'
      | 'gcs.get' | 'gcs.put' | 'gcs.delete' | 'gcs.sign'
      | 'sqs.send' | 'sqs.receive'
      | 'opensearch.index' | 'opensearch.search' | 'opensearch.delete',
  ): void {
    try {
      assertTenantPrefix(ctx.tenant_id, key);
    } catch (err) {
      if (err instanceof KeyPrefixMismatchError) {
        this.sink({
          event: 'tenancy.denied',
          tenant_id: ctx.tenant_id,
          principal: ctx.principal,
          trace_id: ctx.trace_id,
          resource: 'object_store',
          operation,
          deny_reason: 'key_prefix_mismatch',
          log_safe_key: err.log_safe_key,
          ts: new Date().toISOString(),
        });
      }
      throw err;
    }
    this.sink({
      event: 'tenancy.allowed',
      tenant_id: ctx.tenant_id,
      principal: ctx.principal,
      trace_id: ctx.trace_id,
      resource: 'object_store',
      operation,
      log_safe_key: key.length > 64 ? `${key.slice(0, 64)}…` : key,
      ts: new Date().toISOString(),
    });
  }

  /**
   * Build (or reuse) a per-tenant S3 client whose credentials come from
   * `sts:AssumeRole` with the `TenantID` session tag.
   *
   * The `RoleSessionName` carries the trace_id so CloudTrail rows for the
   * assumed role are joinable back to the run.
   */
  private async clientFor(ctx: RequestContext): Promise<S3Client> {
    const creds = await this.credsFor(ctx);
    const factory =
      this.cfg.s3_client_factory ??
      ((c) => new S3Client({ region: this.cfg.region, credentials: c }));
    return factory(creds);
  }

  private async credsFor(ctx: RequestContext): Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  }> {
    const cache_key = `${this.cfg.assume_role_arn}|${ctx.tenant_id}`;
    const cached = this.credsCache.get(cache_key);
    const now = Date.now();
    if (cached && cached.expires_at_ms - 60_000 > now) {
      return {
        accessKeyId: cached.accessKeyId,
        secretAccessKey: cached.secretAccessKey,
        sessionToken: cached.sessionToken,
      };
    }

    // Resolve the calling principal's base credentials. In production this
    // is the agent-runtime service role; in tests the STS client is
    // mocked and we do not need real base creds, so the failure is
    // intentionally non-fatal.
    try {
      await defaultProvider()();
    } catch {
      // No base credentials in the environment. The injected STS client
      // (if any) is responsible for its own auth — production callers
      // always configure the STS client with the runtime service role.
    }

    const res = await this.sts.send(
      new AssumeRoleCommand({
        RoleArn: this.cfg.assume_role_arn,
        RoleSessionName: `fora-${ctx.tenant_id}-${ctx.trace_id}`.slice(0, 64),
        DurationSeconds: SESSION_DURATION_SECONDS,
        // The session tag is the contract with the IAM policy. The policy
        // refuses any role session that does not carry TenantID, so an
        // attacker cannot AssumeRole without naming a tenant.
        Tags: [
          { Key: 'TenantID', Value: ctx.tenant_id },
          { Key: 'TraceID', Value: ctx.trace_id },
        ],
        // Tag propagation so any downstream call inherits the tag.
        TransitiveTagKeys: ['TenantID', 'TraceID'],
      }),
    );

    if (!res.Credentials) {
      throw new Error(`AssumeRole returned no credentials for ${ctx.tenant_id}`);
    }
    const creds: CachedCreds = {
      accessKeyId: res.Credentials.AccessKeyId!,
      secretAccessKey: res.Credentials.SecretAccessKey!,
      sessionToken: res.Credentials.SessionToken!,
      expires_at_ms: res.Credentials.Expiration!.getTime(),
    };
    this.credsCache.set(cache_key, creds);
    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    };
  }
}
