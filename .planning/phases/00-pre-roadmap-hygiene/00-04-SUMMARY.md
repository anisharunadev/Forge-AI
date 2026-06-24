---
phase: 0
plan: 00-04
subsystem: auth-startup-guard
tags: [pydantic-v2, model-validator, fail-fast, settings, security, dev-bypass, hyg-04]
provides:
  - "Settings refuses to instantiate when DEV_AUTH_BYPASS=1 and ENVIRONMENT != development"
  - "Process exits non-zero at import time when DEV_AUTH_BYPASS=1 is set in non-dev environments"
  - "Three pytest tests covering block / allow / no-op branches of the guard"
requires:
  - "pydantic>=2.7,<3 (pinned in backend/requirements.txt)"
  - "pydantic-settings>=2.4,<3 (pinned in backend/requirements.txt)"
affects:
  - backend/app/core/config.py
  - backend/tests/test_config.py
tech-stack:
  added: []
  patterns:
    - "Pydantic v2 model_validator(mode='after') for cross-field invariants after type coercion"
    - "Import-time fail-fast via @lru_cache + module-level settings = get_settings()"
    - "monkeypatch.setenv + get_settings.cache_clear() to test lru_cache'd settings"
key-files:
  created:
    - backend/tests/test_config.py
  modified:
    - backend/app/core/config.py
decisions:
  - "Use model_validator(mode='after') — fields are already coerced to bool/Literal before the validator fires"
  - "Add dev_auth_bypass: bool = False field (was missing) so the validator has a defined target"
  - "Raise ValueError inside the validator; Pydantic wraps it in pydantic.ValidationError"
  - "Place the validator AFTER the last field (github_webhook_secret) and BEFORE @lru_cache def get_settings()"
  - "Use monkeypatch.setenv + get_settings.cache_clear() in tests, NOT os.environ or unittest.mock.patch"
  - "Document the phantom FORA_DEV_AUTH_BYPASS docstring as a deviation rather than touch a non-existent stale reference"
metrics:
  duration: "~10 min"
  completed_date: 2026-06-24
  tasks: 3
  files: 2
  commits: 2
status: complete
---

# Phase 0 Plan 04: DEV_AUTH_BYPASS startup guard Summary

## One-liner

Pydantic v2 `model_validator(mode="after")` on `Settings` raises `ValueError` when `DEV_AUTH_BYPASS=1` is combined with a non-development environment, causing the process to exit non-zero at module import — before FastAPI boots. Three pytest cases (`blocks_production`, `allowed_in_development`, `no_bypass_no_op`) cover the block/allow/no-op branches. HYG-04 closed.

## Task 1 — Validator + missing field on `Settings`

**Commit:** `8dd26680` — `feat(00-04): add DEV_AUTH_BYPASS guard to Settings (HYG-04)`

Two precise edits to `backend/app/core/config.py`:

1. **Import line 11:** `from pydantic import Field` → `from pydantic import Field, model_validator`. The `BaseSettings` and `SettingsConfigDict` imports on line 12 are untouched.

2. **New field + validator method** inserted between the last field (`github_webhook_secret` on line 89) and the `@lru_cache def get_settings()` on line 127:

   - `dev_auth_bypass: bool = Field(default=False, description="...")` — the field was missing from `Settings` (the plan assumed it existed). Without it, the validator has no target. Added here as a deviation (Rule 2 — auto-add missing critical functionality for security correctness).
   - `@model_validator(mode="after") def _dev_bypass_only_in_dev(self) -> "Settings"` — fires after field validation, so `self.dev_auth_bypass` and `self.environment` are already coerced to `bool` and `Literal[...]`. The body raises `ValueError(f"DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development. Got ENVIRONMENT={self.environment!r}. Refusing to boot.")` when `self.dev_auth_bypass and self.environment != "development"`, otherwise `return self`.

The validator runs at `Settings()` instantiation. Because `settings = get_settings()` on line 137 evaluates `Settings()` at module import, a misconfigured deployment exits non-zero at `import app.core.config` — before FastAPI boots, before any request is served.

The validator body matches the plan's hard constraint exactly (single `if`, `ValueError`, message format). The docstring cites HYG-04, the `dev@forge.local` principal's `forge:admin` grant, and explains the import-time fail-fast mechanism.

## Task 2 — Three unit tests in `backend/tests/test_config.py`

**Commit:** `039f611d` — `test(00-04): cover DEV_AUTH_BYPASS guard with three pytest cases (HYG-04)`

