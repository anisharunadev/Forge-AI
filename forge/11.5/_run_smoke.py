"""Standalone smoke test driver for FORA-11.5 divergence_queue.

Bypasses the package __init__ to avoid the pre-existing indentation
error in the 11.4 work-in-progress resolver.py.  This file lives
under forge/11.5/ (not agents/sync_plane/tests/) because it is a
v0.1 deliverable for FORA-255; the canonical smoke test
`agents/sync_plane/tests/test_divergence_queue.py` is the long-term
home once 11.4 fixes its resolver.py.
"""
from __future__ import annotations

import importlib
import importlib.util
import sys
import types
import time
import uuid

# Bypass the package __init__ (pre-existing indentation error in 11.4
# work-in-progress resolver.py) by stubbing the namespace package and
# loading the submodules directly.
sp = types.ModuleType("sync_plane")
sp.__path__ = ["agents/sync_plane"]
sys.modules["sync_plane"] = sp
sys.path.insert(0, "agents")

for name in ("hlc", "field_owners", "audit"):
    mod = importlib.import_module(f"sync_plane.{name}")
    setattr(sp, name.split(".")[-1] if "." in name else name, mod)
sp.HLC = sys.modules["sync_plane.hlc"].HLC
sp.parse = sys.modules["sync_plane.hlc"].parse
sp.DEFAULT_FIELD_OWNERS = sys.modules["sync_plane.field_owners"].DEFAULT_FIELD_OWNERS
sp.FieldOwner = sys.modules["sync_plane.field_owners"].FieldOwner
sp.FieldOwnershipRule = sys.modules["sync_plane.field_owners"].FieldOwnershipRule
sp.resolve_field_owner = sys.modules["sync_plane.field_owners"].resolve_field_owner
sp.AuditRow = sys.modules["sync_plane.audit"].AuditRow
sp.build_audit_row = sys.modules["sync_plane.audit"].build_audit_row
sp.digest_payload = sys.modules["sync_plane.audit"].digest_payload
sp.DIVERGENCE_RESOLVED_EVENT = sys.modules["sync_plane.audit"].DIVERGENCE_RESOLVED_EVENT

spec = importlib.util.spec_from_file_location(
    "sync_plane.divergence_queue",
    "agents/sync_plane/divergence_queue.py",
)
mod = importlib.util.module_from_spec(spec)
sys.modules["sync_plane.divergence_queue"] = mod
spec.loader.exec_module(mod)

# Wire symbols into `mod` namespace.
for name in (
    "AUDIT_REASON_BULK",
    "AUDIT_REASON_HUMAN",
    "DIGEST_LARGE_THRESHOLD",
    "DIGEST_TOP_FIELDS_TRUNCATE",
    "DIVERGENCE_RESOLVED_BY_HUMAN_EVENT",
    "DivergenceReason",
    "DivergenceRow",
    "LIST_PAGE_SIZE",
    "Resolution",
    "bulk_resolve",
    "build_digest_payload",
    "enqueue_divergence",
    "get_divergence",
    "list_divergences",
    "resolve_divergence",
):
    setattr(mod, name, getattr(mod, name))

# Inline the test cases from
# agents/sync_plane/tests/test_divergence_queue.py by execing the file
# in our patched environment.
src_path = "agents/sync_plane/tests/test_divergence_queue.py"
with open(src_path, "r", encoding="utf-8") as f:
    src = f.read()
# Drop the `from sync_plane...` import block; we'll pre-populate the
# namespace with the same symbols (the package __init__ has a
# pre-existing indentation error in 11.4 work-in-progress resolver.py
# we work around at the top of this file).
import re
src = re.sub(
    r"from sync_plane\.divergence_queue import .*?\)",
    "# divergence_queue imports pre-populated",
    src,
    count=1,
    flags=re.DOTALL,
)
src = re.sub(
    r"from sync_plane\.hlc import HLC[^\n]*",
    "# hlc import pre-populated",
    src,
    count=1,
)
ns: dict = {"__name__": "__main__", "__file__": src_path}
# Re-bind names we already loaded into the test module's namespace.
for name in (
    "AUDIT_REASON_BULK",
    "AUDIT_REASON_HUMAN",
    "DIGEST_LARGE_THRESHOLD",
    "DIGEST_TOP_FIELDS_TRUNCATE",
    "DIVERGENCE_RESOLVED_BY_HUMAN_EVENT",
    "DivergenceReason",
    "DivergenceRow",
    "LIST_PAGE_SIZE",
    "Resolution",
    "bulk_resolve",
    "build_digest_payload",
    "enqueue_divergence",
    "get_divergence",
    "list_divergences",
    "resolve_divergence",
    "HLC",
    "_check",
    "_PASS",
    "_FAIL",
    "_FAILURES",
    "_make_hlc",
    "_make_row",
):
    ns[name] = globals().get(name, getattr(mod, name, None))
ns["HLC"] = sp.HLC
exec(compile(src, src_path, "exec"), ns)
if "main" in ns:
    sys.exit(int(ns["main"]()))
else:
    print("FAIL: main() not defined after exec")
    sys.exit(2)
