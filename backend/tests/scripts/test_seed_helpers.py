"""Smoke for ``backend/scripts/_seed_helpers.py``.

Locks the canonical acme-corp tenant UUID so a rename in
``day_one_bootstrap`` or ``seeds/framework`` doesn't silently
desync the seed scripts that import it.
"""
from __future__ import annotations

import uuid

from scripts import _seed_helpers as helpers


def test_acme_tenant_id_is_a_uuid() -> None:
    assert isinstance(helpers.ACME_TENANT_ID, uuid.UUID)


def test_acme_tenant_id_matches_seed_bootstrap_constant() -> None:
    # The same value is hard-coded in ``app/services/day_one_bootstrap.py``
    # and ``seeds/packages/acme-corp``; if any of those move, this
    # assertion fails and the seed scripts need a re-point.
    assert str(helpers.ACME_TENANT_ID) == "a6500631-1930-5afa-9d38-24de9bedcb37"
