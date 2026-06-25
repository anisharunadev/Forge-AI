#!/usr/bin/env bash
# Re-applies the gsd → forge rebrand to a fresh vendoring of upstream.
# Run after `git clone --depth 1 --branch next https://github.com/open-gsd/gsd-core.git forge-core`.
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Strip dev/meta artifacts
rm -rf .git .github .githooks .changeset .plans .out-of-scope docs

# 2. Rename directories
mv commands/gsd commands/forge 2>/dev/null || true
mv gsd-core forge-core 2>/dev/null || true
for d in skills/gsd-*; do [ -d "$d" ] && mv "$d" "skills/forge-${d#skills/gsd-}"; done
for f in agents/gsd-*.md; do [ -f "$f" ] && mv "$f" "agents/forge-${f#agents/gsd-}"; done
for f in hooks/gsd-* forge-core/bin/gsd-*; do
  [ -f "$f" ] && mv "$f" "${f/gsd/forge}"
done
for f in assets/gsd-*; do [ -f "$f" ] && mv "$f" "assets/forge-${f#assets/gsd-}"; done

# 3. Bulk content rename
find . -type f \( -name '*.md' -o -name '*.ts' -o -name '*.cts' -o -name '*.js' \
  -o -name '*.cjs' -o -name '*.mjs' -o -name '*.json' -o -name '*.sh' \
  -o -name '*.yaml' -o -name '*.yml' -o -name '*.html' -o -name '*.css' \
  -o -name '*.txt' -o -name '*.svg' \) \
  -not -path './.git/*' -not -path './LICENSE' -not -path './CHANGELOG.md' \
  -not -path './UPSTREAM.md' \
  -print0 | xargs -0 sed -i \
    -e 's|@opengsd/gsd-core|@forge-ai/forge-core|g' \
    -e 's|gsd-core|forge-core|g' \
    -e 's|\.gsd/|.forge/|g' \
    -e 's|gsd:|forge:|g' \
    -e 's|gsd-check|forge-check|g' \
    -e 's|gsd-config|forge-config|g' \
    -e 's|gsd-context|forge-context|g' \
    -e 's|gsd-cursor|forge-cursor|g' \
    -e 's|gsd-ensure|forge-ensure|g' \
    -e 's|gsd-phase|forge-phase|g' \
    -e 's|gsd-graphify|forge-graphify|g' \
    -e 's|gsd_run|forge_run|g' \
    -e 's|gsd-tools|forge-tools|g' \
    -e 's|gsd-update|forge-update|g' \
    -e 's|gsd-install|forge-install|g' \
    -e 's|gsd backup|forge backup|g' \
    -e 's|gsd restore|forge restore|g' \
    -e 's|gsd-researcher|forge-researcher|g' \
    -e 's|gsd-settings|forge-settings|g' \
    -e 's|gsd-statusline|forge-statusline|g' \
    -e 's|gsd-review|forge-review|g' \
    -e 's|gsd-discuss|forge-discuss|g' \
    -e 's|gsd-help|forge-help|g' \
    -e 's|gsd-:|forge-:|g' \
    -e 's|name: gsd-|name: forge-|g' \
    -e 's|/gsd |/forge |g' \
    -e 's|/gsd|/forge|g' \
    -e 's|gsd/|forge/|g' \
    -e 's|"gsd"|"forge"|g' \
    -e 's|\.gsd-surface|.forge-surface|g' \
    -e 's|\.gsd-profile|.forge-profile|g' \
    -e 's|--from-gsd2|--from-forge2|g' \
    -e 's|opengsd-forge-core|forge-ai-forge-core|g' \
    -e 's|"GSD Core"|"Forge Core"|g' \
    -e 's|GSD Core|Forge Core|g'

echo "Rebrand complete. Audit remaining 'gsd' references with:"
echo "  grep -rIl 'gsd' . | grep -v '^./LICENSE$' | grep -v '^./CHANGELOG.md$' | grep -v '^./UPSTREAM.md$'"
