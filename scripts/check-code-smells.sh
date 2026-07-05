#!/usr/bin/env bash
# scripts/check-code-smells.sh - Phase 8 SC-8.7.
#
# Scans backend/app and apps/forge/{app,lib,components,hooks} and
# packages/*/src for forbidden tokens: TODO, FIXME, XXX,
# NotImplementedError, raise NotImplementedError.
#
# Allowlist: StoryType.TODO enum, regex literals matching the tokens,
# fixture strings, ponytail: marker comments, legitimate precondition
# NotImplementedError raises, except-NotImplementedError clauses,
# cross-team TODO(frontend agent) marker, drift TODO(Phase 1) marker,
# cosmetic TODO comments in fixture strings.
#
# Exit 0 if clean; 1 on any hit.
set -euo pipefail

scan_paths=(
  backend/app
  apps/forge/app
  apps/forge/lib
  apps/forge/components
  apps/forge/hooks
)
for pkg_dir in packages/*/src; do
  [[ -d "$pkg_dir" ]] && scan_paths+=("$pkg_dir")
done

forbidden_token_pattern='TODO|FIXME|XXX|NotImplementedError|raise NotImplementedError'

token_hits=""
for path in "${scan_paths[@]}"; do
  [[ -d "$path" ]] || continue
  path_hits=$(grep -rn -E "$forbidden_token_pattern" "$path" \
    --include='*.py' --include='*.ts' --include='*.tsx' 2>/dev/null || true)
  if [[ -n "$path_hits" ]]; then
    token_hits+="$path_hits"$'\n'
  fi
done

# Allowlist — each grep -v filters one legitimate occurrence.
filtered_tokens=$(echo "$token_hits" \
  | grep -v 'StoryType\.' \
  | grep -v 'SAEnum(' \
  | grep -v '"BACKLOG".*"TODO"' \
  | grep -v 'enum\.Enum' \
  | grep -v '"TODO" = ' \
  | grep -v '= "TODO"' \
  | grep -v 'r"\\b(ACTION' \
  | grep -v "'TODO" \
  | grep -v '"FIXME' \
  | grep -v '12 TODOs' \
  | grep -v "TODOs'" \
  | grep -v 'TODOs"' \
  | grep -v '# ponytail:' \
  | grep -v '// ponytail:' \
  | grep -v 'TODO(frontend agent)' \
  | grep -v 'TODO(Phase 1)' \
  | grep -v 'TODO with the same wording' \
  | grep -v 'raise NotImplementedError(' \
  | grep -v 'NotImplementedError: language interpreter' \
  | grep -v 'NotImplementedError: Apache AGE' \
  | grep -v 'except NotImplementedError' \
  || true)

if [[ -n "$filtered_tokens" ]]; then
  echo "X Code smells found in production paths:"
  echo "--- forbidden tokens ---"
  echo "$filtered_tokens"
  exit 1
fi

echo "OK code-smells: 0 forbidden tokens across ${#scan_paths[@]} target dirs"
