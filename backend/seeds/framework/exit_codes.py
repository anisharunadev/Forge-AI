"""Process exit codes for ``apply_seed`` CLI.

Stable contract — referenced by CI scripts, the Playwright globalSetup
hook, and the welcome-page polling client. Do NOT renumber existing
entries; append new ones at the bottom if needed.

| Code | Name                       | Meaning                                              |
|------|----------------------------|------------------------------------------------------|
| 0    | SUCCESS                    | Operation completed without errors.                  |
| 1    | INVALID_MANIFEST           | Manifest failed JSON Schema 2020-12 validation.      |
| 2    | SCHEMA_MISMATCH            | Live DB schema is missing columns/tables.            |
| 3    | BROKEN_REFERENCE           | A ``_id_ref`` could not be resolved.                 |
| 4    | PRODUCTION_BLOCKED         | Demo seed refused against env=production.            |
| 5    | APPLY_ERROR                | UPSERT or post-hook raised; transaction rolled back. |
| 6    | DEPENDENCY_NOT_SATISFIED   | ``depends_on`` chain not satisfied.                  |
| 7    | PERMISSION_DENIED          | Seed not found, or RBAC refused the operation.       |
| 64   | UNKNOWN_ERROR              | Catch-all for unclassified failures.                 |

Codes 1–7 mirror the exception hierarchy in ``exceptions.py``. Code 64
follows the BSD sysexits.h convention for "software error".
"""

from __future__ import annotations

SUCCESS = 0
INVALID_MANIFEST = 1
SCHEMA_MISMATCH = 2
BROKEN_REFERENCE = 3
PRODUCTION_BLOCKED = 4
APPLY_ERROR = 5
DEPENDENCY_NOT_SATISFIED = 6
PERMISSION_DENIED = 7
UNKNOWN_ERROR = 64


__all__ = [
    "SUCCESS",
    "INVALID_MANIFEST",
    "SCHEMA_MISMATCH",
    "BROKEN_REFERENCE",
    "PRODUCTION_BLOCKED",
    "APPLY_ERROR",
    "DEPENDENCY_NOT_SATISFIED",
    "PERMISSION_DENIED",
    "UNKNOWN_ERROR",
]
