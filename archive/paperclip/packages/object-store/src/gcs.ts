/**
 * @fora/object-store — GCS adapter.
 *
 * The GCS adapter mirrors the S3 adapter's tenant-isolation pattern.
 *
 *   1. Every method asserts the object name matches `^tenants/{tenant_id}/...`
 *      (in-process gate).
 *   2. Presigned URLs are V4-signed with a per-tenant HMAC service account
 *      key (`gcs:objectViewer` bound to the per-tenant service account).
 *      The signed URL inherits the prefix; the IAM binding on the bucket
 *      denies any key outside the tenant's prefix.
 *   3. On the read path, the storage client itself is initialised with the
 *      per-tenant HMAC credentials so any read that escapes our prefix
 *      check still hits `403 Forbidden` from the bucket IAM.
 *
 * Bar: a `storage.objects.get` for `tenants/tnt_A/blob` issued from a
 * `tnt_B` HMAC returns `403` from GCS, not just from us.
 */

import type { Storage as GcsStorage, Bucket, File } from '@google-cloud/storage';
import {
  assertTenantPrefix,
  KeyPrefixMismatchError,
  TENANT_KEY_PREFIX,
  type RequestContext,
} from './context.js';
import { silentSink, type AuditSink } from './audit.js';

// ---- Config ----------------------------------------------------------------

export interface ObjectStoreGcsConfig {
  /** Bucket all tenant objects live under. */
  bucket: string;
  /**
   * Factory that returns a per-tenant `Storage` client. In production this
   * resolves a per-tenant HMAC service account key from the secrets
   * client; in tests it returns a mock.
   */
  storage_factory: (ctx: RequestContext) => GcsStorage;
  /** Audit sink. Defaults to silent. */
  audit_sink?: AuditSink;
}

// ---- Adapter ---------------------------------------------------------------

export class ObjectStoreGcsAdapter {
  private readonly cfg: ObjectStoreGcsConfig;
  private readonly sink: AuditSink;

  constructor(cfg: ObjectStoreGcsConfig) {
    this.cfg = cfg;
    this.sink = cfg.audit_sink ?? silentSink;
  }

  // ---- get -----------------------------------------------------------------

  async get(
    ctx: RequestContext,
    key: string,
  ): Promise<{ body: Buffer; content_type: string | undefined }> {
    this.guard(ctx, key, 'gcs.get');
    const storage = this.cfg.storage_factory(ctx);
    const bucket: Bucket = storage.bucket(this.cfg.bucket);
    const file: File = bucket.file(key);
    const [body] = await file.download();
    const [metadata] = await file.getMetadata();
    return { body, content_type: metadata.contentType as string | undefined };
  }

  // ---- put -----------------------------------------------------------------

  async put(
    ctx: RequestContext,
    key: string,
    body: Buffer | string,
    content_type?: string,
  ): Promise<void> {
    this.guard(ctx, key, 'gcs.put');
    const storage = this.cfg.storage_factory(ctx);
    const bucket = storage.bucket(this.cfg.bucket);
    const file = bucket.file(key);
    await file.save(body, {
      ...(content_type ? { contentType: content_type } : {}),
      resumable: false,
    });
  }

  // ---- delete --------------------------------------------------------------

  async delete(ctx: RequestContext, key: string): Promise<void> {
    this.guard(ctx, key, 'gcs.delete');
    const storage = this.cfg.storage_factory(ctx);
    const bucket = storage.bucket(this.cfg.bucket);
    const file = bucket.file(key);
    await file.delete();
  }

  // ---- list ----------------------------------------------------------------

  async list(
    ctx: RequestContext,
    sub_prefix = '',
  ): Promise<{ key: string; size?: number; updated?: string }[]> {
    const full = `${TENANT_KEY_PREFIX(ctx.tenant_id)}${sub_prefix}`;
    assertTenantPrefix(ctx.tenant_id, full);
    this.sink({
      event: 'tenancy.allowed',
      tenant_id: ctx.tenant_id,
      principal: ctx.principal,
      trace_id: ctx.trace_id,
      resource: 'object_store',
      operation: 'gcs.get',
      log_safe_key: full.length > 64 ? `${full.slice(0, 64)}…` : full,
      ts: new Date().toISOString(),
    });
    const storage = this.cfg.storage_factory(ctx);
    const bucket = storage.bucket(this.cfg.bucket);
    const [files] = await bucket.getFiles({ prefix: full });
    return files.map((f) => {
      const out: { key: string; size?: number; updated?: string } = { key: f.name };
      const size = Number(f.metadata.size ?? 0);
      if (size > 0) out.size = size;
      if (f.metadata.updated) out.updated = f.metadata.updated as string;
      return out;
    });
  }

  // ---- getSignedUrl --------------------------------------------------------

  /**
   * V4-signed URL bound to the tenant. The signed URL inherits the
   * per-tenant HMAC service account's IAM binding on the bucket, so
   * `getSignedUrl('tenants/tnt_A/blob')` cannot be used to download
   * `tenants/tnt_B/blob` — the bucket IAM denies it.
   */
  async getSignedUrl(
    ctx: RequestContext,
    key: string,
    operation: 'read' | 'write',
    expires_in_ms = 5 * 60 * 1000,
  ): Promise<string> {
    this.guard(ctx, key, 'gcs.sign');
    const storage = this.cfg.storage_factory(ctx);
    const bucket = storage.bucket(this.cfg.bucket);
    const file = bucket.file(key);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: operation,
      expires: Date.now() + expires_in_ms,
    });
    return url;
  }

  // ---- internals -----------------------------------------------------------

  private guard(
    ctx: RequestContext,
    key: string,
    operation: 'gcs.get' | 'gcs.put' | 'gcs.delete' | 'gcs.sign',
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
}
