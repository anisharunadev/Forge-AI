#!/usr/bin/env bash
#
# Verify that every Built Feature in `built-features.yaml` has a docs page
# under `docs-site/src/content/docs/`. Use this in CI to enforce Rule 18
# (Documentation is part of the product).
#
# Usage:
#   ./scripts/check-feature-docs.sh            # CI mode
#   ./scripts/check-feature-docs.sh --verbose  # show every check
#
# Exit codes:
#   0  every required feature has a docs page
#   1  one or more required features are missing docs
#   2  setup error
#
# Requires: python3, PyYAML
#   pip install pyyaml

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${PYTHON:-python3}"

cd "$REPO_ROOT"

if [ ! -f "built-features.yaml" ]; then
    echo "error: built-features.yaml not found at repo root" >&2
    exit 2
fi

if ! "$PY" -c "import yaml" 2>/dev/null; then
    echo "error: PyYAML not installed. Install with: pip install pyyaml" >&2
    exit 2
fi

exec "$PY" scripts/check-feature-docs.py "$@"