New 65-line test file using `monkeypatch.setenv` + `get_settings.cache_clear()` (per the plan's hard rule — NOT `os.environ` mutation, NOT `unittest.mock.patch`, NOT `pytest.fixture` for env setup):

| Test | Env | Expected |
| --- | --- | --- |
| `test_dev_bypass_blocks_production` | `DEV_AUTH_BYPASS=1`, `ENVIRONMENT=production` | `pydantic.ValidationError`; message contains both `"DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development"` and `"ENVIRONMENT='production'"` |
| `test_dev_bypass_allowed_in_development` | `DEV_AUTH_BYPASS=1`, `ENVIRONMENT=development` | `Settings` instance with `dev_auth_bypass is True` and `environment == "development"` |
| `test_no_bypass_no_op` | `DEV_AUTH_BYPASS` unset (delenv), `ENVIRONMENT=production` | `Settings` instance with `dev_auth_bypass is False` and `environment == "production"` |

The test imports `pydantic` directly (top-of-file) for `ValidationError` and `Settings` (for the `isinstance` checks). Tests are split — not parametrized — so the failure message for each branch is unambiguous (a regression that flips the comparison would surface as `test_no_bypass_no_op` failing, not as a single confusing parametrized failure).

Result:

```
$ cd backend && python3 -m pytest -xvs tests/test_config.py
collected 3 items
tests/test_config.py ...
============================== 3 passed in 0.05s ===============================
```

## Task 3 — Verification (PART B) + deviation on PART A

**PART A — no commit; documented as deviation.** The plan claimed `backend/app/core/security.py` lines 81-96 contained a stale `FORA_DEV_AUTH_BYPASS` docstring that needed updating to the canonical `DEV_AUTH_BYPASS=1` form. That docstring does NOT exist in the current `security.py`. The `get_current_principal` function at line 78 is a 9-line JWT-only dependency with a single-line docstring (`"FastAPI dependency: extract & verify the bearer token."`); there is no dev-bypass body, no `FORA_DEV_AUTH_BYPASS` mention, no `dev@forge.local` synthesis. The HYG-04 functional intent (the import-time fail-fast) is achieved entirely by the Task 1 validator, and the HYG-04 acceptance criterion "`security.py` does NOT contain the string `FORA_DEV_AUTH_BYPASS`" is satisfied by absence rather than removal. No edit needed; no file change; no per-task commit. The plan's stale reference appears to be a holdover from a pre-Wave-0 snapshot of `security.py` (the only `FORA_DEV_AUTH_BYPASS` references that exist today are in `.planning/codebase/ARCHITECTURE.md` lines 194 and 359, which are docs not in this plan's scope).

**PART B — import-time fail-fast verification, all three cases pass:**

```bash
$ cd backend && DEV_AUTH_BYPASS=1 ENVIRONMENT=production python3 -c "import app.core.config"
# exit=1; traceback:
# pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
#   Value error, DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development.
#   Got ENVIRONMENT='production'. Refusing to boot.

$ cd backend && ENVIRONMENT=development python3 -c "import app.core.config; print('ok')"
# exit=0; prints "ok"

$ cd backend && python3 -c "import app.core.config; print('ok')"
# exit=0; prints "ok"
```

The first command exits non-zero with a `pydantic_core._pydantic_core.ValidationError` traceback naming the misconfigured env var (`ENVIRONMENT='production'`) and the fix (use `ENVIRONMENT=development`). The second and third exit zero. The unit tests still pass after the verification.

## HYG-04 verification (from 00-VALIDATION.md)

| Check | Result |
| --- | --- |
| `backend/tests/test_config.py` exists | PASS (65 lines, 3 tests) |
| `backend/app/core/config.py` contains `_dev_bypass_only_in_dev` + `model_validator` | PASS |
| `cd backend && python3 -m pytest -xvs tests/test_config.py::test_dev_bypass_blocks_production` — passes, `ValidationError` raised | PASS |
| `cd backend && python3 -m pytest -xvs tests/test_config.py::test_dev_bypass_allowed_in_development` — passes | PASS |
| `cd backend && python3 -m pytest -xvs tests/test_config.py::test_no_bypass_no_op` — passes | PASS |
| `cd backend && DEV_AUTH_BYPASS=1 ENVIRONMENT=production python3 -c "import app.core.config"` — non-zero exit, `ValidationError` in traceback | PASS (exit=1) |
| `cd backend && ENVIRONMENT=development python3 -c "import app.core.config; print('ok')"` — exit 0, prints "ok" | PASS |
| `cd backend && python3 -c "import app.core.config; print('ok')"` — exit 0, prints "ok" | PASS |
| `security.py` does NOT contain the string `FORA_DEV_AUTH_BYPASS` | PASS (by absence — see deviation below) |

