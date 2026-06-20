"""
v2_onboarding — first workspace migration (FORA-412, sub-goal 0.8.5).

Landing a new ``memory/onboarding.md`` Knowledge Layer file. The
file gives a freshly woken sub-agent a single 10-minute script to
get oriented before they reach for their stage-specific memory
file. It mirrors the layout in ``workspace/README.md §9`` but is
deliberately shorter so a cold-started agent can hold it whole.

The migration is content-only on the seed: it adds one file, and
the runner (not the migration) appends ``v2_onboarding`` to
``workspace-manifest.json#appliedMigrations``.

Tenant override surface: if a tenant has dropped their own
``tenants/<slug>/workspace/memory/onboarding.md`` file, the runner
emits a NOTICE during preview. The apply is still safe — the seed
write is below the tenant root, and the tenant's override is
preserved.
"""
from __future__ import annotations

from pathlib import Path
from typing import Tuple

from agents.workspace.migrate import MigrationPlan, MigrationStep


# ---------------------------------------------------------------------------
# Public surface consumed by agents.workspace.migrate
# ---------------------------------------------------------------------------

version_id: str = "v2_onboarding"
description: str = (
    "Add memory/onboarding.md — the cold-start checklist every sub-agent reads first."
)

# The literal bytes of the new file. Kept inline (not a separate asset)
# so the migration is self-contained: one directory, one __init__.py,
# one apply. A reviewer can read the file content without leaving the
# migration package.
_NEW_FILE_CONTENT = """# Sub-agent onboarding — the first ten minutes

A sub-agent wakes up with a glossary, a stage-specific memory file,
the customer conventions, the project product requirements document,
and a handoff contract. This file is what you read **before** any of
those, to set the posture.

## What you do in the first ten minutes

1. **Confirm the run id and tenant.** The handoff contract names the
   run and the tenant. If the names are missing, stop and raise the
   gap through the handoff channel. A run without a tenant is a
   security bug, not a missing field.
2. **Read the glossary** (`customer/glossary.md`). Every acronym you
   use in a comment, a log line, or a handoff payload must be
   defined there. New terms go in a glossary change request, not in
   your output.
3. **Read your stage memory file.** Each stage has exactly one:
   `ideation`, `architecture`, `coding`, `qa`, `security`, `devops`,
   or `documentation`. The memory file is the source of truth for
   the stage's bar; the stage-specific prompt is a pointer into it.
4. **Read the customer conventions** (`customer/conventions.md`).
   The customer may have narrowed or widened the platform default.
   A platform default that violates a customer convention is a
   platform bug, not the customer's bug.
5. **Read the project product requirements document** (`project/PRD.md`)
   or the slice of it that your handoff contract references. State
   the goal in one sentence before you start work. If you cannot,
   the contract is wrong — raise it through the handoff channel.
6. **State your plan in one paragraph.** The plan-then-act pattern
   requires the plan before the act. A sub-agent that acts before
   planning is an audit failure.
7. **Honour the budget, the allow-list, and the audit log.** The
   `devops` memory file is the source of truth for the budget and
   the allow-list; the `security` memory file is the source of
   truth for the audit log. They are not optional.

## What you do not do

- You do not edit the workspace directly. The workspace is the
  customer's source of truth. Sub-agents read it; the platform
  writes it.
- You do not call external services that are not on your allow-list.
  The allow-list is in the handoff contract; if the service you need
  is not there, the contract is wrong — escalate.
- You do not skip the audit log. Every external call, every file
  write, every secret access is logged. A sub-agent that cannot
  produce a complete audit trail has not done the work.

## Related

- The Knowledge Layer index: [README.md](../../../README.md)
- Stage memory files: [coding.md](../../../memory/coding.md),
  [security.md](../../../memory/security.md),
  [architecture.md](../../../memory/architecture.md),
  [devops.md](../../../memory/devops.md),
  [ideation.md](../../../memory/ideation.md),
  [qa.md](../../../memory/qa.md)
- The glossary: [glossary.md](../../../customer/glossary.md)
- The customer conventions: [conventions.md](../../../customer/conventions.md)
- The project product requirements document: [PRD.md](../../../project/PRD.md)
"""


def _steps() -> Tuple[MigrationStep, ...]:
    return (
        MigrationStep(
            op="add",
            relpath="memory/onboarding.md",
            summary=(
                "New sub-agent cold-start checklist. Self-contained; "
                "no cross-seed dependencies introduced."
            ),
        ),
    )


def _manifest_changes() -> Tuple[str, ...]:
    return (
        "appliedMigrations += ['v2_onboarding']",
    )


def preview(root: Path, manifest) -> MigrationPlan:  # noqa: ARG001 — manifest unused
    """Pure read-only plan. No file writes, no manifest mutation.

    The runner reads the manifest itself; we do not touch it here.
    """
    return MigrationPlan(
        version_id=version_id,
        description=description,
        steps=_steps(),
        manifest_changes=_manifest_changes(),
        notices=(),
    )


def apply(root: Path, manifest) -> None:  # noqa: ARG001 — manifest unused
    """Add the new memory file under the seed root.

    The runner is responsible for appending ``version_id`` to
    ``manifest.appliedMigrations`` and re-writing the manifest after
    this returns. The migration's job is the seed write only.
    """
    target = root / "memory" / "onboarding.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(_NEW_FILE_CONTENT, encoding="utf-8")
