---
rule_id: knackforge-coding-standards
scope: project
applies_to_stages: [pre_plan, pre_code, pre_commit, pre_review]
sources: [ADR-001, ADR-005, .claude/CLAUDE.md:391-397]
---

# KnackForge — Coding Standards

Auto-injected into every agent invocation that runs in a KnackForge
project. Each point cites the upstream rule or ADR so audits can
verify provenance.

## Provider Agnosticism (ADR-001)

- **Never** import an LLM provider SDK directly
  (`openai`, `anthropic`, `google-generativeai`, `cohere`,
  `mistralai`). Every LLM call goes through
  ``app/services/litellm_client.py`` (the Forge Provider
  Abstraction Layer). The pinned SDK in ``requirements.txt``
  (``litellm>=1.40,<2``) is for **type stubs only**; HTTP traffic
  uses ``httpx``.
- Provider swap (OpenAI → Bedrock → Claude → Codex) must not
  require code changes — the LiteLLM Proxy holds the routing.

## Test Discipline (ADR-005)

- Every public service gets a unit test. Test files mirror the
  source tree under ``backend/tests/``.
- Tests run against an in-memory SQLite engine
  (``conftest.py:sqlite_db``) so the suite is hermetic.
- Production-only branches (httpx calls, Postgres RLS) are guarded
  behind ``bind.dialect.name == "postgresql"`` so the same code
  path works in dev, CI, and prod.

## Language Conventions (CLAUDE.md §391–397)

- Python 3.13+. Async-first (FastAPI + SQLAlchemy 2.x async).
- Type hints on every public function; Pydantic v2 for IO schemas.
- Imports grouped: stdlib, third-party, local; ``from app.*`` last.
- Module docstring mandatory; function docstring on every public
  surface.
- Logging through ``app.core.logging.get_logger(__name__)`` —
  structured via ``structlog``.
- No ``print()`` in committed code.

## Pre-Commit Hygiene

- ``lsp_diagnostics`` clean on every modified file before commit.
- No leftover ``TODO`` / ``HACK`` / ``console.log`` in changed code.
- Migration files increment monotonically
  (``0001``, ``0002``, ``0003`` …) with ``down_revision`` set.
- New tenant-scoped tables must include RLS (DL-026 pattern; see
  ``0001_steering_rules.py`` for the canonical recipe).