All 9 checks pass. HYG-04 closed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Added `dev_auth_bypass: bool = False` field to `Settings`**
- **Found during:** Task 1 implementation
- **Issue:** The plan's validator referenced `self.dev_auth_bypass`, but the field did not exist on the `Settings` class. The plan's `<action>` block did not enumerate adding the field — it assumed it was already there (the plan's `must_haves` block says "imports_added: ['from pydantic import Field, model_validator']" but lists no field addition). Without the field, the validator would raise `pydantic_core.ValidationError: AttributeError: 'Settings' object has no attribute 'dev_auth_bypass'`.
- **Fix:** Added `dev_auth_bypass: bool = Field(default=False, description="DEV_AUTH_BYPASS env var. Synthesizes dev@forge.local principal. Dev-only.")` immediately after the existing `github_webhook_secret` field (now line 97), before the validator (now line 102). Default is `False`, so the no-bypass path is a true no-op (no env-var mutation required for production boots).
- **Files modified:** `backend/app/core/config.py`
- **Commit:** `8dd26680`
- **Rationale:** The plan's stated goal is "Service refuses to start when `DEV_AUTH_BYPASS=1` and `settings.environment != 'development'`." The validator cannot fire if the field doesn't exist. Adding the field is a precondition for the guard to function, not a feature.

### Stale Plan References

**2. [Documentation] Phantom `FORA_DEV_AUTH_BYPASS` docstring in `security.py`**
- **Found during:** Task 3 PART A implementation
- **Issue:** Plan's `<action>` for PART A claimed `get_current_principal` had a docstring spanning lines 81-96 with `FORA_DEV_AUTH_BYPASS` references on lines 83 and 92 that needed updating to `DEV_AUTH_BYPASS=1`. The actual `security.py` file has `get_current_principal` at line 78 with a single-line docstring (`"FastAPI dependency: extract & verify the bearer token."`) — no dev-bypass body, no `FORA_DEV_AUTH_BYPASS` mention anywhere in the file. The only `FORA_DEV_AUTH_BYPASS` references that exist in the repo today are in `.planning/codebase/ARCHITECTURE.md` lines 194 and 359.
- **Resolution:** No file change. The HYG-04 acceptance criterion "`security.py` does NOT contain the string `FORA_DEV_AUTH_BYPASS`" is satisfied by absence. Recorded here so future plan writers don't repeat the stale reference.
- **Impact:** Zero functional impact — the import-time fail-fast (the actual HYG-04 deliverable) works end-to-end and is verified by PART B.

## Threat Surface Notes

Per the plan's `threat_model`:

- **T-00-04-1** (Elevation of Privilege via bypass in prod): **mitigated** by the validator. Verified end-to-end: `DEV_AUTH_BYPASS=1 ENVIRONMENT=production python3 -c "import app.core.config"` exits 1 with a `ValidationError` traceback naming the misconfigured env var.
- **T-00-04-2** (validator fires on a legitimate prod deploy): **accepted** — a legitimate prod deploy will NOT set `DEV_AUTH_BYPASS`. The validator only fires on the dangerous combination. The error message is explicit about how to fix it.
- **T-00-04-3** (operator bypasses via `lru_cache` reuse): **accepted** — `@lru_cache` means the validator runs once per process; mid-process `os.environ` mutation cannot retroactively bypass the already-cached validator. If the process started with the wrong env, it never started.
- **T-00-04-4** (error message reveals env values): **accepted** — the message includes `self.environment!r` (a `Literal[...]` the operator already knows) and does NOT include `DEV_AUTH_BYPASS` (just `True`/`False`). Not sensitive.

No new trust boundaries introduced. The validator is a pure read of env vars that Pydantic already reads; it adds a constraint, not a new attack surface.

## Self-Check

```bash
# Files
test -f backend/app/core/config.py && echo FOUND ✓
test -f backend/tests/test_config.py && echo FOUND ✓

# Commits
git log --oneline -2 | head -2
# 039f611d test(00-04): cover DEV_AUTH_BYPASS guard with three pytest cases (HYG-04)
# 8dd26680 feat(00-04): add DEV_AUTH_BYPASS guard to Settings (HYG-04)

# Validator present
grep -E '_dev_bypass_only_in_dev|model_validator' backend/app/core/config.py
# from pydantic import Field, model_validator
#     @model_validator(mode="after")
#     def _dev_bypass_only_in_dev(self) -> "Settings":

# Tests pass
cd backend && python3 -m pytest -xvs tests/test_config.py
# 3 passed in 0.02s

# Fail-fast works
DEV_AUTH_BYPASS=1 ENVIRONMENT=production python3 -c "import app.core.config"
# exit=1, ValidationError traceback
```

## Self-Check: PASSED

All required files exist; both commits land cleanly; the validator, all three tests, and the three import-time scenarios (bypass+prod fails, development+no-bypass passes, defaults pass) all behave as the plan and the threat model require. HYG-04 is closed.