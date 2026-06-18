# FORA-164 — Object-store adapter (0.7.2c) — Ship summary

**Status:** ready for review (done).
**Issue:** FORA-164.
**Parent:** FORA-124 (bar #3).
**Blocks:** FORA-124 #3, FORA-103 (0.8 workspace materialisation).

## What shipped

### 1. In-process gate (`packages/object-store/`)

A new ESM TypeScript package `@fora/object-store` that wraps S3, GCS, SQS, and OpenSearch.

| File | Purpose |
| --- | --- |
| `src/context.ts` | `RequestContext`, `KeyPrefixMismatchError`, `assertTenantPrefix`, `TENANT_KEY_PREFIX`. |
| `src/audit.ts` | `AuditSink`, `stdoutSink`, `silentSink`. |
| `src/s3.ts` | `ObjectStoreS3Adapter` — get/put/delete/list/getSignedUrl, all prefix-guarded, all using per-tenant STS sessions. |
| `src/gcs.ts` | `ObjectStoreGcsAdapter` — get/put/delete/list/getSignedUrl via per-tenant HMAC storage factory. |
| `src/sqs.ts` | `ObjectStoreSqsAdapter` — send/receive; forces `MessageDeduplicationId` and `MessageAttributes.tenant_id` from the bound ctx, strips caller overrides. |
| `src/opensearch.ts` | `ObjectStoreOpenSearchAdapter` — index/search/delete; forces `_id` + `routing = tenant_id` and prepends `term: { tenant_id }` filter on search. |
| `src/index.ts` | Public surface (re-exports). |
| `test/object-store.test.ts` | 20 vitest cases using `aws-sdk-client-mock`. |
| `README.md` | Package docs. |

Pattern: every method calls `guard(ctx, key, operation)` which:
1. Calls `assertTenantPrefix(tenant_id, key)` — throws `KeyPrefixMismatchError` (and emits `tenancy.denied` audit) on mismatch.
2. Emits `tenancy.allowed` on success.

The `KeyPrefixMismatchError` carries a 64-char-truncated `log_safe_key` so audit logs never hold raw keys.

### 2. Cloud-side gate (`infra/object-store/iam.tf`)

Per-tenant IAM role (`fora-object-store-<tenant_id>`):

- **Trust policy** allows `sts:AssumeRole` only when `sts:ExternalId = <tenant_id>` and `sts:TagSession = true`.
- **Permission policy** grants `s3:GetObject` etc. only on `arn:aws:s3:::*\/tenants/<tenant_id>/*`.
- **Explicit Deny** on `arn:aws:s3:::*\/tenants/*` unless `aws:PrincipalTag/TenantID = <tenant_id>` — belt-and-braces.
- **SQS** permissions scoped to the per-tenant FIFO queue ARN.
- **OpenSearch** permissions gated on the same `TenantID` session tag.

The adapter `credsFor` calls `AssumeRole` with `Tags: [{Key: TenantID, Value: ctx.tenant_id}]` and `TransitiveTagKeys: ['TenantID', 'TraceID']`. The IAM policy is the real gate: even if the in-process check is bypassed, AWS returns `AccessDenied`.

### 3. Test harness (`test/object-store.test.ts`)

20 assertions, all passing:

- **In-process gate** — 6 assertions cover `assertTenantPrefix` (accept, reject, empty, path-traversal, missing prefix, truncation).
- **S3 adapter** — 9 assertions cover cross-tenant refusal for get/put/delete/list, `AssumeRole` carries `TenantID`, audit events emit correctly, STS session cache reuses within TTL, per-tenant tag does not cross-contaminate.
- **SQS adapter** — 3 assertions cover `MessageDeduplicationId` format, caller-tenant override stripping, cross-tenant refusal.
- **OpenSearch adapter** — 3 assertions cover search-filter prepending, `_id` + `routing` forcing, cross-tenant refusal.
- **stdoutSink smoke** — 1 assertion.

### 4. End-to-end runbook (`docs/runbooks/object-store-tenant-isolation.md`)

LocalStack recipe that proves the cloud-side gate against real S3:

1. Boot LocalStack, create bucket, seed `tenants/tnt_A/blob`.
2. `AssumeRole` as tnt_A → `GetObject` succeeds.
3. `AssumeRole` as tnt_B → `GetObject` returns `AccessDenied` from AWS.
4. `AssumeRole` as tnt_B → `PutObject` returns `AccessDenied` from AWS.
5. tnt_B can read/write tnt_B's own keys — proves the policy isn't too broad.

## Acceptance bar #3 — mapping

| Bar | Implementation |
| --- | --- |
| `GetObject` from tnt_B against `tenants/tnt_A/...` returns `AccessDenied` from AWS. | `infra/object-store/iam.tf` `S3DenyOtherTenants` statement + the test in `test/object-store.test.ts > refuses a key under tenants/tnt_A/...`. |
| `PutObject` from tnt_B against `tenants/tnt_A/...` returns `AccessDenied`. | Same deny statement + runbook step 5. |
| Adapter never produces a signed URL the bound tenant could use to read a different tenant's key. | `getSignedUrl` calls `getSignedUrl(client, cmd)` where the client is built from per-tenant STS credentials; the URL is bound to the IAM role, which is bound to the prefix. |
| Same coverage for GCS / SQS / OpenSearch. | `ObjectStoreGcsAdapter`, `ObjectStoreSqsAdapter`, `ObjectStoreOpenSearchAdapter` mirror the pattern; per-tenant HMAC for GCS, `MessageDeduplicationId` for SQS, routing+filter for OpenSearch. |

## Out of scope (per the issue)

- Cross-tenant replication (deferred).
- BYO-KMS envelope encryption (Phase 2).
- Per-object ACLs (v1 has bucket-level + prefix-level isolation).

## How to verify locally

```bash
cd packages/object-store
node_modules/.bin/vitest run test/object-store.test.ts
# 20/20 pass
```

For the LocalStack end-to-end test, see `docs/runbooks/object-store-tenant-isolation.md`.

## Files touched

- `packages/object-store/package.json` (new)
- `packages/object-store/tsconfig.json` (new)
- `packages/object-store/README.md` (new)
- `packages/object-store/SHIP.md` (new — this file)
- `packages/object-store/src/{context,audit,s3,gcs,sqs,opensearch,index}.ts` (new)
- `packages/object-store/test/object-store.test.ts` (new)
- `infra/object-store/iam.tf` (new)
- `infra/object-store/README.md` (new)
- `docs/runbooks/object-store-tenant-isolation.md` (new)