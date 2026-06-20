"""
FORA Knowledge Layer migrations (FORA-412, sub-goal 0.8.5).

A migration is a directory whose name matches ``v<N>_<slug>`` and
which exposes the public surface consumed by
``agents.workspace.migrate``:

    version_id: str         # the directory name (source of truth)
    description: str        # one-line summary for humans
    preview(root, manifest) -> MigrationPlan
    apply(root, manifest)   -> None

Each migration is responsible for its own plan and writes; the
runner is dumb glue. Tenant overrides are NEVER written by a
migration; the runner inspects ``tenants/<slug>/workspace/...``
read-only to surface shadow notices during preview.

This package is intentionally empty at the top level; the
migrations themselves live in subpackages.
"""
