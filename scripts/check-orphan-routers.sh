#!/usr/bin/env bash
# Phase 2 / SC-2.4 — Guard against orphan routers.
#
# Two valid registration patterns exist in this repo:
#   (A) Bucket flat-membership: each <bucket>/<name>.py is
#       (a1) imported in <bucket>/__init__.py AND
#       (a2) include_router'd as <bucket>.<name>.router in
#            backend/app/api/v1/router.py.
#   (B) Aggregator pattern: <bucket>/__init__.py builds a parent
#       router and is itself imported by v1/router.py which then
#       calls include_router(<bucket>.router).  In this pattern
#       files only need to be imported in <bucket>/__init__.py --
#       the parent router propagates them.
#
# Bucket layout decides which rule applies per bucket.  Buckets
# without __init__.py (flat v1/*.py modules) are out of scope.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

V1_ROUTER="backend/app/api/v1/router.py"

if [ ! -f "$V1_ROUTER" ]; then
  echo "FAIL: $V1_ROUTER missing -- guard cannot run."
  exit 1
fi

fail=0

# Iterate over sub-bucket directories of backend/app/api/v1/
for bucket_dir in backend/app/api/v1/*/; do
  bucket="$(basename "$bucket_dir")"
  [ "$bucket" = "__pycache__" ] && continue
  [ "$bucket" = "_package_wiring" ] && continue

  init="backend/app/api/v1/${bucket}/__init__.py"
  [ -f "$init" ] || continue  # flat-module directory; not a bucket

  parent_imported_in_v1=0
  if grep -E "[^A-Za-z0-9_]${bucket}[^A-Za-z0-9_]" "$V1_ROUTER" >/dev/null 2>&1; then
    parent_imported_in_v1=1
  fi

  # Each .py file in the bucket (excluding __init__ and any local router.py)
  for f in backend/app/api/v1/${bucket}/*.py; do
    name="$(basename "$f" .py)"
    [ "$name" = "__init__" ] && continue
    [ "$name" = "router" ] && continue

    # (a1) Must be imported in __init__.py
    if ! grep -E "[^A-Za-z0-9_]${name}[^A-Za-z0-9_]" "$init" >/dev/null 2>&1; then
      echo "FAIL: Orphan: $f not imported in $init"
      fail=1
      continue
    fi

    # (a2) Either directly include_router'd in v1/router.py AS
    #      <bucket>.<name>.router, OR the whole bucket parent
    #      was imported and an aggregator include_router used.
    if ! grep -E "[^A-Za-z0-9_]${bucket}\.${name}\.router[^A-Za-z0-9_]" "$V1_ROUTER" >/dev/null 2>&1; then
      # Not direct -- fall back to aggregator pattern check
      agg=0
      if [ "$parent_imported_in_v1" -eq 1 ]; then
        if grep -E "include_router\([^A-Za-z0-9_]*${bucket}\.router" "$V1_ROUTER" >/dev/null 2>&1; then
          agg=1
        fi
      fi
      if [ "$agg" -eq 0 ]; then
        echo "FAIL: Orphan: $f not registered in $V1_ROUTER (neither ${bucket}.${name}.router nor ${bucket}.router aggregator)"
        fail=1
      fi
    fi
  done
done

if [ "$fail" -eq 0 ]; then
  echo "OK: All routers registered."
fi
exit "$fail"
