---
title: AWS MCP
description: The AWS MCP server — cross-account IAM role, R scoped. Deploy, IAM, secrets read.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/aws/
generator: readme
approval_required: false
---

The **AWS MCP server** is the sixth MCP integration. **Read-only with a narrow write allow-list** — Forge AI reads AWS resources (deploy, IAM, secrets) but does **not** give the agent write to AWS.

## Auth

- **Flow:** Cross-account IAM role
- **Per-tenant:** yes
- **Token storage:** the IAM role is trust-bound to the Forge AI platform account; no static credentials
- **Trust policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::123456789012:role/fora-aws-mcp" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "sts:ExternalId": "fora-acme-corp" }
    }
  }]
}
```

The `ExternalId` is per-tenant and prevents the "confused deputy" attack.

## The read scope

The IAM role is granted read-only on:

- `ec2:Describe*`
- `s3:GetObject`, `s3:ListBucket`
- `iam:Get*`, `iam:List*`
- `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret`, `secretsmanager:ListSecrets`
- `kms:Decrypt`, `kms:DescribeKey`
- `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics`
- `logs:Describe*`, `logs:Get*`
- `lambda:Get*`, `lambda:List*`
- `eks:Describe*`, `eks:List*`

## The narrow write allow-list

A small set of write actions is allowed **only on a per-run, time-bounded basis**:

- `s3:PutObject` — to a per-tenant audit-bucket prefix
- `sqs:SendMessage` — to the audit-account SQS
- `secretsmanager:PutSecretValue` — to rotate a per-tenant secret
- `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage` — to pull a container image
- `eks:UpdateClusterConfig` — to enable cluster logging (per request)

A write action not in this list is **refused**.

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `aws.deploy_lambda` | Deploy a Lambda function | high — gated by allow-list |
| `aws.iam_get_role` | Fetch IAM role | low |
| `aws.secrets_get` | Read a Secrets Manager secret | medium — every read is audited |
| `aws.s3_get_object` | Read an S3 object | low |
| `aws.cloudwatch_get_metrics` | Fetch CloudWatch metrics | low |
| `aws.eks_describe_cluster` | Describe an EKS cluster | low |

## The customer-cloud-broker

The AWS MCP is fronted by the **Customer Cloud Broker** (per [Forge AI-126](https://github.com/fora-platform/fora/blob/main/workspace/memory/security.md)):

- **Deny-list** of CIDRs and AWS principals the agent must not touch
- **Canary trust probe** — every 5 min, the broker assumes a probe role with a 60s JWT, then releases the handle
- **Credential-redacting audit** — every secret read is redacted in the audit log

## Tenant isolation

The AWS MCP server runs as a separate Deployment per tenant. The MCP router enforces:

- A tenant's agent can only assume its own role.
- The `ExternalId` condition is per-tenant.
- The egress proxy is the only path to the AWS API.

## Where to next

- **[Figma →](/integrations/figma/)** — the previous MCP server.
- **[Slack / Teams →](/integrations/slack/)** — the next page.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/aws/README.md</code> + <code>workspace/memory/security.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
