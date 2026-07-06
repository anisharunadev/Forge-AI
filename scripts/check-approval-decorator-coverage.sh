#!/usr/bin/env bash
#
# scripts/check-approval-decorator-coverage.sh
#
# M2 Plan 01-01 (T-A4 — Step 3 of ci-hygiene-grep.yml):
# Every artifact-writing FastAPI handler under `backend/app/api/v1/`
# must carry `@require_approval_phase(...)` immediately above its
# ``async def`` so a direct REST call cannot bypass the Architecture /
# Security / Deployment approval gate (Rule 3).
#
# Pattern: walk every ``*.py`` file under ``backend/app/api/v1/``
# (recursive). For each line matching ``^@router\.(post|put|patch|delete)\b``,
# look within the next 10 lines for ``^@require_approval_phase\b``.  If
# missing AND there is no ``# allowlist: approval-decorator`` directive
# on the line directly above the route decorator, emit a GitHub Actions
# ``::error::`` line and exit non-zero.
#
# Allowlist directive form:
#
#     # allowlist: approval-decorator
#     @router.post("/foo")
#     async def create_foo(...): ...
#
# is the last-resort escape hatch — must be reviewed in PR.
#
# Local: bash scripts/check-approval-decorator-coverage.sh
# CI:    .github/workflows/ci-hygiene-grep.yml
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail=0
checked=0
total_routes=0

declare -a violations=()

# shellcheck disable=SC2207  -- one path per element is intentional
route_files=()
while IFS= read -r f; do
  route_files+=("$f")
done < <(find backend/app/api/v1 -type f -name '*.py' 2>/dev/null | sort)
if [ "${#route_files[@]}" -eq 0 ]; then
  echo "No route files found under backend/app/api/v1 — skipping."
  exit 0
fi

for path in "${route_files[@]}"; do
  while IFS= read -r line_no; do
    total_routes=$((total_routes + 1))
    # Map the file line number to its preceding line (allowlist slot).
    prev_line=$((line_no - 1))
    prev_text="$(sed -n "${prev_line}p" "$path" 2>/dev/null || true)"
    if [[ "$prev_text" == *'# allowlist: approval-decorator'* ]]; then
      continue
    fi
    # Look 10 lines forward from the route decorator for the approval decorator.
    window_end=$((line_no + 10))
    if sed -n "$((line_no + 1)),${window_end}p" "$path" 2>/dev/null \
        | grep -qE '^@require_approval_phase\b'; then
      continue
    fi
    # Try 3 lines above as another possible location (the plan's preferred slot).
    if sed -n "$((line_no - 3)),$((line_no - 1))p" "$path" 2>/dev/null \
        | grep -qE '^@require_approval_phase\b'; then
      continue
    fi
    handler="$(sed -n "$((line_no + 1)),+15p" "$path" 2>/dev/null \
      | grep -m1 -E '^(async )?def ' | head -1 || true)"
    handler=${handler:-unknown_handler}
    msg="OPS-01 violation: artifact-writing route '${handler}' in ${path}:${line_no} lacks @require_approval_phase"
    echo "::error::$msg"
    violations+=("$msg")
    fail=1
  done < <(grep -nE '^@router\.(post|put|patch|delete)\b' "$path" \
           | cut -d: -f1)
done

checked=${#route_files[@]}
echo "==> Scanned ${checked} Python files under backend/app/api/v1/"
echo "==> Inspected ${total_routes} @router.{post,put,patch,delete} handlers"

if (( fail )); then
  echo
  echo "Approval-decorator coverage FAILED."
  echo "Found ${#violations[@]} route(s) without @require_approval_phase."
  echo "Add the decorator (preferred) or add a"
  echo "    # allowlist: approval-decorator"
  echo "directive on the line directly above @router... (last-resort escape hatch)."
  exit 1
fi

echo "OK approval-decorator coverage: every artifact-writing route carries @require_approval_phase."
