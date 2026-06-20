"""
Categorizer — assigns each file a migration category.

The rules are intentionally transparent and deterministic. The output of
this module is one verdict per file: a `CategoryAssignment` carrying
the category, a one-sentence rationale, and the evidence that drove
the decision. Downstream stages (8.2, 8.3) consume only the verdict;
the rationale + evidence are preserved in the deliverable so a
human reviewer (or the Board) can audit each call.

Order of rules matters — once a file matches a rule it is assigned
and the loop continues. The order is:

  1. remove        — generated artifacts, deprecated paths, dead code
  2. rewrite       — large monolith services, god-modules
  3. replace       — proprietary / deprecated runtime dependencies
  4. refactor_in_place — everything that needs API renames / version bumps
  5. keep_as_is    — tests, config, docs, infra
"""

from __future__ import annotations

import re
from typing import List

from .schemas import CATEGORIES, CategoryAssignment, Evidence, FileRecord


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------

#: Files matching any of these path fragments are flagged as deprecated
#: and will be categorized as `remove`. Order is significant: the first
#: match wins.
DEPRECATED_PATH_FRAGMENTS = (
    "/legacy/",
    "/deprecated/",
    "/old/",
    "/_legacy/",
    "/_deprecated/",
    "/_old/",
    "/zzz_legacy/",
    "/migrated_out/",
)

#: Generated / vendored / build-output paths that are not first-party
#: source. We flag these as `remove` so 8.3 doesn't try to re-platform
#: artifacts that are re-derived on every build.
GENERATED_PATH_FRAGMENTS = (
    "/dist/",
    "/build/",
    "/generated/",
    "/auto_generated/",
    "/__generated__/",
    "/vendor/",
    "/node_modules/",
    "/target/",          # Java / Rust build output
    "/.next/",           # Next.js
    "/.venv/",           # Python venv
)

#: Role / language hints that suggest a file is a configuration or
#: documentation artifact and can stay as-is.
KEEP_AS_IS_ROLES = {"config", "doc", "infra", "schema", "migration", "fixture"}

#: Roles that look like test scaffolding and stay as-is.
KEEP_AS_IS_TEST_ROLES = {"test", "fixture"}

