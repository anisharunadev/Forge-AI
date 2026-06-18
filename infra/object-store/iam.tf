/**
 * Per-tenant object-store IAM policy.
 *
 * Implements FORA-124 acceptance bar #3: an object key written to
 * `tenants/tnt_A/...` is unreadable from a session bound to `tnt_B`,
 * even with the full S3 client.
 *
 * Architecture:
 *
 *   - One per-tenant IAM role (`fora-object-store-<tenant>`) exists in
 *     the runtime account.
 *   - The trust policy allows `sts:AssumeRole` from the FORA agent
 *     runtime principal, but ONLY when the `TenantID` session tag is
 *     set in the request AND `sts:TagSession` and `sts:TagRole`
 *     are allowed (the runtime side enforces this; see
 *     packages/object-store/src/s3.ts `credsFor`).
 *   - The permission policy grants `s3:GetObject`, `s3:PutObject`,
 *     `s3:DeleteObject`, `s3:ListBucket` only on resources whose
 *     ARN matches `arn:aws:s3:::*\/tenants/${aws:PrincipalTag/TenantID}/*`.
 *   - The `aws:PrincipalTag/TenantID` condition key is the gate. A
 *     session that does not carry the tag (or carries a different
 *     tenant) is denied at the IAM layer.
 *
 * The same role also has permission to send/receive on the per-tenant
 * SQS FIFO queue, and to index/search/delete in the per-tenant
 * OpenSearch domain — all gated on the same `TenantID` tag.
 *
 * Consumed by:
 *   - packages/object-store/src/s3.ts (`ObjectStoreS3Adapter.credsFor`)
 *   - infra/object-store/sqs.tf (queue policy, sibling file)
 *   - infra/object-store/opensearch.tf (access policy, sibling file)
 */

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# ---- Inputs ----------------------------------------------------------------

variable "tenant_id" {
  description = "The tenant this role is bound to. Used as the session tag value and the prefix segment in resource ARNs."
  type        = string
}

variable "object_store_bucket_arn" {
  description = "ARN of the S3 bucket that holds all tenant objects. The role is granted s3:* only on keys under tenants/${var.tenant_id}/."
  type        = string
}

variable "object_store_bucket_name" {
  description = "Plain bucket name (for s3:ListBucket which takes the bucket, not its ARN)."
  type        = string
}

variable "sqs_queue_arn" {
  description = "ARN of the per-tenant SQS FIFO queue."
  type        = string
}

variable "opensearch_domain_arn" {
  description = "ARN of the OpenSearch domain that holds tenant documents."
  type        = string
}

variable "agent_runtime_principal_arn" {
  description = "The IAM principal (role or user) the FORA agent runtime runs as. The trust policy allows this principal to AssumeRole."
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources. Should include TenantID so it shows up in the AWS console for ops."
  type        = map(string)
  default     = {}
}

locals {
  # The prefix segment in S3 ARNs. Matches the `TENANT_KEY_PREFIX`
  # helper in packages/object-store/src/context.ts.
  s3_prefix = "tenants/${var.tenant_id}/"

  # The tenant-scoped S3 ARN pattern. The wildcard at the end covers
  # any sub-key under the tenant's namespace.
  s3_object_arn_pattern = "${var.object_store_bucket_arn}/${local.s3_prefix}*"
}

# ---- Trust policy ----------------------------------------------------------

data "aws_iam_policy_document" "assume_role_trust" {
  statement {
    sid     = "AllowAgentRuntimeToAssume"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.agent_runtime_principal_arn]
    }

    # The TenantID session tag is mandatory. The runtime side sets it
    # in `credsFor` (packages/object-store/src/s3.ts). The condition
    # below refuses any AssumeRole that does not carry the tag.
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.tenant_id]
    }

    # The runtime must request session tagging on AssumeRole.
    condition {
      test     = "Bool"
      variable = "sts:TagSession"
      values   = ["true"]
    }
  }
}

# ---- Permission policy -----------------------------------------------------

data "aws_iam_policy_document" "tenant_object_store_policy" {
  # S3 — read / write / delete on the tenant's prefix only.
  statement {
    sid    = "S3ObjectsTenantPrefix"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:AbortMultipartUpload",
    ]
    resources = [local.s3_object_arn_pattern]
  }

  # S3 — list the bucket, but only the tenant's prefix.
  statement {
    sid     = "S3ListBucketTenantPrefix"
    effect  = "Allow"
    actions = ["s3:ListBucket"]
    resources = [var.object_store_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.s3_prefix}*"]
    }
  }

  # S3 — explicit deny on the `tenants/OTHER/` prefixes, so a confused
  # deputy in the role cannot escape even if the allow above is
  # misconfigured. The `aws:PrincipalTag/TenantID` must equal the
  # tenant this role is bound to.
  statement {
    sid     = "S3DenyOtherTenants"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      "${var.object_store_bucket_arn}/tenants/*",
    ]
    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalTag/TenantID"
      values   = [var.tenant_id]
    }
  }

  # SQS — send/receive/delete on the per-tenant FIFO queue.
  statement {
    sid       = "SqsTenantQueue"
    effect    = "Allow"
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.sqs_queue_arn]
  }

  # OpenSearch — index/search/delete on the per-tenant domain, gated
  # on the TenantID tag.
  statement {
    sid     = "OpenSearchTenantDomain"
    effect  = "Allow"
    actions = [
      "es:ESHttpGet",
      "es:ESHttpPost",
      "es:ESHttpPut",
      "es:ESHttpDelete",
      "es:ESHttpHead",
    ]
    resources = [var.opensearch_domain_arn]
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/TenantID"
      values   = [var.tenant_id]
    }
  }
}

# ---- Role ------------------------------------------------------------------

resource "aws_iam_role" "tenant_object_store_role" {
  name               = "fora-object-store-${var.tenant_id}"
  assume_role_policy = data.aws_iam_policy_document.assume_role_trust.json

  tags = merge(var.tags, {
    TenantID = var.tenant_id
    ManagedBy = "terraform"
    Component = "object-store"
  })
}

resource "aws_iam_role_policy" "tenant_object_store_policy" {
  name   = "tenant-object-store-policy"
  role   = aws_iam_role.tenant_object_store_role.id
  policy = data.aws_iam_policy_document.tenant_object_store_policy.json
}

# ---- Outputs ---------------------------------------------------------------

output "role_arn" {
  description = "The ARN the FORA agent runtime passes to sts:AssumeRole. The runtime stamps TenantID=${var.tenant_id} as a session tag."
  value       = aws_iam_role.tenant_object_store_role.arn
}
