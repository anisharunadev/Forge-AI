#!/usr/bin/env bash
# LocalStack init — runs once at boot under /etc/localstack/init/ready.d/.
# Idempotent: every create call is guarded so a re-run after a volume
# bounce does not error.
#
# Creates the dev S3 bucket + a Secrets Manager placeholder so the
# smoke test has something concrete to assert (FORA-371 AC).

set -euo pipefail

BUCKET="${OBJECT_STORE_BUCKET:-fora-dev-bucket}"
REGION="${AWS_REGION:-us-east-1}"

echo "[localstack-init] region=$REGION bucket=$BUCKET"

# Demo S3 bucket. The object-store package asserts every key starts
# with `tenants/<tenant_id>/` so the smoke test creates one synthetic
# key after the fact.
# AWS rejects LocationConstraint=us-east-1; only set it for other regions.
if ! awslocal s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  if [[ "$REGION" == "us-east-1" ]]; then
    awslocal s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      >/dev/null
  else
    awslocal s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" \
      >/dev/null
  fi
  echo "[localstack-init] created s3 bucket: $BUCKET"
else
  echo "[localstack-init] s3 bucket exists: $BUCKET"
fi

# A starter Secrets Manager entry so the secrets MCP has at least one
# known handle in dev. The customer-cloud-broker's probe signer also
# references the same name.
if ! awslocal secretsmanager describe-secret --secret-id "fora/probe-signing-key" >/dev/null 2>&1; then
  awslocal secretsmanager create-secret \
    --name "fora/probe-signing-key" \
    --description "FORA-126.4 canary probe signing key (dev only)" \
    --secret-string '{"kty":"oct","k":"dev-only-do-not-use-in-prod","alg":"HS256"}' \
    >/dev/null
  echo "[localstack-init] created secrets manager entry: fora/probe-signing-key"
else
  echo "[localstack-init] secrets manager entry exists: fora/probe-signing-key"
fi

echo "[localstack-init] done"