#: Patterns that suggest a proprietary or legacy runtime dependency that
#: should be `replace`d. The match is by file content-shape, not by
#: parsing imports — v0.1 keeps it lightweight.
REPLACE_LANGUAGE_HINTS = {
    # Java: legacy Oracle JDK / WebLogic / WebSphere hints.
    "java": (
        "weblogic",
        "websphere",
        "com.oracle",
        "javax.persistence",
        "java.util.Date",  # deprecation hint, only checked when other signals trip
    ),
    # C# / .NET Framework (pre-Core) → .NET 8 modernization.
    "csharp": (
        "system.web",
        "system.configuration",
        ".netframework",
    ),
    # Python 2 → Python 3 modernization hints.
    "python": (
        "python2",
        "import python2",
    ),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def categorize(repo_files: List[FileRecord]) -> List[CategoryAssignment]:
    """Return a `CategoryAssignment` for every file in the input list.

    Output is sorted by `path` so the report is stable across runs.
    """
    # Pre-compute aggregate signals that depend on the whole repo, not
    # on a single file.
    max_fan_in = max((len(f.imported_by) for f in repo_files), default=0)
    max_loc = max((f.loc for f in repo_files), default=0)

    assignments: List[CategoryAssignment] = []
    for f in repo_files:
        cat, rationale, ev = _categorize_one(f, max_fan_in=max_fan_in, max_loc=max_loc)
        assignments.append(
            CategoryAssignment(
                path=f.path,
                category=cat,
                rationale=rationale,
                evidence=ev,
            )
        )

    # Sort by path for determinism.
    assignments.sort(key=lambda c: c.path)
    return assignments


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _categorize_one(
    f: FileRecord,
    *,
    max_fan_in: int,
    max_loc: int,
) -> tuple[str, str, List[Evidence]]:
    """Return (category, rationale, evidence) for a single file."""

    # --- Rule 1: generated / vendored → remove ---------------------------
    if f.in_generated_path or any(frag in f.path for frag in GENERATED_PATH_FRAGMENTS):
        return (
            "remove",
            f"Generated or vendored artifact at {f.path!r}; will be re-derived on build.",
            [Evidence(
                kind="category",
                description="Matched a generated/vendored path fragment.",
                paths=[f.path],
                metric="path-fragment-match",
                value=1.0,
            )],
        )

    # --- Rule 2: deprecated → remove ------------------------------------
    # Top-directory matching only — a path containing "legacy" anywhere
    # (e.g. `com/legacy/monolith/Foo.java`) is NOT deprecated; the file is
    # in production use and other rules (god-module, replace) must fire.
    if f.in_deprecated_path or _path_starts_with_deprecated_dir(f.path):
        return (
            "remove",
            f"Path {f.path!r} lives in a deprecated directory; safe to drop.",
            [Evidence(
                kind="category",
                description="Matched a deprecated top-level directory.",
                paths=[f.path],
                metric="path-fragment-match",
                value=1.0,
            )],
        )

    # Dead code: no importers and not a test/config/doc.
    if (
        not f.imported_by
        and f.role not in KEEP_AS_IS_TEST_ROLES | KEEP_AS_IS_ROLES
        and f.role not in ("entrypoint",)
        and not f.is_entrypoint
    ):
        return (
            "remove",
            f"No importers and not an entrypoint; appears to be dead code.",
            [Evidence(
                kind="category",
                description="No inbound imports and not a known entrypoint/test/config.",
                paths=[f.path],
                metric="imported_by",
                value=0.0,
            )],
        )

    # --- Rule 3: rewrite ------------------------------------------------
    # God-modules: high fan-in AND large size. These need decomposition
    # before 8.3 can orchestrate them.
    if max_fan_in > 0 and max_loc > 0:
        fan_in_ratio = len(f.imported_by) / max_fan_in
        loc_ratio = f.loc / max_loc
        if fan_in_ratio >= 0.5 and loc_ratio >= 0.5 and f.loc >= 200:
            return (
                "rewrite",
                (
                    f"God-module: top-{int(fan_in_ratio * 100)}% fan-in, "
                    f"top-{int(loc_ratio * 100)}% size, "
                    f"{f.loc} LoC. Needs decomposition before re-platforming."
                ),
                [Evidence(
                    kind="category",
                    description="High fan-in + high LoC relative to repo.",
                    paths=[f.path],
                    metric="fan_in_ratio",
                    value=round(fan_in_ratio, 3),
                ), Evidence(
                    kind="category",
                    description="Large file by repo-relative size.",
                    paths=[f.path],
                    metric="loc",
                    value=f.loc,
                )],
            )

    # --- Rule 4: replace ------------------------------------------------
    lang_hints = REPLACE_LANGUAGE_HINTS.get(f.language, ())
    # Heuristic: if path contains one of the language-specific hints, mark
    # for replacement. v0.1 keeps the signal coarse-grained; v0.2 should
    # import the actual AST scan from the dependency-graph sub-goal.
    if any(h in f.path.lower() for h in lang_hints):
        return (
            "replace",
            f"Path {f.path!r} references a legacy runtime ({f.language}); replace with managed equivalent.",
            [Evidence(
                kind="category",
                description=f"Legacy runtime hint in path ({f.language}).",
                paths=[f.path],
                metric="runtime-hint",
                value=1.0,
            )],
        )

    # --- Rule 5: keep_as_is --------------------------------------------
    if f.role in KEEP_AS_IS_ROLES or f.role in KEEP_AS_IS_TEST_ROLES:
        return (
            "keep_as_is",
            f"Role {f.role!r} is config/test/doc/infra; no migration needed.",
            [Evidence(
                kind="category",
                description=f"Role {f.role!r} is a non-source artifact.",
                paths=[f.path],
                metric="role",
                value=1.0,
            )],
        )

    # --- Default: refactor_in_place ------------------------------------
    return (
        "refactor_in_place",
        "First-party source that needs API renames / version bumps; not large enough to rewrite.",
        [Evidence(
            kind="category",
            description="Default category: first-party source, no rewrite/replace signal.",
            paths=[f.path],
            metric="default",
            value=1.0,
        )],
    )


# Self-test guard. If a category is added to CATEGORIES but the rules
# above never emit it, this raises — a deterministic invariant.
#
# The fixture is hand-crafted to cover all 5 categories by giving the
# rules a small but complete repo to chew on. `GodModule` has the
# highest fan-in AND the largest LoC, which is what the `rewrite` rule
# requires. `Bootstrap` carries a path hint that triggers `replace`.
# Every "live" file is marked as an entrypoint so the dead-code rule
# (no inbound imports) doesn't re-classify it as `remove`.
def assert_all_categories_reachable() -> None:
    samples = [
        # God-module: high fan-in, large LoC → rewrite
        FileRecord(
            path="src/GodModule.java", language="java", loc=400, role="service",
            imported_by=[
                "src/CallerA.java", "src/CallerB.java",
                "src/CallerC.java", "src/CallerD.java",
            ],
        ),
        # Callers (entrypoints so the dead-code rule skips them) → refactor_in_place
        FileRecord(path="src/CallerA.java", language="java", loc=40, role="service",
                   imports=["src/GodModule.java"], is_entrypoint=True),
        FileRecord(path="src/CallerB.java", language="java", loc=40, role="service",
                   imports=["src/GodModule.java"], is_entrypoint=True),
        FileRecord(path="src/CallerC.java", language="java", loc=40, role="service",
                   imports=["src/GodModule.java"], is_entrypoint=True),
        FileRecord(path="src/CallerD.java", language="java", loc=40, role="service",
                   imports=["src/GodModule.java"], is_entrypoint=True),
        # Legacy runtime path → replace
        FileRecord(path="src/weblogic/Bootstrap.java", language="java", loc=50,
                   role="service", is_entrypoint=True),
        # Generated path → remove
        FileRecord(path="dist/x.js", language="javascript", loc=10, role="service",
                   in_generated_path=True),
        # Deprecated path → remove
        FileRecord(path="legacy/x.py", language="python", loc=10, role="service",
                   in_deprecated_path=True),
        # Test → keep_as_is
        FileRecord(path="tests/test_x.py", language="python", loc=10, role="test"),
        # Plain service (entrypoint, no rewrite / replace signal) → refactor_in_place
        FileRecord(path="src/app.py", language="python", loc=10, role="service",
                   is_entrypoint=True),
    ]
    out = categorize(samples)
    seen = {c.category for c in out}
    missing = set(CATEGORIES) - seen
    if missing:
        raise RuntimeError(
            f"categorizer never emits {sorted(missing)} on the canonical fixture; "
            "add a rule or remove the category from CATEGORIES."
        )


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def _path_starts_with_deprecated_dir(path: str) -> bool:
    """True iff `path`'s top-level directory matches a deprecated name.

    Substring matching (e.g. ``"/legacy/"``) was too broad: it caught
    production files whose **package name** contains "legacy" (e.g.
    ``com/legacy/monolith/Foo.java``) and mis-classified them as
    ``remove``, blocking the god-module and replace rules from
    firing. Top-directory matching keeps the rule intent (whole
    directories marked as deprecated) without that false positive.

    Examples:
        legacy/old_reporting/foo.java        → True
        /legacy/old/foo.java                  → True
        _legacy/x.py                          → True
        com/legacy/monolith/BillingService.java → False
        src/main/java/LegacyApp.java          → False
    """
    # Normalise: treat relative and absolute paths the same.
    normalized = "/" + path.lstrip("/")
    return any(
        normalized.startswith(frag)
        for frag in DEPRECATED_PATH_FRAGMENTS
    )
