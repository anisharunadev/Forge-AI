"""Shared constants for the seed scripts in ``backend/scripts/seed_*.py``.

Most of the acme-corp seed scripts hard-code the same tenant UUID
twice — once as ``ACME_TENANT_ID = uuid.UUID("a6500631...")`` and
again inside the ``select(Tenant).where(Tenant.id == ...)`` lookup.
The lookup and the per-model upsert are intentionally *not*
extracted: the match keys differ (id vs name vs tenant-only), the
log messages name the model, and the error hints per script ("run
``python -m seeds`` first" vs "run day_one_bootstrap first") are
load-bearing for the developer who's debugging a missing row.
Centralising the constants is the safe, small win; the rest stays
per-script.
"""

from __future__ import annotations

import uuid

# acme-corp tenant — the dev tenant seeded by ``day_one_bootstrap`` and
# ``seeds/framework``. Match this against ``Tenant.id`` in seed scripts
# that target acme-corp. Scripts that seed a different tenant
# (``seed_connectors``, ``seed_knowledge_graph`` — they use a separate
# demo tenant for isolation) keep their own constant.
ACME_TENANT_ID: uuid.UUID = uuid.UUID("a6500631-1930-5afa-9d38-24de9bedcb37")
