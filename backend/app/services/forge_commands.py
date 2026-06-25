"""FORGE_COMMAND_MAP — Forge AI's white-labeling layer over GSD Core.

DL-024 (White-Labeling Principle)
---------------------------------
Users of Forge AI must NEVER see "GSD" anywhere in the UI, in logs, or
in API responses. Every internal engine command is exposed under a
``forge-*`` name. This module is the single source of truth for that
mapping.

Pipeline::

    Forge UI  -->  forge-* command  -->  GSDWrapper  -->  gsd-core (internal)
                                                   \\-->  gsd:phase:discovery (opaque)

The internal command names use the ``gsd:<area>:<verb>`` form (opaque
``/``-separated triples) rather than the friendlier ``gsd-discover`` form
so that any leaked reference (log line, error message, audit record)
still does not advertise the underlying engine to a customer reading
their own audit trail.

This module owns:

* :data:`FORGE_COMMAND_MAP` — 60+ ``forge-*`` commands across 13 categories
* :data:`CommandTier` — RBAC tiers (``user`` / ``admin`` / ``system``)
* :func:`get_forge_command` — resolver
* :func:`list_forge_commands` — iterator (optional category filter)
* :func:`route_to_gsd` — stub executor that hands off to ``GSDWrapper``
* :func:`_cli_list` / :func:`_cli_exec` — CLI hooks wired into root
  ``package.json`` scripts (``forge:list``, ``forge:exec``)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from typing import Iterable, Literal, Mapping

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

CommandTier = Literal["user", "admin", "system"]

# Regex used by tests and CLI: every forge-* identifier MUST match.
_FORGE_NAME_RE = re.compile(r"^forge-[a-z][a-z0-9-]*$")

# Categories are exhaustive on purpose — adding a new command that does
# not fit an existing category is a design smell and should be reviewed.
CATEGORIES: tuple[str, ...] = (
    "onboarding",
    "intel",
    "ideate",
    "arch",
    "dev",
    "test",
    "sec",
    "review",
    "deploy",
    "milestone",
    "learn",
    "flow",
    "env",
)


@dataclass(frozen=True, slots=True)
class ForgeCommand:
    """Single entry in :data:`FORGE_COMMAND_MAP`."""

    forge_cmd: str
    internal_cmd: str
    category: str
    description: str
    tier: CommandTier
    requires_approval: bool

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# FORGE_COMMAND_MAP (60+ commands across 13 categories)
# ---------------------------------------------------------------------------

# Each tuple is (forge_cmd, internal_cmd, description, tier, requires_approval).
# Internal names are opaque on purpose (DL-024).
_ENTRIES: tuple[tuple[str, str, str, CommandTier, bool], ...] = (
    # 1. Onboarding (4)
    ("forge-onboard-welcome", "gsd:onboard:welcome", "Welcome a new project / tenant.", "user", False),
    ("forge-onboard-detect-stack", "gsd:onboard:detect-stack", "Auto-detect languages, frameworks, runtimes.", "user", False),
    ("forge-onboard-bootstrap", "gsd:onboard:bootstrap", "Scaffold .gsd config + initial telemetry.", "admin", True),
    ("forge-onboard-resume", "gsd:onboard:resume", "Resume an interrupted onboarding session.", "user", False),

    # 2. Project Intelligence (6)
    ("forge-intel-scan-repo", "gsd:intel:scan-repo", "Scan repo layout and entrypoints.", "user", False),
    ("forge-intel-scan-deps", "gsd:intel:scan-deps", "Inventory direct and transitive dependencies.", "user", False),
    ("forge-intel-scan-services", "gsd:intel:scan-services", "Map services and their contracts.", "user", False),
    ("forge-intel-scan-secrets", "gsd:intel:scan-secrets", "Detect accidentally committed secrets.", "admin", True),
    ("forge-intel-summarize", "gsd:intel:summarize", "Generate a project-level executive summary.", "user", False),
    ("forge-intel-trend", "gsd:intel:trend", "Show velocity and quality trends.", "user", False),

    # 3. Ideation (5)
    ("forge-ideate-brainstorm", "gsd:ideate:brainstorm", "Generate candidate approaches for a problem.", "user", False),
    ("forge-ideate-refine", "gsd:ideate:refine", "Refine a chosen idea into concrete shape.", "user", False),
    ("forge-ideate-compare", "gsd:ideate:compare", "Trade-off table for 2+ approaches.", "user", False),
    ("forge-ideate-prune", "gsd:ideate:prune", "Discard rejected approaches with rationale.", "user", False),
    ("forge-ideate-crystallize", "gsd:ideate:crystallize", "Freeze an approach into a recordable decision.", "admin", True),

    # 4. Architecture (6)
    ("forge-arch-diagram", "gsd:arch:diagram", "Render a system diagram from the model.", "user", False),
    ("forge-arch-component-map", "gsd:arch:component-map", "List components and their dependencies.", "user", False),
    ("forge-arch-contract-spec", "gsd:arch:contract-spec", "Draft API/data contracts between components.", "admin", True),
    ("forge-arch-data-model", "gsd:arch:data-model", "Generate or update the data model.", "admin", True),
    ("forge-arch-adr", "gsd:arch:adr", "Record an architectural decision record.", "admin", True),
    ("forge-arch-drift", "gsd:arch:drift", "Detect drift between code and architecture.", "user", False),

    # 5. Development (7)
    ("forge-dev-scaffold", "gsd:dev:scaffold", "Scaffold code from a contract spec.", "user", False),
    ("forge-dev-implement", "gsd:dev:implement", "Implement a feature end-to-end.", "user", False),
    ("forge-dev-refactor", "gsd:dev:refactor", "Refactor while preserving behavior.", "user", False),
    ("forge-dev-format", "gsd:dev:format", "Format the working tree.", "user", False),
    ("forge-dev-lint", "gsd:dev:lint", "Run project linters.", "user", False),
    ("forge-dev-hotfix", "gsd:dev:hotfix", "Emergency patch path with audit.", "admin", True),
    ("forge-dev-migrate", "gsd:dev:migrate", "Run data or schema migrations.", "admin", True),

    # 6. Testing (5)
    ("forge-test-plan", "gsd:test:plan", "Generate a test plan from the diff.", "user", False),
    ("forge-test-unit", "gsd:test:unit", "Run the unit test suite.", "user", False),
    ("forge-test-integration", "gsd:test:integration", "Run the integration test suite.", "user", False),
    ("forge-test-e2e", "gsd:test:e2e", "Run the end-to-end test suite.", "admin", True),
    ("forge-test-coverage", "gsd:test:coverage", "Report coverage deltas against baseline.", "user", False),

    # 7. Security (5)
    ("forge-sec-scan", "gsd:sec:scan", "Run SAST/SCA scanners.", "admin", True),
    ("forge-sec-sbom", "gsd:sec:sbom", "Generate or refresh an SBOM.", "admin", True),
    ("forge-sec-policy-check", "gsd:sec:policy-check", "Evaluate tenant policy against the repo.", "admin", True),
    ("forge-sec-incident", "gsd:sec:incident", "Open a security incident record.", "system", True),
    ("forge-sec-audit-export", "gsd:sec:audit-export", "Export a tenant-scoped audit bundle.", "admin", True),

    # 8. Code Review (4)
    ("forge-review-diff", "gsd:review:diff", "Summarize a diff for reviewers.", "user", False),
    ("forge-review-risk", "gsd:review:risk", "Score change risk across axes.", "user", False),
    ("forge-review-approve", "gsd:review:approve", "Approve a change set.", "admin", True),
    ("forge-review-request-changes", "gsd:review:request-changes", "Block a change set with reviewer notes.", "admin", True),

    # 9. Deployment (5)
    ("forge-deploy-plan", "gsd:deploy:plan", "Plan a deployment (versions, blast radius).", "admin", True),
    ("forge-deploy-stage", "gsd:deploy:stage", "Promote a build to staging.", "admin", True),
    ("forge-deploy-prod", "gsd:deploy:prod", "Promote a build to production.", "admin", True),
    ("forge-deploy-rollback", "gsd:deploy:rollback", "Roll back the most recent prod deploy.", "system", True),
    ("forge-deploy-status", "gsd:deploy:status", "Show current deploy state per environment.", "user", False),

    # 10. Milestones (4)
    ("forge-milestone-cut", "gsd:milestone:cut", "Cut a release branch + bump versions.", "admin", True),
    ("forge-milestone-tag", "gsd:milestone:tag", "Tag the release commit.", "admin", True),
    ("forge-milestone-changelog", "gsd:milestone:changelog", "Render the changelog for a release.", "user", False),
    ("forge-milestone-archive", "gsd:milestone:archive", "Archive artifacts and notes for a release.", "admin", True),

    # 11. Learning (4)
    ("forge-learn-capture", "gsd:learn:capture", "Capture a lesson from a session.", "user", False),
    ("forge-learn-summarize", "gsd:learn:summarize", "Summarize captured lessons for review.", "user", False),
    ("forge-learn-promote", "gsd:learn:promote", "Promote a lesson to a durable rule.", "admin", True),
    ("forge-learn-search", "gsd:learn:search", "Search the org-wide lesson corpus.", "user", False),

    # 12. Workflow (4)
    ("forge-flow-plan", "gsd:flow:plan", "Plan a multi-agent workflow run.", "user", False),
    ("forge-flow-run", "gsd:flow:run", "Execute a workflow.", "user", False),
    ("forge-flow-cancel", "gsd:flow:cancel", "Cancel a running workflow.", "admin", True),
    ("forge-flow-status", "gsd:flow:status", "Inspect a running or completed workflow.", "user", False),

    # 13. Environment (4)
    ("forge-env-list", "gsd:env:list", "List environments for the tenant.", "user", False),
    ("forge-env-diff", "gsd:env:diff", "Diff two environments.", "admin", True),
    ("forge-env-sync", "gsd:env:sync", "Sync env A to env B (destructive).", "system", True),
    ("forge-env-promote", "gsd:env:promote", "Promote a version between environments.", "admin", True),
)

# Validate every entry up front — fail loud, fail early.
_VALIDATED: list[ForgeCommand] = []
for _forge, _internal, _desc, _tier, _approval in _ENTRIES:
    if not _FORGE_NAME_RE.match(_forge):
        raise ValueError(f"bad forge command name: {_forge!r}")
    if not _internal.startswith("gsd:"):
        raise ValueError(
            f"internal cmd {_internal!r} for {_forge!r} must be opaque 'gsd:...' form"
        )
    _VALIDATED.append(
        ForgeCommand(
            forge_cmd=_forge,
            internal_cmd=_internal,
            category=_forge.split("-")[1],  # forge-<cat>-<verb>
            description=_desc,
            tier=_tier,
            requires_approval=_approval,
        )
    )

# Frozen public map: forge_cmd -> ForgeCommand.
FORGE_COMMAND_MAP: Mapping[str, ForgeCommand] = {c.forge_cmd: c for c in _VALIDATED}

assert len(FORGE_COMMAND_MAP) >= 60, (
    f"FORGE_COMMAND_MAP must contain >= 60 commands, has {len(FORGE_COMMAND_MAP)}"
)


# ---------------------------------------------------------------------------
# Resolver / iterator
# ---------------------------------------------------------------------------

class UnknownForgeCommand(LookupError):
    """Raised when a ``forge-*`` name is not in the map."""


def get_forge_command(name: str) -> ForgeCommand:
    """Resolve a ``forge-*`` name to its :class:`ForgeCommand`.

    Raises :class:`UnknownForgeCommand` if the name is not registered.
    """

    if not _FORGE_NAME_RE.match(name):
        raise UnknownForgeCommand(
            f"{name!r} is not a valid forge-* command identifier"
        )
    try:
        return FORGE_COMMAND_MAP[name]
    except KeyError as exc:  # pragma: no cover - explicit branch
        raise UnknownForgeCommand(
            f"{name!r} is not registered in FORGE_COMMAND_MAP"
        ) from exc


def list_forge_commands(category: str | None = None) -> Iterable[ForgeCommand]:
    """Yield :class:`ForgeCommand` entries, optionally filtered by category."""

    if category is None:
        return tuple(FORGE_COMMAND_MAP.values())
    return tuple(c for c in FORGE_COMMAND_MAP.values() if c.category == category)


# ---------------------------------------------------------------------------
# Executor stub — bridges to GSDWrapper
# ---------------------------------------------------------------------------

def route_to_gsd(
    forge_cmd: str,
    args: Mapping[str, object] | None = None,
    *,
    tenant_id: str = "local",
    project_id: str = "local",
    user_id: str = "local",
) -> dict:
    """Stub executor that hands a forge-* command off to ``GSDWrapper``.

    The real implementation lives in
    ``backend/app/agents/tools/gsd_wrapper.py``. This function exists so
    the CLI (``forge:exec``) and unit tests can call into the pipeline
    without spinning up the full wrapper class.

    Returns a JSON-serializable dict describing the routed execution.
    """

    cmd = get_forge_command(forge_cmd)
    # Imported lazily to keep this module importable without the full
    # agent toolchain (e.g. for `python -c "from ... import FORGE_COMMAND_MAP"`).
    from app.agents.tools.gsd_wrapper import GSDWrapper  # noqa: WPS433

    wrapper = GSDWrapper(FORGE_COMMAND_MAP)
    result = wrapper.execute(
        forge_cmd=forge_cmd,
        args=dict(args or {}),
        tenant_id=tenant_id,
        project_id=project_id,
        user_id=user_id,
    )
    return {
        "forge_cmd": cmd.forge_cmd,
        "internal_cmd": cmd.internal_cmd,
        "category": cmd.category,
        "tier": cmd.tier,
        "requires_approval": cmd.requires_approval,
        "execution": result,
    }


# ---------------------------------------------------------------------------
# CLI: `python -m backend.app.services.forge_commands {list,exec}`
# ---------------------------------------------------------------------------

def _cli_list(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="forge_commands list")
    parser.add_argument("--category", default=None, choices=CATEGORIES)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    entries = list(list_forge_commands(args.category))
    if args.json:
        json.dump([e.to_dict() for e in entries], sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        for e in entries:
            flag = "!" if e.requires_approval else " "
            print(f"{flag} {e.forge_cmd:<32} [{e.tier:<6}] {e.description}")
    return 0


def _cli_exec(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="forge_commands exec")
    parser.add_argument("forge_cmd")
    parser.add_argument("--args", default="{}", help="JSON object of args")
    parser.add_argument("--tenant-id", default="local")
    parser.add_argument("--project-id", default="local")
    parser.add_argument("--user-id", default="local")
    args = parser.parse_args(argv)

    try:
        parsed_args = json.loads(args.args)
        if not isinstance(parsed_args, dict):
            raise ValueError("--args must be a JSON object")
        result = route_to_gsd(
            args.forge_cmd,
            parsed_args,
            tenant_id=args.tenant_id,
            project_id=args.project_id,
            user_id=args.user_id,
        )
    except (UnknownForgeCommand, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    json.dump(_jsonable(result), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


def _jsonable(obj: object) -> object:
    """Recursively convert dataclasses to dicts for JSON serialization."""

    if hasattr(obj, "__dataclass_fields__"):
        return {k: _jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    sub = argv[0]
    rest = argv[1:]
    if sub == "list":
        return _cli_list(rest)
    if sub == "exec":
        return _cli_exec(rest)
    print(f"unknown subcommand: {sub}", file=sys.stderr)
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())