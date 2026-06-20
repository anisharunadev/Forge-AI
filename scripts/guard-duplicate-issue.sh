#!/usr/bin/env bash
# guard-duplicate-issue.sh — FORA-548 duplicate-prevention guard
#
# Given an issue identifier (FORA-N or uuid), decide whether it is a
# near-duplicate of an existing sibling under the same parent issue.
# A near-duplicate is defined as: same parentId AND title normalizes to
# the same string (lowercase, whitespace-collapsed, common prefix tags
# like "FORA-393-F1 —" / "[FORA-391.1] " / "(MVP-2.a) " stripped).
#
# This is the guard that would have caught FORA-482 (CTO, duplicate of
# FORA-488 / SeniorEngineer) before the recovery system retried it three
# times against an EACCES adapter error. It is intentionally cheap:
# one GET, one jq, one sort. No write side effects.
#
# Usage:
#   guard-duplicate-issue.sh <issue-identifier-or-uuid>
#
# Exit codes:
#   0 = no duplicate (safe to checkout)
#   1 = duplicate found (cancel or reassign; see stdout)
#   2 = API error / malformed input
#
# Requires: jq, curl, and the standard Paperclip env vars:
#   PAPERCLIP_API_URL, PAPERCLIP_COMPANY_ID, PAPERCLIP_API_KEY

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <issue-identifier-or-uuid>" >&2
  exit 2
fi

ISSUE_REF="$1"
API_URL="${PAPERCLIP_API_URL:-http://127.0.0.1:3100}"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:?PAPERCLIP_COMPANY_ID is required}"
API_KEY="${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY is required}"

# Step 1 — resolve the issue (handles both FORA-123 and uuid).
if [[ "$ISSUE_REF" =~ ^FORA-[0-9]+$ ]]; then
  ISSUE_JSON=$(curl -sS -G \
    --data-urlencode "q=$ISSUE_REF" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/api/companies/$COMPANY_ID/issues")
  ISSUE_ID=$(echo "$ISSUE_JSON" | jq -r --arg id "$ISSUE_REF" \
    'if type == "array" then (map(select(.identifier == $id)) | first | .id) else empty end')
  if [[ -z "$ISSUE_ID" || "$ISSUE_ID" == "null" ]]; then
    echo "guard-duplicate-issue: could not resolve $ISSUE_REF" >&2
    exit 2
  fi
else
  ISSUE_ID="$ISSUE_REF"
fi

# Step 2 — fetch the issue detail.
ISSUE_DETAIL=$(curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  "$API_URL/api/issues/$ISSUE_ID")

TITLE=$(echo "$ISSUE_DETAIL" | jq -r '.title // ""')
PARENT_ID=$(echo "$ISSUE_DETAIL" | jq -r '.parentId // ""')
SELF_STATUS=$(echo "$ISSUE_DETAIL" | jq -r '.status // ""')

if [[ -z "$TITLE" || "$TITLE" == "null" ]]; then
  echo "guard-duplicate-issue: issue $ISSUE_ID has no title" >&2
  exit 2
fi

# Step 3 — normalize titles.
# Strip leading prefix tags:
#   "FORA-393-F1 — "
#   "FORA-393-1 -- "
#   "(MVP-2.a) "
#   "[FORA-391.1] "
#   "[FORA-393-1] "
normalize() {
  printf '%s' "$1" \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | sed -E 's/^\[?(FORA-[0-9]+(-[A-Za-z0-9]+)?\.?[0-9]*)\]?[[:space:]]*[—–-]+[[:space:]]+//' \
    | sed -E 's/^\((MVP-[0-9]+(\.[a-z0-9]+)?)\)[[:space:]]+//I' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[[:space:]]+/ /g'
}

NORM_TITLE=$(normalize "$TITLE")

# Step 4 — query siblings OR a company-wide title scan, depending on parent.
# When parentId is set, restrict to siblings under the same parent (cheap,
# high-precision). When parentId is null (the FORA-482 case — created
# without parentId but still semantically a child of FORA-393 per the
# description), fall back to a title-only scan across the company. Title
# collisions in this corpus are rare enough that the false-positive rate
# is acceptable; the operator can always override.
SCAN_MODE="sibling"
SCOPE_FILTER=""
if [[ -z "$PARENT_ID" || "$PARENT_ID" == "null" ]]; then
  SCAN_MODE="company-title"
  echo "guard-duplicate-issue: $ISSUE_ID has no parentId; falling back to company-wide title scan" >&2
  # Use the issue title as the search term. The search endpoint ranks
  # title matches first; combined with the status filter, this is
  # tight enough to be safe.
  SCOPE_TITLE_RAW="$TITLE"
fi

# Step 5 — issue the search.
if [[ "$SCAN_MODE" == "sibling" ]]; then
  SIBLINGS=$(curl -sS -G \
    --data-urlencode "parentId=$PARENT_ID" \
    --data-urlencode "status=todo,in_progress,in_review,blocked" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/api/companies/$COMPANY_ID/issues")
else
  # Company-wide title scan: filter on the prefix of the normalized
  # title (first 24 chars) so the search endpoint can match efficiently.
  SEARCH_TERM="${NORM_TITLE:0:24}"
  SIBLINGS=$(curl -sS -G \
    --data-urlencode "q=$SEARCH_TERM" \
    --data-urlencode "status=todo,in_progress,in_review,blocked" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/api/companies/$COMPANY_ID/issues")
fi

# Step 6 — find a sibling whose normalized title matches.
DUPLICATE=$(echo "$SIBLINGS" | jq -r --arg self "$ISSUE_ID" --arg norm "$NORM_TITLE" '
  def norm(t):
    (t // "")
    | sub("^\\s+"; "")
    | sub("\\s+$"; "")
    | sub("^\\[?(FORA-[0-9]+(-[A-Za-z0-9]+)?\\.?[0-9]*)\\]?\\s*[—–-]+\\s+"; "")
    | sub("^\\((MVP-[0-9]+(\\.[a-z0-9]+)?)\\)\\s+"; "i")
    | ascii_downcase
    | gsub("\\s+"; " ");
  .[]
    | select(.id != $self)
    | select((norm(.title)) == $norm)
    | {id: .id, identifier: .identifier, title: .title, status: .status, assigneeAgentId: .assigneeAgentId}
' | jq -s 'first // null')

if [[ "$DUPLICATE" == "null" || -z "$DUPLICATE" ]]; then
  echo "guard-duplicate-issue: $ISSUE_ID is NOT a duplicate (normalized title: $NORM_TITLE)"
  exit 0
fi

DUP_ID=$(echo "$DUPLICATE" | jq -r '.id')
DUP_IDENT=$(echo "$DUPLICATE" | jq -r '.identifier')
DUP_STATUS=$(echo "$DUPLICATE" | jq -r '.status')
DUP_ASSIGNEE=$(echo "$DUPLICATE" | jq -r '.assigneeAgentId')
DUP_TITLE=$(echo "$DUPLICATE" | jq -r '.title')

cat <<EOF >&2
guard-duplicate-issue: DUPLICATE FOUND
  self:        $ISSUE_ID ($SELF_STATUS) — $TITLE
  canonical:   $DUP_IDENT ($DUP_STATUS) — $DUP_TITLE
  assignee:    $DUP_ASSIGNEE
  normalized:  $NORM_TITLE

Recommended action: cancel this issue as duplicate, OR reassign to
$DUP_ASSIGNEE (the canonical owner). Do NOT continue implementation
on this issue — the canonical sibling owns the workstream.
EOF

# Print the structured result on stdout for callers that want to parse it.
echo "$DUPLICATE"
exit 1
