#!/usr/bin/env bash
# scripts/floci-init/01-create-buckets.sh
#
# floci init script — runs once when the floci container finishes booting
# (LocalStack-compatible init hook: /etc/localstack/init/ready.d/).
# Auto-creates the S3 buckets Forge AI v2.0 needs.
#
# Re-runs are safe: `aws s3 mb` exits non-zero if the bucket already
# exists and we treat that as a no-op.
set -euo pipefail

# Wait for floci's edge service to start answering.
until curl -fsS http://localhost:4566/_localstack/health > /dev/null 2>&1; do
    echo "[floci-init] waiting for floci..."
    sleep 2
done

BUCKETS=(
    "${S3_BUCKET_ARTIFACTS:-forge-artifacts}"
    "${S3_BUCKET_TERMINAL_EXPORTS:-forge-terminal-exports}"
    "${S3_BUCKET_DOCS:-forge-docs}"
    "${OBJECT_STORE_BUCKET:-forge-dev-bucket}"
)

for bucket in "${BUCKETS[@]}"; do
    echo "[floci-init] creating bucket: $bucket"
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}" \
    AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}" \
        aws --endpoint-url=http://localhost:4566 s3 mb "s3://$bucket" \
            2>&1 || echo "[floci-init]   (already exists)"
done

echo "[floci-init] done"
