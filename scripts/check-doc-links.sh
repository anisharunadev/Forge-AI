#!/usr/bin/env bash
#
# Scan every markdown file for broken links using lychee.
#
# Usage:
#   bash scripts/check-doc-links.sh            # CI mode
#
# Requires lychee. Two ways:
#   1. Local binary: cargo install lychee
#   2. Docker: this script uses the lycheeverse/lychee image.
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Collect every .md file in docs/ + docs-site/.
mapfile -t files < <(find docs docs-site -name '*.md' 2>/dev/null | sort -u)

if command -v lychee >/dev/null 2>&1; then
  exec lychee --no-progress --offline --exclude-loopback --exclude 'https://github.com/.*/issues/.*' "${files[@]}"
fi

# Fallback: Docker image.
if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -v "$REPO_ROOT:/repo" lycheeverse/lychee:latest \
    --no-progress --offline --exclude-loopback --exclude 'https://github.com/.*/issues/.*' \
    "${files[@]/#//repo/}"
fi

echo "::error::lychee not found. Install via 'cargo install lychee' or ensure Docker is available." >&2
exit 2
