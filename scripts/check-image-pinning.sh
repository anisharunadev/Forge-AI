#!/usr/bin/env bash
# scripts/check-image-pinning.sh — fail CI on any `:latest` in docker-compose.yml.
# Phase 7 SC-7.6.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

hits=$(grep -nE "^\s*image:\s+[^@]+\b:latest\b" docker-compose.yml || true)
if [[ -n "$hits" ]]; then
    echo "::error::Unpinned :latest image tag(s) in docker-compose.yml:"
    echo "$hits"
    exit 1
fi
echo "image-pinning: 0 violations"
