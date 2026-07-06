"""Seed Migration Framework (F-821).

Public surface:

- :func:`validate_manifest` — JSON Schema 2020-12 manifest validator.
- :class:`SeedRunner` — apply / reset / rollback / status / diff / list.
- :mod:`exit_codes` — process exit codes for the CLI.
- :mod:`exceptions` — typed error hierarchy.
- :mod:`upsert_helpers` — pure functions for building UPSERT SQL.
- :mod:`checksum` — deterministic checksums for drift detection.
- :mod:`production_safety` — gate for demo seeds in production.

The runner is intentionally decoupled from any particular data package.
KnackForge's ``kn-base`` and the ``acme-corp`` demo seed both live under
``backend/seeds/packages/`` and ship as ordinary directory layouts.
"""

from __future__ import annotations

__all__: list[str] = []
