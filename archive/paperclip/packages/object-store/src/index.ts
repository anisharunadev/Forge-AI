/**
 * @fora/object-store — public surface.
 *
 * Exposes:
 *   - `RequestContext`, `RequestContextSchema`, `PrincipalSchema`
 *   - `KeyPrefixMismatchError`
 *   - `assertTenantPrefix`, `TENANT_KEY_PREFIX`
 *   - `ObjectStoreS3Adapter`
 *   - `ObjectStoreGcsAdapter`
 *   - `ObjectStoreSqsAdapter`
 *   - `ObjectStoreOpenSearchAdapter`
 *   - `AuditSink`, `AuditEvent`, `stdoutSink`, `silentSink`
 *
 * Construction pattern:
 *
 *   const ctx: RequestContext = {
 *     tenant_id: claims.tenant_id,    // from verified FORA session token
 *     principal: claims.principal,
 *     trace_id: run.trace_id,
 *   };
 *   const s3 = new ObjectStoreS3Adapter({ bucket, region, assume_role_arn, audit_sink });
 *   await s3.getObject(ctx, `tenants/${ctx.tenant_id}/blob`);
 *
 * The adapter refuses the call with `KeyPrefixMismatchError` if the key
 * does not start with `tenants/${ctx.tenant_id}/`, and emits a
 * `tenancy.denied` audit event.
 */

export {
  PrincipalSchema,
  RequestContextSchema,
  KeyPrefixMismatchError,
  assertTenantPrefix,
  TENANT_KEY_PREFIX,
  type Principal,
  type RequestContext,
  type TenancyDeniedEvent,
} from './context.js';

export {
  stdoutSink,
  silentSink,
  type AuditSink,
  type AuditEvent,
} from './audit.js';

export {
  ObjectStoreS3Adapter,
  type ObjectStoreS3Config,
} from './s3.js';

export {
  ObjectStoreGcsAdapter,
  type ObjectStoreGcsConfig,
} from './gcs.js';

export {
  ObjectStoreSqsAdapter,
  type ObjectStoreSqsConfig,
  type SqsSendInput,
  type SqsReceivedMessage,
} from './sqs.js';

export {
  ObjectStoreOpenSearchAdapter,
  type ObjectStoreOpenSearchConfig,
  type OpenSearchIndexInput,
  type OpenSearchSearchInput,
  type OpenSearchSearchHit,
} from './opensearch.js';
