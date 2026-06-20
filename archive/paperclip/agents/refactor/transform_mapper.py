"""
Transform mapper — assigns each file an AWS Transform unit + tier.

This is a coarse-grained v0.1 mapper. The intent is to give 8.3
(AWS Transform orchestration) a typed, deterministic projection of
"this file most plausibly maps to this AWS service + this
migration tier." Real orchestration (8.3) still owns the actual
Transform job submission and ADR-backed decisions.

Tier meaning (canonical AWS Transform vocabulary):

  - T1: re-host        — lift-and-shift; the file lands in EC2 / RDS
                         as-is.
  - T2: re-platform    — light modernization; the file lands on a
                         managed runtime with minimal code change.
  - T3: re-architect   — significant refactor; the file is decomposed
                         and lands on purpose-built AWS services.
  - T4: re-imagine     — greenfield; the file is rewritten from
                         scratch against managed primitives.
  - skip               — no migration needed (config, docs, tests).

Unit mapping is driven by `FileRecord.role` + `language`. The rules
are transparent and auditable — every mapping carries an `Evidence`
list that documents the signals that triggered it.
"""

from __future__ import annotations

from typing import List, Tuple

from .schemas import Evidence, FileRecord, TransformMapping


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------

#: Default mapping for first-party source files when the role is
#: business-logic and the file is not in a deprecated path.
DEFAULT_SOURCE_UNIT = "container"
DEFAULT_SOURCE_TIER = "T2"

#: Role-specific rules. The first matching rule wins; the rest are
#: ignored. Order matters.
#
# Each rule is (predicate, unit, tier, rationale). `predicate` takes
# a `FileRecord` and returns a bool.
def _role_in(*roles: str):
    return lambda f: f.role in roles


def _language_in(*langs: str):
    return lambda f: f.language in langs


def _and(a, b):
    return lambda f: a(f) and b(f)


RULES: List[Tuple] = [
    # --- Tests, config, docs, infra: skip -------------------------------
    (
        _role_in("test", "fixture"),
        "skip", "skip",
        "Test/fixture files do not ship to AWS.",
    ),
    (
        _role_in("config", "schema", "migration"),
        "skip", "skip",
        "Config/schema/migration files do not require Transform units.",
    ),
    (
        _role_in("doc"),
        "skip", "skip",
        "Documentation does not require Transform units.",
    ),
    # --- Infra: keep as IaC --------------------------------------------
    (
        _role_in("infra"),
        "s3", "skip",
        "Infra (Dockerfile, helm, terraform) ships as IaC; S3 is the canonical target for asset packaging.",
    ),
    # --- UI / static assets: S3 + CloudFront ----------------------------
    (
        _role_in("ui", "asset"),
        "cloudfront", "T1",
        "Static UI / asset files land in S3 + CloudFront with no code change.",
    ),
    # --- Controllers / handlers: API Gateway (BEFORE entrypoint rule so
    #     controllers — which are usually also entrypoints — land on the
    #     HTTP edge rather than as a raw EC2/lambda) --------------------
    (
        _role_in("controller", "handler"),
        "api_gateway", "T3",
        "Controllers / handlers decompose to API Gateway + Lambda at T3.",
    ),
    # --- Non-controller entry points: lambda (light) or EC2 (JVM) -----
    (
        _and(lambda f: f.is_entrypoint, _language_in("python", "javascript", "typescript", "go")),
        "lambda", "T2",
        "Entry points in light runtimes re-platform to Lambda via API Gateway.",
    ),
    (
        _and(lambda f: f.is_entrypoint, _language_in("java", "csharp", "kotlin")),
        "ec2", "T1",
        "Entry points in JVM/.NET runtimes lift-and-shift to EC2 in T1.",
    ),
    # --- Workflow / pipeline roles: Step Functions ---------------------
    (
        _role_in("pipeline", "workflow", "stage", "transform"),
        "step_functions", "T3",
        "Pipeline / workflow roles decompose to Step Functions at T3.",
    ),
    # --- Models / domain: Aurora (T2) for greenfield, RDS (T2) for legacy
    #     path hints (path contains "rds" or "legacy-db"). v0.2 should
    #     import the actual database-driver scan from FORA-83.
    (
        _and(_role_in("model", "domain"), lambda f: any(h in f.path.lower() for h in ("/rds/", "/legacy-db/"))),
        "rds", "T2",
        "Legacy model path; lands on RDS (managed Postgres/MySQL) at T2.",
    ),
    (
        _role_in("model", "domain"),
        "aurora", "T2",
        "Domain models land on Aurora (managed Postgres-compatible) at T2.",
    ),
    # --- Services in deprecated paths: T1 lift-and-shift ---------------
    (
        lambda f: f.in_deprecated_path,
        "ec2", "T1",
        "Deprecated paths are lifted to EC2 in T1 to be retired post-migration.",
    ),
    # --- Services in large/risky shapes: T3 container ------------------
    (
        _role_in("service", "usecase"),
        "container", "T3",
        "Service / use-case roles land on ECS / Fargate containers at T3.",
    ),
    # --- Default: container at T2 --------------------------------------
    (
        lambda f: True,
        DEFAULT_SOURCE_UNIT, DEFAULT_SOURCE_TIER,
        "Default first-party source maps to a container at T2.",
    ),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def map_transform(repo_files: List[FileRecord]) -> List[TransformMapping]:
    """Return a `TransformMapping` for every file in the input list.

    Output is sorted by `path` for determinism.
    """
    max_fan_in = max((len(f.imported_by) for f in repo_files), default=0)
    max_loc = max((f.loc for f in repo_files), default=0)

    mappings: List[TransformMapping] = []
    for f in repo_files:
        unit, tier, rationale = _map_one(f, max_fan_in=max_fan_in, max_loc=max_loc)
        mappings.append(
            TransformMapping(
                path=f.path,
                unit=unit,
                tier=tier,
                rationale=rationale,
                evidence=[Evidence(
                    kind="transform",
                    description=rationale,
                    paths=[f.path],
                    metric="rule",
                    value=1.0,
                )],
            )
        )
    mappings.sort(key=lambda m: m.path)
    return mappings


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _is_god_module(f: FileRecord, max_fan_in: int, max_loc: int) -> bool:
    """God-module: top-quartile fan-in AND top-quartile size, large file.

    Same heuristic the categorizer uses to emit `rewrite`. The mapper
    re-derives the signal rather than coupling to the categorizer so
    each stage stays independently pure.
    """
    if max_fan_in == 0 or max_loc == 0:
        return False
    fan_in_ratio = len(f.imported_by) / max_fan_in
    loc_ratio = f.loc / max_loc
    return fan_in_ratio >= 0.5 and loc_ratio >= 0.5 and f.loc >= 200


def _map_one(
    f: FileRecord,
    *,
    max_fan_in: int,
    max_loc: int,
) -> Tuple[str, str, str]:
    # God-module rule runs before the role-based rules. T4 is the
    # tier 8.3 should use for files that need a greenfield rewrite.
    if _is_god_module(f, max_fan_in, max_loc):
        return (
            "container", "T4",
            (
                "God-module: high fan-in + high LoC relative to repo. "
                "T4 re-imagine — rewrite from scratch against managed primitives."
            ),
        )
    for predicate, unit, tier, rationale in RULES:
        if predicate(f):
            return unit, tier, rationale
    # Unreachable because the last rule always matches.
    return DEFAULT_SOURCE_UNIT, DEFAULT_SOURCE_TIER, "Default mapping (no rule matched)."
