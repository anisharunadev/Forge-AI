#!/usr/bin/env bash
# scripts/check-image-remote-patterns.sh
# SPRINT 1 (docs/audit/implemenation/goal-1.md) - CI guard for the Next.js
# images.remotePatterns allow-list in apps/forge/next.config.mjs.
#
# Fails non-zero if:
#   - the literal `hostname: '**'` appears anywhere outside an
#     `IF_DEV_ONLY` ... `END_DEV_ONLY` block, OR
#   - the literal `protocol: 'http'` appears anywhere outside an
#     `IF_DEV_ONLY` ... `END_DEV_ONLY` block.
#
# Run:  bash scripts/check-image-remote-patterns.sh
# Or via pnpm:  pnpm check:image-policy
#
# The matching logic lives in scripts/check_image_remote_patterns.py so the
# rule can be unit-tested independently from the shell wrapper.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${HERE}/../apps/forge/next.config.mjs"

if [[ ! -f "${TARGET}" ]]; then
  echo "check-image-remote-patterns: ${TARGET} not found" >&2
  exit 2
fi

# ponytail: thin wrapper - the real logic is in the python file so it can
# be reused by the vitest regression under apps/forge/tests/security/.
exec python3 "${HERE}/check_image_remote_patterns.py" "${TARGET}"
