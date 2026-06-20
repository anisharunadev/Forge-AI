#!/usr/bin/env bash
# .fora/artifacts/scripts/screenshot.sh — capture the four persona +
# run-detail screenshots required by FORA-382.
#
# Uses the Playwright CLI shipped with apps/forge (Playwright 1.48.x).
# Hits :3000 (forge dev) and saves PNGs to .fora/artifacts/screenshots/.
#
# Usage:  ./screenshot.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

FORGE_PORT="${FORA_FORGE_PORT:-3000}"
BASE_URL="http://localhost:${FORGE_PORT}"
OUT_DIR="$REPO_ROOT/.fora/artifacts/screenshots"
SEED_RUN_ID="${FORA_SEED_RUN_ID:-00000000-0000-4000-8000-000000000001}"
mkdir -p "$OUT_DIR"

run_screenshot() {
  local name="$1" path="$2"
  echo "[shot] $name -> $path"
  node "$REPO_ROOT/apps/forge/tests/screenshot.mjs" \
    --url "${BASE_URL}${path}" \
    --out "${OUT_DIR}/${name}.png" \
    --viewport 1440x900
}

run_screenshot pm          "/personas/pm"
run_screenshot eng-lead    "/personas/eng-lead"
run_screenshot cto         "/personas/cto"
run_screenshot run-detail  "/runs/${SEED_RUN_ID}"

echo "[shot] screenshots saved to $OUT_DIR"
ls -la "$OUT_DIR"
