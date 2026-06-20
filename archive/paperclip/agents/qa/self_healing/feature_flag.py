"""
Feature flag for the Self-Healing Agent (FORA-37).

v1 invariant: `self_healing.enabled` is `False`. The dry-run code path
is always safe (it never mutates a test file) but the v1 contract and
payload reflect the disabled state explicitly so a downstream consumer
that reads `feature_flag.enabled` knows the proposal is advisory only.

Phase 4 (not in this batch) will flip the flag. The mechanism is
intentionally small — a module-level constant plus a helper — so the
flip is a one-line PR plus a comment thread on FORA-37 explaining the
go/no-go. There is no environment-variable override in v1; if a
caller needs to test the Phase 4 code path locally, they must edit
this file. That friction is the point: it forces the flip to be
visible in the diff and the change log.

See `agents/qa/self_healing/README.md` §"Phase 4 flip runbook" for
the full procedure.
"""

from __future__ import annotations

from typing import Any, Dict


# v1 flag: disabled. Flip both halves at once when Phase 4 lands.
#   1. set _SELF_HEALING_ENABLED = True
#   2. set _SELF_HEALING_MODE = "phase_4_apply"
# Then run the smoke test to confirm the proposal is still dry-run only
# (the apply path is gated by an explicit `apply=True` argument that
# defaults to False; the flag is what makes `apply=True` actually do
# something other than raise).
_SELF_HEALING_ENABLED: bool = False
_SELF_HEALING_MODE: str = "v1_dry_run"


def is_enabled() -> bool:
    """Return True iff the self-healing apply path is enabled.

    v1 always returns False. Phase 4 will flip the module-level
    constant and the rest of the agent will start honouring it.
    """
    return _SELF_HEALING_ENABLED


def mode() -> str:
    """Return the current self-healing mode label.

    v1 returns 'v1_dry_run'. Phase 4 returns 'phase_4_apply'.
    """
    return _SELF_HEALING_MODE


def flag_payload() -> Dict[str, Any]:
    """Return the feature_flag block that v1 embeds in every proposal.

    The shape is fixed (see `repair_proposal.schema.json`): the
    consumer should be able to read this without understanding the
    module internals.
    """
    return {
        "self_healing": _SELF_HEALING_MODE,
        "enabled": _SELF_HEALING_ENABLED,
    }
