"""Seed packages for Forge AI.

Each seed package lives under ``backend/seeds/packages/<name>/`` and is
self-describing: a ``manifest.json`` plus an ordered set of JSON data
files. The runner (see ``backend.seeds.framework.seed_runner``) is
version-agnostic — it consumes the manifest and applies the data files
in ``order``.

The framework code (runner, schema, helpers) is intentionally separate
from the data packages so a single release of the framework can host
many seeds (kn-base reference, acme-corp demo, customer-specific seeds).
"""
