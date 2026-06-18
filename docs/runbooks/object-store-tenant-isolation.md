# Runbook — Object-store tenant isolation (FORA-124 bar #3)

This runbook walks an engineer through the end-to-end LocalStack test that
proves the cloud-side gate (per-tenant IAM policy) denies cross-tenant
reads/writes at the S3 layer, not just at our adapter.

## Why this runbook exists

The unit tests in `packages/object-store/test/` prove the in-process gate
and the `AssumeRole` contract. They do **not** prove the IAM policy
itself, because they mock STS. The only way to prove the IAM policy is
to stand it up in LocalStack and call the real S3 API from a session
that does not match the bound tenant.

## Pre-conditions

- LocalStack ≥ 3.0 running on `localhost:4566`
  (`docker run --rm -p 4566:4566 localstack/localstack:3`)
- `aws` CLI v2 (uses `aws --endpoint-url=http://localhost:4566`)
- The Terraform in `infra/object-store/iam.tf` applied against LocalStack
  for **two** tenants: `tnt_A` and `tnt_B`

## Step 1 — Create the test bucket and seed tenant A's key

```bash
ENDPOINT=http://localhost:4566
BUCKET=fora-test
aws --endpoint-url=$ENDPOINT s3api create-bucket --bucket $BUCKET
echo "hello-from-tnt_A" | aws --endpoint-url=$ENDPOINT s3 cp - s3://$BUCKET/tenants/tnt_A/blob
```

## Step 2 — Verify the in-process gate

```bash
pnpm -F @fora/object-store test
```

All 14 assertions should pass. None of them call LocalStack.

## Step 3 — Assume the per-tenant role for tenant A and read tenant A's key

```bash
# Capture the role ARN from the terraform output.
ROLE_A_ARN=$(terraform -chdir=infra/object-store output -raw role_arn | sed "s/tnt_A$/tnt_A/")
CREDS_A=$(aws --endpoint-url=$ENDPOINT sts assume-role \
  --role-arn "$ROLE_A_ARN" \
  --role-session-name "test-tnt_A" \
  --tags Key=TenantID,Value=tnt_A Key=TraceID,Value=trace-test \
  --transitive-tag-keys TenantID TraceID \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text)

export AWS_ACCESS_KEY_ID=$(echo "$CREDS_A" | awk '{print $1}')
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS_A" | awk '{print $2}')
export AWS_SESSION_TOKEN=$(echo "$CREDS_A" | awk '{print $3}')

# This MUST succeed.
aws --endpoint-url=$ENDPOINT s3api get-object \
  --bucket $BUCKET --key tenants/tnt_A/blob /tmp/out
cat /tmp/out
```

## Step 4 — Try to read tenant A's key from a tenant B session

```bash
ROLE_B_ARN=$(terraform -chdir=infra/object-store output -raw role_arn | sed "s/tnt_A/tnt_B/")
CREDS_B=$(aws --endpoint-url=$ENDPOINT sts assume-role \
  --role-arn "$ROLE_B_ARN" \
  --role-session-name "test-tnt_B" \
  --tags Key=TenantID,Value=tnt_B Key=TraceID,Value=trace-test \
  --transitive-tag-keys TenantID TraceID \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text)

export AWS_ACCESS_KEY_ID=$(echo "$CREDS_B" | awk '{print $1}')
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS_B" | awk '{print $2}')
export AWS_SESSION_TOKEN=$(echo "$CREDS_B" | awk '{print $3}')

# This MUST fail with AccessDenied.
aws --endpoint-url=$ENDPOINT s3api get-object \
  --bucket $BUCKET --key tenants/tnt_A/blob /tmp/out || echo "EXPECTED: AccessDenied"
```

Expected output: `An error occurred (AccessDenied) when calling the GetObject operation: User: ... is not authorized to perform: s3:GetObject ...`

## Step 5 — Try to write tenant A's key from a tenant B session

```bash
echo "should-fail" | aws --endpoint-url=$ENDPOINT s3 cp - s3://$BUCKET/tenants/tnt_A/blob \
  || echo "EXPECTED: AccessDenied"
```

Expected output: same `AccessDenied` error. This proves the per-tenant
IAM policy is the real gate, not just our in-process check.

## Step 6 — Confirm tenant B can read and write tenant B's own keys

```bash
echo "hello-from-tnt_B" | aws --endpoint-url=$ENDPOINT s3 cp - s3://$BUCKET/tenants/tnt_B/blob
aws --endpoint-url=$ENDPOINT s3api get-object \
  --bucket $BUCKET --key tenants/tnt_B/blob /tmp/out-B
cat /tmp/out-B
```

## Pass criteria

| Step | Expected | Failure mode |
| --- | --- | --- |
| 1 | bucket + key created | LocalStack not running |
| 2 | 14 unit-test assertions pass | adapter bug |
| 3 | `GetObject` succeeds | trust policy misconfigured |
| 4 | `GetObject` returns `AccessDenied` | permission policy too broad |
| 5 | `PutObject` returns `AccessDenied` | permission policy too broad |
| 6 | tenant B's reads/writes succeed | permission policy too narrow |

## Cleanup

```bash
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
docker stop $(docker ps -q --filter "ancestor=localstack/localstack:3")
terraform -chdir=infra/object-store destroy -auto-approve
```

## Related

- `infra/object-store/iam.tf` — the policy under test
- `packages/object-store/test/object-store.test.ts` — unit tests
- FORA-124 — parent epic
