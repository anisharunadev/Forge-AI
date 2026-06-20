# infra/object-store — per-tenant IAM policy

The Terraform in this directory is the **cloud-side gate** for Forge AI-124 acceptance bar #3. The in-process gate lives in `packages/object-store/`.

## What it does

For each tenant, it creates one IAM role (`fora-object-store-<tenant_id>`) whose:

- **Trust policy** allows the Forge AI agent runtime to `sts:AssumeRole`, but only with the `TenantID` session tag set (enforced via `sts:TagSession` + `sts:ExternalId`).
- **Permission policy** grants `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` only on `arn:aws:s3:::*\/tenants/${var.tenant_id}/*`. Any access to a different tenant's prefix is explicitly denied.
- **SQS + OpenSearch** permissions are gated on the same `TenantID` session tag.

A role that does not carry the `TenantID` session tag (or carries the wrong one) is denied at the IAM layer — even if our in-process prefix check is bypassed.

## Usage

```hcl
module "object_store_iam" {
  source      = "./infra/object-store"
  tenant_id   = "tnt_acme"
  object_store_bucket_arn = "arn:aws:s3:::fora-prod-object-store"
  object_store_bucket_name = "fora-prod-object-store"
  sqs_queue_arn            = "arn:aws:sqs:us-east-1:111122223333:fora-prod-tnt-acme.fifo"
  opensearch_domain_arn    = "arn:aws:es:us-east-1:111122223333:fora-prod-search"
  agent_runtime_principal_arn = "arn:aws:iam::111122223333:role/fora-prod-agent-runtime"
}

# The runtime uses the role ARN like this:
#   new STSClient().send(new AssumeRoleCommand({
#     RoleArn: module.object_store_iam.role_arn,
#     RoleSessionName: "fora-tnt_acme-<trace_id>",
#     Tags: [{ Key: "TenantID", Value: "tnt_acme" }],
#     TransitiveTagKeys: ["TenantID"],
#   }))
```

## Why this is one-way-door

The IAM policy is the *real* cross-tenant gate. Removing the prefix restriction from the policy would expose every tenant's data to every other tenant's session — a P0. Treat any change to `iam.tf` as an ADR-bearing PR with a security reviewer.

## Related

- `packages/object-store/` — the in-process adapter
- `docs/runbooks/object-store-tenant-isolation.md` — LocalStack end-to-end test recipe
- Forge AI-124 — parent epic
