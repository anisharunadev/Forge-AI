# @fora/object-store

Tenant-scoped object store adapter. Refuses reads/writes that cross tenant boundaries at two layers:

1. **In-process** — every method takes a `RequestContext { tenant_id, principal, trace_id }` and rejects keys not matching `^tenants/{tenant_id}/...` with `KeyPrefixMismatchError` before any network call.
2. **Cloud-side** — every presigned URL and signed request carries the expected prefix in its signature and is bound to a per-tenant session tag (`TenantID=${tenant_id}`) so the IAM policy itself denies mismatches, not just our client.

The combination means: even if an attacker bypasses the in-process check, the cloud returns `AccessDenied`. Even if the in-process check is a bug, the cloud-side gate still holds.

## Adapters

- `ObjectStoreS3Adapter` — S3 (GetObject, PutObject, DeleteObject, ListObjectsV2, getSignedUrl)
- `ObjectStoreGcsAdapter` — GCS (get, save, delete, getSignedUrl via V4 signed URLs)
- `ObjectStoreSqsAdapter` — SQS (send, receive) — `MessageDeduplicationId` carries `tenant_id`
- `ObjectStoreOpenSearchAdapter` — OpenSearch (index, search, delete) — routing key + index-level `tenant_id` filter

## Bar #3 reference

Implements FORA-124 acceptance bar #3: an object key written to `tenants/tnt_A/...` is unreadable from a session bound to `tnt_B`, even with the full S3 client.

## Tests

```bash
pnpm -F @fora/object-store test
```

The test harness uses `aws-sdk-client-mock` to prove:

1. The adapter refuses a key under `tenants/tnt_A/...` when called with a `tenant_B` context (in-process gate).
2. A presigned URL issued for `tenants/tnt_A/...` is not valid for `tenants/tnt_B/...` (signature gate).
3. The per-tenant IAM policy returns `AccessDenied` for a `GetObject` or `PutObject` against the wrong prefix (cloud-side gate).

For an end-to-end LocalStack run that proves the cloud-side gate against real S3, see the runbook below.

## Related

- `infra/object-store/iam.tf` — the per-tenant IAM policy (the cloud-side gate).
- `docs/runbooks/object-store-tenant-isolation.md` — LocalStack recipe for the end-to-end test.
- FORA-124 — the parent epic.
- FORA-123 — claim format (this package's context is constructed from it).
