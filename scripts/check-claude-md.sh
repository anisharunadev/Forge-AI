#!/usr/bin/env bash
# scripts/check-claude-md.sh
# Enforces the .claude/CLAUDE.md constitution stays small, frozen, and clean.
# Wire this into CI. Exit non-zero on any violation.
set -euo pipefail

CLAUDE_MD=".claude/CLAUDE.md"
MAX_LINES=400
violations=0

if [[ ! -f "$CLAUDE_MD" ]]; then
  echo "::error::$CLAUDE_MD missing"
  exit 1
fi

# 1. Line-count budget
lines=$(wc -l < "$CLAUDE_MD")
if (( lines > MAX_LINES )); then
  echo "::error::$CLAUDE_MD is $lines lines; budget is $MAX_LINES."
  echo "        Move detail to docs/standards/ — see CLAUDE.md 'How this file stays frozen'."
  violations=$((violations + 1))
fi

# 2. No TODO/FIXME/XXX (the file is supposed to be done)
if grep -nE '\b(TODO|FIXME|XXX)\b' "$CLAUDE_MD" >/dev/null 2>&1; then
  echo "::error::$CLAUDE_MD contains TODO/FIXME/XXX — finish or move to docs/."
  grep -nE '\b(TODO|FIXME|XXX)\b' "$CLAUDE_MD" | sed 's/^/        /'
  violations=$((violations + 1))
fi

# 3. No @fora/* references (v2.0 scope rule)
if grep -nE '@fora' "$CLAUDE_MD" >/dev/null 2>&1; then
  echo "::error::$CLAUDE_MD contains '@fora/*' — forbidden by v2.0 naming."
  grep -nE '@fora' "$CLAUDE_MD" | sed 's/^/        /'
  violations=$((violations + 1))
fi

# 4. No inline 'Last Updated:' line — changelog belongs in CHANGELOG.md
if grep -nE 'Last [Uu]pdated:' "$CLAUDE_MD" >/dev/null 2>&1; then
  echo "::error::$CLAUDE_MD contains 'Last Updated:' line — belongs in CHANGELOG.md."
  grep -nE 'Last [Uu]pdated:' "$CLAUDE_MD" | sed 's/^/        /'
  violations=$((violations + 1))
fi

# 5. Forbidden provider SDK imports must be flagged even if mentioned as 'forbidden'
#    (we WANT them listed — but list size should stay bounded)
provider_mentions=$(grep -cE '`(openai|anthropic|google\.generativeai|langchain_openai|cohere|ollama)`' "$CLAUDE_MD" || true)
if (( provider_mentions > 10 )); then
  echo "::error::$CLAUDE_MD mentions forbidden SDKs in $provider_mentions places; consolidate to a single Forbidden-imports list."
  violations=$((violations + 1))
fi

if (( violations > 0 )); then
  echo
  echo "FAIL: $violations violation(s) of the .claude/CLAUDE.md budget."
  exit 1
fi

echo "OK: $CLAUDE_MD — ${lines}/${MAX_LINES} lines, frozen, clean."
