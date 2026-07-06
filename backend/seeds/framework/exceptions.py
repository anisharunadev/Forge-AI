"""Typed error hierarchy for the seed framework.

Each subclass maps 1:1 to an exit code in ``exit_codes.py`` so the CLI
can convert a raised exception into the right process status without
needing to inspect the message.

| Exception                       | Exit code | Symbolic         |
|---------------------------------|-----------|------------------|
| InvalidManifestError            | 1         | INVALID_MANIFEST |
| SchemaMismatchError             | 2         | SCHEMA_MISMATCH  |
| BrokenReferenceError            | 3         | BROKEN_REFERENCE |
| ProductionSeedBlockedError      | 4         | PRODUCTION_BLOCKED |
| ApplyRolledBackError            | 5         | APPLY_ERROR      |
| DependencyNotSatisfiedError     | 6         | DEPENDENCY_NOT_SATISFIED |
| SeedNotFoundError               | 7         | PERMISSION_DENIED (or NOT_FOUND) |
"""

from __future__ import annotations


class SeedError(Exception):
    """Base class for all seed-framework errors."""


class InvalidManifestError(SeedError):
    """Manifest does not validate against JSON Schema 2020-12.

    Exit code: INVALID_MANIFEST (1).
    """


class SchemaMismatchError(SeedError):
    """Live DB schema is incompatible with the manifest's data files.

    Exit code: SCHEMA_MISMATCH (2).
    """


class BrokenReferenceError(SeedError):
    """A ``_id_ref`` pointer in a data file could not be resolved.

    Exit code: BROKEN_REFERENCE (3).
    """


class ProductionSeedBlockedError(SeedError):
    """A demo seed was invoked against ``environment=production``.

    Exit code: PRODUCTION_BLOCKED (4). Callers must pass
    ``--allow-in-prod`` to override; the override is itself audited.
    """


class ApplyRolledBackError(SeedError):
    """A data file or post-insert hook raised; the transaction was rolled back.

    Exit code: APPLY_ERROR (5).
    """


class DependencyNotSatisfiedError(SeedError):
    """A seed's ``depends_on`` list is not satisfied by prior applies.

    Exit code: DEPENDENCY_NOT_SATISFIED (6).
    """


class SeedNotFoundError(SeedError):
    """The requested seed package does not exist on disk.

    Exit code: PERMISSION_DENIED (7) is reused for this case so the
    CLI surface stays short; the message distinguishes them.
    """


__all__ = [
    "SeedError",
    "InvalidManifestError",
    "SchemaMismatchError",
    "BrokenReferenceError",
    "ProductionSeedBlockedError",
    "ApplyRolledBackError",
    "DependencyNotSatisfiedError",
    "SeedNotFoundError",
]
