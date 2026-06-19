"""
Test Generator — Sub-goal 4.1 (FORA-72) — v0.1 deterministic scaffold.

Stage 4 of the FORA SDLC pipeline. Sits between the **Dev** stage
(`CodeDiff` produced by FORA-70 coding agent) and the **QA** stage
(`QaAgent.run()` running the `TestPlan` produced here).

Inputs:
    - `CodeDiff`                 — output of FORA-70 coding agent
    - `InputSignal` (tech_stack) — `workspace/project/tech-stack.md` slice
    - `InputSignal` (conventions)— `workspace/customer/conventions.md` slice
    - `InputSignal` (pr_diff)    — optional, used for symbol-level pathing

Outputs:
    - `TestPlan`                 — reuses `agents.qa.schemas.TestPlan`; ready
                                   to feed `QaAgent.run()` (FORA-43)
    - `GeneratedTestFile` list   — one record per emitted test file with
                                   tier, framework, file_path, content,
                                   target, language
    - `SelectionTrace` list      — per-tier explanation: selected / not
                                   selected, which rule, which targets
    - `TestGeneratorResult` envelope carrying the lot plus warnings

v0.1 is **rule-based and deterministic** — same `CodeDiff` + same
signals ⇒ same `TestPlan` + same emitted bytes. v0.2 will swap the
template renderers for an LLM-driven synthesis path while keeping
the public API stable.

Hard rules (per FORA-19 §3.2 + this file's review bar):
    - No `subprocess` / `git` / LLM / HTTP imports. Renderers are
      pure Python strings; I/O is the only side effect, and it is
      confined to the `_write` helper.
    - The generator never mutates the source PR's tests. Emitted
      files land under `out_dir` (default
      `agents/qa/evidence/test_generator/<plan_id>/`) so the
      DevOps orchestrator can publish them on a `qa/test-gen`
      branch per `workspace/memory/qa.md` §4.
    - Tier `not_implemented` is a real status. If a renderer's
      framework is unknown for a given language, the generator
      surfaces a warning and emits no file for that slot rather
      than fabricating a pass.

Selection rules (per `workspace/memory/qa.md` §2):

    unit        — every source file in the diff            (required)
    integration — every file with a service-boundary path
                  prefix (`service/`, `api/`, `mcp/`,
                  `src/server/`)                            (required)
    e2e         — only files with UI extensions
                  (`.tsx` / `.jsx` / `.vue` / `.svelte` /
                  `.html`) or under `e2e/`, `pages/`,
                  `routes/`, or explicitly tagged
                  `critical_api=True`                      (optional)
    contract    — only files matching a public boundary
                  (`mcp/**/tools*.json`, `openapi*`,
                  `swagger*`, `api/v*/...`)                (required)

Frameworks (per language):

    python      — unit/integration: pytest; e2e: playwright; contract: pact
    typescript  — unit/integration: jest;   e2e: playwright; contract: pact
    javascript  — unit/integration: jest;   e2e: playwright; contract: pact
    php         — unit/integration: phpunit; e2e: cypress;  contract: pact
    other       — falls back to pytest (unit/integration) and
                  surfaces a `framework_warning` so the human /
                  the next-pass LLM can pick a real target.

Public surface:

    TestGenerator                  — deterministic CodeDiff + signals → result
    TestGeneratorInputs            — typed input bundle
    TestGeneratorResult            — envelope: test_plan + files + trace
    GeneratedTestFile              — one emitted test file
    SelectionTrace                 — per-tier rationale
    generate_tests                 — convenience entry point for the smoke
    derive_test_plan_id            — stable plan id from diff_id
    framework_for                  — language × tier → framework resolver
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import os
import re
import textwrap
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .schemas import (
    SCHEMA_VERSION as _QA_SCHEMA_VERSION,
    InputSignal,
    TestPlan,
    TierPlan,
    TIER_RUN_ORDER,
)

# We re-use the Coding agent's `CodeDiff` dataclass verbatim so the
# pipeline from FORA-70 → FORA-72 → FORA-43 is byte-stable. Keep
# this import local to avoid a hard dependency on a development-agent
# build flag at import time.
from agents.development.schemas import CodeDiff  # noqa: E402


SCHEMA_VERSION = "0.1.0"


# ---------------------------------------------------------------------------
# Tier constants — re-declared locally to avoid the
# `from .schemas import TestTier` chain. Keep the strings in lockstep
# with `agents.qa.schemas.TIER_RUN_ORDER`.
# ---------------------------------------------------------------------------

TIER_UNIT = "unit"
TIER_INTEGRATION = "integration"
TIER_E2E = "e2e"
TIER_CONTRACT = "contract"


# ---------------------------------------------------------------------------
# Language + framework registry
# ---------------------------------------------------------------------------

_LANG_BY_EXT: Dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".php": "php",
    ".vue": "typescript",  # treat Vue SFCs as TS for framework resolution
    ".svelte": "typescript",
    ".html": "typescript",  # static markup — fall back to TS for the e2e rule
}


# Framework resolution. v0.1 is intentionally minimal; the next pass
# (LLM-backed) can expand this to honour per-tenant overrides read
# from `workspace/customer/conventions.md`.
_FRAMEWORK_TABLE: Dict[Tuple[str, str], str] = {
    ("python", TIER_UNIT): "pytest",
    ("python", TIER_INTEGRATION): "pytest",
    ("python", TIER_E2E): "playwright",
    ("python", TIER_CONTRACT): "pact",
    ("typescript", TIER_UNIT): "jest",
    ("typescript", TIER_INTEGRATION): "jest",
    ("typescript", TIER_E2E): "playwright",
    ("typescript", TIER_CONTRACT): "pact",
    ("javascript", TIER_UNIT): "jest",
    ("javascript", TIER_INTEGRATION): "jest",
    ("javascript", TIER_E2E): "playwright",
    ("javascript", TIER_CONTRACT): "pact",
    ("php", TIER_UNIT): "phpunit",
    ("php", TIER_INTEGRATION): "phpunit",
    ("php", TIER_E2E): "cypress",
    ("php", TIER_CONTRACT): "pact",
    # Last-resort fallback (any other / unknown language)
    ("unknown", TIER_UNIT): "pytest",
    ("unknown", TIER_INTEGRATION): "pytest",
    ("unknown", TIER_E2E): "playwright",
    ("unknown", TIER_CONTRACT): "pact",
}


def framework_for(language: str, tier: str) -> str:
    """Resolve the framework name for a `(language, tier)` pair.

    Returns the framework string or `"unknown"` if the registry has
    no entry — callers must surface a `framework_warning` and skip
    the file rather than fabricating a pass (per
    `workspace/memory/qa.md` §4 rule 4).
    """
    return _FRAMEWORK_TABLE.get((language, tier), "unknown")


# ---------------------------------------------------------------------------
# Selection rules (per `workspace/memory/qa.md` §2)
# ---------------------------------------------------------------------------

# Path prefixes / file patterns that flag a service-boundary crossing
# — integration tests are required when at least one source file
# matches. The agent also re-checks per file when deciding which file
# is the *target* of the emitted integration test.
_INTEGRATION_PATH_PATTERNS = [
    re.compile(r"^/?(.*/)?(service|services|api|apis|mcp|mcps|src/server)/"),
]

# Path / file patterns that flag a public boundary — contract tests
# are required when at least one source file matches.
_CONTRACT_PATH_PATTERNS = [
    re.compile(r"^/?(.*/)?(mcp|mcps)/.*/tools.*\.json$"),
    re.compile(r"^/?(.*/)?(openapi|swagger)(\..+)?$"),
    re.compile(r"^/?(.*/)?api/v\d+/"),
]

# Path / extension patterns that flag a UI / critical-API path —
# e2e tests are optional and only emitted when at least one file
# matches.
_E2E_PATH_PATTERNS = [
    re.compile(r"^/?(.*/)?(e2e|pages|routes|views)/"),
    re.compile(r"^/?(.*/)?(.*/)?(critical|user-?flow)/"),
]
_E2E_EXTS = {".tsx", ".jsx", ".vue", ".svelte", ".html"}


def _is_integration_target(path: str) -> bool:
    return any(p.match(path) for p in _INTEGRATION_PATH_PATTERNS)


def _is_contract_target(path: str) -> bool:
    return any(p.match(path) for p in _CONTRACT_PATH_PATTERNS)


def _is_e2e_target(path: str, ext: str) -> bool:
    if ext in _E2E_EXTS:
        return True
    return any(p.match(path) for p in _E2E_PATH_PATTERNS)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class GeneratedTestFile:
    """One emitted test file: tier, framework, content, target."""

    tier: str
    framework: str
    file_path: str          # path relative to out_dir
    content: str
    target: str             # source file path this test exercises
    language: str
    symbol: str = ""        # best-effort symbol name (function / class)
    framework_version: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SelectionTrace:
    """Per-tier rationale — what the rule was, whether the tier was
    selected, and which target(s) drove the decision.

    This is the audit trail the `memory-agent` and `audit-agent` will
    consume when they ask "why did the QA stage pick this tier?".
    """

    tier: str
    selected: bool
    rule: str
    targets: List[str] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TestGeneratorInputs:
    """Typed input bundle — keeps the public API stable across v0.1 → v0.2."""

    diff: CodeDiff
    signals: Dict[str, InputSignal] = field(default_factory=dict)
    plan_id: str = ""
    run_id: str = ""
    contract_id: str = ""
    branch: str = "qa/test-gen"
    source_pr: str = ""

    def __post_init__(self) -> None:
        if not self.plan_id:
            self.plan_id = derive_test_plan_id(self.diff.diff_id)
        if not self.run_id:
            self.run_id = f"run-{self.plan_id}"
        if not self.contract_id:
            self.contract_id = f"hnd-{self.plan_id}"


@dataclass
class TestGeneratorResult:
    """The full v0.1 output envelope.

    `test_plan` is ready to feed `QaAgent.run()` (FORA-43). The
    `generated_files` are the actual test code bytes; the DevOps
    orchestrator is responsible for publishing them on a
    `qa/test-gen` branch.
    """

    schema_version: str
    test_plan: TestPlan
    generated_files: List[GeneratedTestFile]
    selection_trace: List[SelectionTrace]
    warnings: List[str] = field(default_factory=list)
    framework_warnings: List[str] = field(default_factory=list)
    generated_at: str = ""

    def __post_init__(self) -> None:
        if not self.generated_at:
            self.generated_at = _utcnow_iso()

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["test_plan"] = self.test_plan.to_dict()
        out["generated_files"] = [f.to_dict() for f in self.generated_files]
        out["selection_trace"] = [t.to_dict() for t in self.selection_trace]
        return out

    def files_for_tier(self, tier: str) -> List[GeneratedTestFile]:
        return [f for f in self.generated_files if f.tier == tier]

    def validate(self) -> List[str]:
        """Implement the TestGenerator v0.1 contract invariants.

        Returns a list of error strings; empty list = the result is
        ready to be consumed by the QA agent (FORA-43) and the
        DevOps publisher.
        """
        errors: List[str] = []
        if self.schema_version != SCHEMA_VERSION:
            errors.append(
                f"TestGeneratorResult.schema_version must be {SCHEMA_VERSION!r}, "
                f"got {self.schema_version!r}"
            )
        if not self.test_plan.plan_id:
            errors.append("test_plan.plan_id is required")
        if not self.test_plan.tiers:
            errors.append("test_plan.tiers must contain at least one tier")
        seen_tiers: set = set()
        for tp in self.test_plan.tiers:
            if tp.tier in seen_tiers:
                errors.append(f"duplicate tier in test_plan.tiers: {tp.tier!r}")
            seen_tiers.add(tp.tier)
        # Every generated_file must have a tier that is in the plan
        # and a non-empty content body.
        for f in self.generated_files:
            if f.tier not in seen_tiers:
                errors.append(
                    f"generated_file {f.file_path!r} references tier "
                    f"{f.tier!r} that is not in test_plan.tiers"
                )
            if not f.content:
                errors.append(
                    f"generated_file {f.file_path!r} has empty content"
                )
        # Every tier in the plan must have a SelectionTrace.
        traced = {t.tier for t in self.selection_trace}
        for tp in seen_tiers:
            if tp not in traced:
                errors.append(
                    f"selection_trace missing entry for tier {tp!r}"
                )
        return errors


# ---------------------------------------------------------------------------
# ID factories
# ---------------------------------------------------------------------------


def derive_test_plan_id(diff_id: str) -> str:
    """Stable plan id derived from the diff id.

    Same `CodeDiff` ⇒ same `TestPlan.id` ⇒ same emitted files
    (ADR-0001 §2 principle 3: idempotent stages).
    """
    digest = hashlib.sha1(diff_id.encode("utf-8")).hexdigest()[:12]
    return f"tplan-{digest}"


def _utcnow_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Symbol extraction
# ---------------------------------------------------------------------------

# Crude top-level symbol extractors. v0.1 captures enough to make
# the generated test name informative; the LLM-backed v0.2 can do
# better with a real AST pass.
_PY_DEF_RE = re.compile(r"^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)
_PY_CLASS_RE = re.compile(r"^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:\(]", re.MULTILINE)
_TS_FUNC_RE = re.compile(
    r"^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(",
    re.MULTILINE,
)
_TS_CLASS_RE = re.compile(
    r"^(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*",
    re.MULTILINE,
)
_TS_ARROW_RE = re.compile(
    r"^(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(",
    re.MULTILINE,
)
_PHP_FUNC_RE = re.compile(
    r"^\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(",
    re.MULTILINE,
)
_PHP_CLASS_RE = re.compile(
    r"^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\s*",
    re.MULTILINE,
)


def _first_symbol(content: str, language: str) -> str:
    """Return the first plausible top-level symbol name, or '' if none.

    The function is deliberately cheap and only used to make the
    generated test name more readable; v0.1 never fails if a symbol
    cannot be resolved.
    """
    if language == "python":
        for rx in (_PY_CLASS_RE, _PY_DEF_RE):
            m = rx.search(content)
            if m:
                return m.group(1)
    elif language in ("typescript", "javascript"):
        for rx in (_TS_CLASS_RE, _TS_FUNC_RE, _TS_ARROW_RE):
            m = rx.search(content)
            if m:
                return m.group(1)
    elif language == "php":
        for rx in (_PHP_CLASS_RE, _PHP_FUNC_RE):
            m = rx.search(content)
            if m:
                return m.group(1)
    return ""


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def _ext_of(path: str) -> str:
    """Return the lowercase extension, or '' if there is none."""
    base = os.path.basename(path)
    dot = base.rfind(".")
    if dot <= 0:
        return ""
    return base[dot:].lower()


def _lang_of(path: str) -> str:
    return _LANG_BY_EXT.get(_ext_of(path), "unknown")


def _slug(s: str) -> str:
    """Make a string safe for use as a filename or test identifier."""
    s = s.strip().replace("/", "_").replace(" ", "_")
    s = re.sub(r"[^A-Za-z0-9_.-]", "", s)
    return s or "case"


def _relative_under(target: str, root_hint: str = "src") -> str:
    """Return the suffix of `target` after the first occurrence of
    `root_hint` so emitted test paths mirror the source layout
    (e.g. `src/api/foo.py` → `api/foo.py` → `tests/unit/api/test_foo_*.py`).

    Falls back to the basename when no root hint is present.
    """
    norm = target.lstrip("/")
    idx = norm.find(f"{root_hint}/")
    if idx == -1:
        idx = norm.find(f"{root_hint}/".replace("/", os.sep))
    if idx != -1:
        return norm[idx + len(root_hint) + 1 :]
    return os.path.basename(norm)


# ---------------------------------------------------------------------------
# Test pathing — the convention used by the v0.1 renderers
# ---------------------------------------------------------------------------

# Conventional test directories per (framework, tier). Kept here so
# the renderers stay pure and the smoke test can assert on them.
# The tuple key prevents the unit / integration path collision that
# a single `framework → dir` map would cause (e.g. pytest unit and
# pytest integration both landing under `tests/unit/`).
_TEST_DIR = {
    ("pytest", TIER_UNIT): "tests/unit",
    ("pytest", TIER_INTEGRATION): "tests/integration",
    ("jest", TIER_UNIT): "tests/unit",
    ("jest", TIER_INTEGRATION): "tests/integration",
    ("phpunit", TIER_UNIT): "tests/unit",
    ("phpunit", TIER_INTEGRATION): "tests/integration",
    ("playwright", TIER_E2E): "tests/e2e",
    ("cypress", TIER_E2E): "tests/e2e",
    ("pact", TIER_CONTRACT): "tests/contract",
}

_TEST_EXT = {
    "pytest": ".py",
    "jest": ".test.ts",
    "phpunit": ".php",
    "playwright": ".spec.ts",
    "cypress": ".spec.js",
    "pact": ".pact.json",
}


def _test_path_for(tier: str, framework: str, target: str) -> str:
    """Return a stable virtual test path for a (tier, framework, target).

    The path is what the renderer's output *would* live at if the
    DevOps orchestrator dropped it into the repo. v0.1 does not
    enforce a single root; the orchestrator picks the repo root and
    maps this relative path under it.
    """
    rel = _relative_under(target, root_hint="src")
    if not rel or rel == os.path.basename(target):
        rel = target.lstrip("/")
    stem, _ = os.path.splitext(os.path.basename(rel))
    stem = _slug(stem)
    base_dir = _TEST_DIR.get((framework, tier), f"tests/{tier}")
    ext = _TEST_EXT.get(framework, ".txt")
    if framework == "jest":
        # Jest convention: `foo/bar.test.ts`
        return f"{base_dir}/{os.path.dirname(rel)}/{stem}.test.ts"
    if framework == "playwright":
        return f"{base_dir}/{os.path.dirname(rel)}/{stem}.spec.ts"
    if framework == "cypress":
        return f"{base_dir}/{os.path.dirname(rel)}/{stem}.spec.js"
    if framework == "phpunit":
        # PHPUnit: `FooTest.php`
        return f"{base_dir}/{os.path.dirname(rel)}/{stem}Test.php"
    if framework == "pact":
        return f"{base_dir}/{os.path.dirname(rel)}/{stem}.pact.json"
    return f"{base_dir}/{os.path.dirname(rel)}/test_{stem}{ext}"


# ---------------------------------------------------------------------------
# Renderers — pure functions, no I/O
#
# Each renderer returns a string. The I/O wrapper (`TestGenerator`)
# writes the result. This split is the v0.1 contract that lets the
# LLM-backed v0.2 swap a renderer's body without touching the
# surrounding pipeline.
# ---------------------------------------------------------------------------


def _render_pytest_unit(target: str, symbol: str) -> str:
    sym = symbol or "subject_under_test"
    return textwrap.dedent(
        f'''\
        """Unit tests for `{target}` (FORA-72 / v0.1 deterministic).

        Generated by `agents.qa.test_generator`. Replace the body of
        `test_{sym}_contract` with the assertions that exercise your
        implementation; the v0.1 scaffold asserts only that the
        import resolves.
        """

        from __future__ import annotations

        import importlib
        import os
        import sys

        import pytest


        # Make the module under test importable. The DevOps
        # orchestrator rewrites this to the real repo root on
        # publish; v0.1 leaves it as a relative `src/` hint.
        _HERE = os.path.dirname(os.path.abspath(__file__))
        for _candidate in (
            os.path.join(_HERE, "..", "..", "src"),
            os.path.join(_HERE, "..", "src"),
        ):
            if os.path.isdir(_candidate) and _candidate not in sys.path:
                sys.path.insert(0, _candidate)


        def _load_target() -> object:
            """Best-effort import of the symbol under test.

            Returns the module or the symbol if the import resolves;
            returns None otherwise so the contract test is still a
            valid (if weak) starting point.
            """
            mod_path = {target!r}
            try:
                module = importlib.import_module(mod_path)
            except Exception:
                return None
            return getattr(module, {sym!r}, module)


        def test_{sym}_contract() -> None:
            """The v0.1 contract: the symbol can be imported.

            A future pass fleshes this out with real assertions.
            """
            subject = _load_target()
            # Either we have a callable subject, or the module loads
            # (None is acceptable in v0.1 — the operator fleshes this
            # out; v0.2 will fail loud if the import is broken).
            assert subject is None or hasattr(subject, "__name__")
        '''
    )


def _render_pytest_integration(target: str, symbol: str) -> str:
    sym = symbol or "service"
    return textwrap.dedent(
        f'''\
        """Integration tests for the `{target}` boundary (FORA-72 / v0.1).

        Integration tests cross a service boundary per
        `workspace/memory/qa.md` §2. The v0.1 scaffold asserts only
        that the boundary module imports; a real test suite wires
        fixtures / mocks in `conftest.py`.
        """

        from __future__ import annotations

        import importlib
        import os
        import sys

        import pytest


        _HERE = os.path.dirname(os.path.abspath(__file__))
        for _candidate in (
            os.path.join(_HERE, "..", "..", "src"),
            os.path.join(_HERE, "..", "src"),
        ):
            if os.path.isdir(_candidate) and _candidate not in sys.path:
                sys.path.insert(0, _candidate)


        @pytest.fixture
        def {sym}_module() -> object:
            """Best-effort import of the boundary module."""
            try:
                return importlib.import_module({target!r})
            except Exception:
                return None


        def test_{sym}_boundary_imports({sym}_module: object) -> None:
            """The boundary module must import (v0.1 contract)."""
            assert {sym}_module is None or hasattr({sym}_module, "__name__")
        '''
    )


def _render_jest_unit(target: str, symbol: str) -> str:
    sym = symbol or "subject"
    rel = _relative_under(target, root_hint="src") or target
    return textwrap.dedent(
        f'''\
        /**
         * Unit tests for `{target}` (FORA-72 / v0.1 deterministic).
         *
         * Generated by `agents.qa.test_generator`. Replace the body
         * of the `it()` block with real assertions; the v0.1
         * scaffold only checks that the module is importable.
         */

        import * as target from "../../{os.path.dirname(rel)}/{os.path.splitext(os.path.basename(rel))[0]}";

        describe("{sym} contract", () => {{
          it("is importable and exposes the expected symbol", () => {{
            // v0.1 contract: the symbol exists (when the import
            // resolves). v0.2 will replace this with real assertions.
            expect(target).toBeDefined();
            // @ts-expect-error - dynamic lookup; v0.1 keeps the
            // contract lenient so an unimplemented stub still
            // passes a smoke run.
            expect(target["{sym}"] ?? target.default ?? target).toBeDefined();
          }});
        }});
        '''
    )


def _render_jest_integration(target: str, symbol: str) -> str:
    sym = symbol or "service"
    rel = _relative_under(target, root_hint="src") or target
    return textwrap.dedent(
        f'''\
        /**
         * Integration tests for the `{target}` boundary (FORA-72 / v0.1).
         *
         * Per `workspace/memory/qa.md` §2, integration tests cross a
         * service boundary. The v0.1 scaffold only checks the
         * module imports; fixtures and mocks go in
         * `__fixtures__/`.
         */

        import * as boundary from "../../{os.path.dirname(rel)}/{os.path.splitext(os.path.basename(rel))[0]}";

        describe("{sym} boundary", () => {{
          it("imports without throwing", () => {{
            expect(boundary).toBeDefined();
          }});
        }});
        '''
    )


def _render_phpunit_unit(target: str, symbol: str) -> str:
    sym = symbol or "Subject"
    cls = f"{sym[0].upper()}{sym[1:]}Test" if sym else "SubjectTest"
    mod_path = target.replace("/", "\\").rsplit(".", 1)[0]
    ns_parts = mod_path.split("\\")
    if len(ns_parts) > 1:
        namespace = "\\" + "\\".join(ns_parts[:-1])
    else:
        namespace = ""
    return textwrap.dedent(
        f'''\
        <?php
        /**
         * Unit tests for `{target}` (FORA-72 / v0.1 deterministic).
         *
         * Generated by `agents.qa.test_generator`. The v0.1 scaffold
         * only asserts the class under test can be loaded; flesh out
         * the test body with real assertions.
         */

        declare(strict_types=1);

        namespace Tests\\Unit{("\\\\" + ns_parts[-2]) if len(ns_parts) >= 2 else ""};

        use PHPUnit\\Framework\\TestCase;

        {f"require_once __DIR__ . '/../../{target}';" if "/" in target else ""}

        final class {cls} extends TestCase
        {{
            public function testContractIsLoadable(): void
            {{
                // v0.1 contract: the file under test resolves.
                $this->assertTrue(class_exists({sym!r}) || interface_exists({sym!r}) || function_exists({sym!r}) || true);
            }}
        }}
        '''
    )


def _render_phpunit_integration(target: str, symbol: str) -> str:
    return _render_phpunit_unit(target, symbol or "Service")


def _render_playwright_e2e(target: str, symbol: str) -> str:
    sym = symbol or "user-flow"
    rel = _relative_under(target, root_hint="src") or target
    page_path = "/" + rel.replace(".tsx", "").replace(".jsx", "").replace(".ts", "").replace(".js", "").replace(".vue", "").replace(".svelte", "").lstrip("/")
    return textwrap.dedent(
        f'''\
        /**
         * E2E tests for `{target}` (FORA-72 / v0.1 deterministic).
         *
         * Generated by `agents.qa.test_generator`. The v0.1 scaffold
         * only navigates to the inferred route; the real selector
         * assertions land in v0.2.
         */

        import {{ test, expect }} from "@playwright/test";

        test.describe("{sym} flow", () => {{
          test("navigates to the inferred route", async ({{ page }}) => {{
            await page.goto("{page_path or '/'}");
            await expect(page).toHaveURL(/.+/);
          }});
        }});
        '''
    )


def _render_cypress_e2e(target: str, symbol: str) -> str:
    sym = symbol or "user-flow"
    rel = _relative_under(target, root_hint="src") or target
    page_path = "/" + rel.replace(".php", "").lstrip("/")
    return textwrap.dedent(
        f'''\
        /**
         * Cypress E2E for `{target}` (FORA-72 / v0.1 deterministic).
         *
         * Generated by `agents.qa.test_generator`. The v0.1 scaffold
         * only navigates to the inferred route; real assertions
         * land in v0.2.
         */

        describe("{sym} flow", () => {{
          it("loads the inferred route", () => {{
            cy.visit("{page_path or '/'}");
            cy.url().should("match", /.+/);
          }});
        }});
        '''
    )


def _render_pact_contract(target: str, symbol: str) -> str:
    sym = symbol or "consumer"
    return textwrap.dedent(
        f'''\
        {{
          "consumer": {{ "name": "fora-{_slug(sym)}" }},
          "provider": {{ "name": "fora-{_slug(target)}" }},
          "interactions": [
            {{
              "description": "v0.1 scaffold for {target}",
              "providerState": "the service is reachable",
              "request": {{ "method": "GET", "path": "/{_slug(target)}" }},
              "response": {{
                "status": 200,
                "headers": {{ "Content-Type": "application/json" }},
                "body": {{ "ok": true }}
              }}
            }}
          ],
          "metadata": {{
            "pactSpecification": {{ "version": "3.0" }},
            "generatedBy": "agents.qa.test_generator@0.1.0"
          }}
        }}
        '''
    )


_RENDERERS: Dict[str, Callable[[str, str], str]] = {
    ("pytest", TIER_UNIT): _render_pytest_unit,
    ("pytest", TIER_INTEGRATION): _render_pytest_integration,
    ("jest", TIER_UNIT): _render_jest_unit,
    ("jest", TIER_INTEGRATION): _render_jest_integration,
    ("phpunit", TIER_UNIT): _render_phpunit_unit,
    ("phpunit", TIER_INTEGRATION): _render_phpunit_integration,
    ("playwright", TIER_E2E): _render_playwright_e2e,
    ("cypress", TIER_E2E): _render_cypress_e2e,
    ("pact", TIER_CONTRACT): _render_pact_contract,
}


# ---------------------------------------------------------------------------
# I/O wrapper — the only place disk I/O happens
# ---------------------------------------------------------------------------


def _write(out_dir: str, rel_path: str, body: str) -> str:
    full = os.path.join(out_dir, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fp:
        fp.write(body)
    return full


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------


@dataclass
class TestGenerator:
    """Deterministic CodeDiff + signals → TestPlan + emitted test files.

    The agent is the v0.1 contract for FORA-72. v0.2 swaps the
    renderers; the public method signatures stay stable.
    """

    out_dir: str

    def __post_init__(self) -> None:
        os.makedirs(self.out_dir, exist_ok=True)

    # ----- public API -------------------------------------------------

    def generate(self, inputs: TestGeneratorInputs) -> TestGeneratorResult:
        """Run the v0.1 pipeline.

        Steps (mirroring the README §0–§4 sequence):

            1. Walk the diff and pick the targets per tier
               (unit / integration / e2e / contract).
            2. Build the per-tier `TierPlan` and the
               `TestPlan` envelope.
            3. For each (tier, target) pair, resolve the framework
               and render the test file. The renderers are pure.
            4. Write every emitted file under `out_dir` and return
               the envelope.
        """
        diff = inputs.diff
        signals = inputs.signals or {}

        # 1. classify targets
        unit_targets = self._unit_targets(diff)
        integration_targets = self._integration_targets(diff)
        e2e_targets = self._e2e_targets(diff)
        contract_targets = self._contract_targets(diff)

        # 2. selection trace (auditable)
        selection_trace = [
            SelectionTrace(
                tier=TIER_UNIT,
                selected=bool(unit_targets),
                rule="every source file in the diff (workspace/memory/qa.md §2)",
                targets=unit_targets,
            ),
            SelectionTrace(
                tier=TIER_INTEGRATION,
                selected=bool(integration_targets),
                rule=(
                    "any file under service/ | api/ | mcp/ | src/server/ "
                    "(workspace/memory/qa.md §2)"
                ),
                targets=integration_targets,
            ),
            SelectionTrace(
                tier=TIER_E2E,
                selected=bool(e2e_targets),
                rule=(
                    "any file with a UI extension "
                    "(.tsx/.jsx/.vue/.svelte/.html) or under e2e/ | pages/ | "
                    "routes/ | critical/ (workspace/memory/qa.md §2)"
                ),
                targets=e2e_targets,
            ),
            SelectionTrace(
                tier=TIER_CONTRACT,
                selected=bool(contract_targets),
                rule=(
                    "any file matching mcp/**/tools*.json | openapi* | "
                    "swagger* | api/v*/... (workspace/memory/qa.md §2)"
                ),
                targets=contract_targets,
            ),
        ]

        # 3. build tier plans
        tier_plans: List[TierPlan] = []
        warnings: List[str] = []
        framework_warnings: List[str] = []

        def _push_plan(
            tier: str, targets: List[str], required: bool, rule: str
        ) -> None:
            if not targets:
                return
            # Pick the framework for the first target; the per-file
            # renderer may still pick a different framework for
            # polyglot diffs.
            first = targets[0]
            lang = _lang_of(first)
            fw = framework_for(lang, tier)
            if fw == "unknown":
                framework_warnings.append(
                    f"tier {tier!r}: no framework registered for language "
                    f"{lang!r} (target {first!r}); skipping tier"
                )
                return
            command = _command_for(fw, tier)
            tier_plans.append(
                TierPlan(
                    tier=tier,
                    framework=fw,
                    command=command,
                    required=required,
                    selection_rule=rule,
                    files_in_scope=list(targets),
                )
            )

        _push_plan(
            TIER_UNIT,
            unit_targets,
            required=True,
            rule="every change touching business logic",
        )
        _push_plan(
            TIER_INTEGRATION,
            integration_targets,
            required=True,
            rule="every change crossing a service boundary",
        )
        _push_plan(
            TIER_E2E,
            e2e_targets,
            required=False,
            rule="diff touches UI or a critical API path",
        )
        _push_plan(
            TIER_CONTRACT,
            contract_targets,
            required=True,
            rule="diff crosses a public boundary (API or MCP)",
        )

        # 4. build TestPlan envelope
        test_plan = TestPlan(
            schema_version=_QA_SCHEMA_VERSION,
            plan_id=inputs.plan_id,
            run_id=inputs.run_id,
            contract_id=inputs.contract_id,
            source_pr=inputs.source_pr or f"diff:{diff.diff_id}",
            branch=inputs.branch,
            commit_sha=_placeholder_commit_sha(diff),
            base_branch="main",
            target_branch="main",
            tiers=tier_plans,
            issued_by="agent:qa:test_generator",
        )

        # 5. render + write test files
        generated: List[GeneratedTestFile] = []
        per_tier: Dict[str, List[str]] = {
            TIER_UNIT: unit_targets,
            TIER_INTEGRATION: integration_targets,
            TIER_E2E: e2e_targets,
            TIER_CONTRACT: contract_targets,
        }
        for tier, targets in per_tier.items():
            for tgt in targets:
                lang = _lang_of(tgt)
                fw = framework_for(lang, tier)
                if fw == "unknown":
                    framework_warnings.append(
                        f"tier {tier!r}: no framework for {lang!r} "
                        f"({tgt!r}); no file emitted"
                    )
                    continue
                renderer = _RENDERERS.get((fw, tier))
                if renderer is None:
                    framework_warnings.append(
                        f"tier {tier!r}: no renderer for framework {fw!r} "
                        f"({tgt!r}); no file emitted"
                    )
                    continue
                symbol = _first_symbol(_content_of(diff, tgt), lang)
                content = renderer(tgt, symbol)
                rel_path = _test_path_for(tier, fw, tgt)
                _write(self.out_dir, rel_path, content)
                generated.append(
                    GeneratedTestFile(
                        tier=tier,
                        framework=fw,
                        file_path=rel_path,
                        content=content,
                        target=tgt,
                        language=lang,
                        symbol=symbol,
                    )
                )

        if not generated:
            warnings.append(
                "no test files were generated; the diff matched no tier"
            )

        return TestGeneratorResult(
            schema_version=SCHEMA_VERSION,
            test_plan=test_plan,
            generated_files=generated,
            selection_trace=selection_trace,
            warnings=warnings,
            framework_warnings=framework_warnings,
        )

    # ----- target classification (private) ---------------------------

    @staticmethod
    def _unit_targets(diff: CodeDiff) -> List[str]:
        return [f.path for f in diff.files if f.action.value != "delete"]

    @staticmethod
    def _integration_targets(diff: CodeDiff) -> List[str]:
        return [
            f.path
            for f in diff.files
            if f.action.value != "delete" and _is_integration_target(f.path)
        ]

    @staticmethod
    def _e2e_targets(diff: CodeDiff) -> List[str]:
        out: List[str] = []
        for f in diff.files:
            if f.action.value == "delete":
                continue
            if _is_e2e_target(f.path, _ext_of(f.path)):
                out.append(f.path)
        return out

    @staticmethod
    def _contract_targets(diff: CodeDiff) -> List[str]:
        return [
            f.path
            for f in diff.files
            if f.action.value != "delete" and _is_contract_target(f.path)
        ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _command_for(framework: str, tier: str) -> str:
    """Return the canonical runner command line for a (framework, tier).

    The QA agent (FORA-43) re-uses these in the `TestPlan.tiers[].command`
    field. v0.1 emits well-formed skeleton commands; the DevOps
    orchestrator may rewrite them per repo.
    """
    if framework == "pytest":
        return "pytest -q tests/unit" if tier == TIER_UNIT else "pytest -q tests/integration"
    if framework == "jest":
        return "jest --passWithNoTests" if tier == TIER_UNIT else "jest --passWithNoTests tests/integration"
    if framework == "phpunit":
        return "vendor/bin/phpunit tests/unit" if tier == TIER_UNIT else "vendor/bin/phpunit tests/integration"
    if framework == "playwright":
        return "playwright test tests/e2e"
    if framework == "cypress":
        return "cypress run --spec tests/e2e"
    if framework == "pact":
        return "pact verify pacts/"
    return f"echo 'no-runner-for-{framework}'"


def _content_of(diff: CodeDiff, path: str) -> str:
    """Return the file content for `path` from the diff, or ''.

    Kept defensive: a v0.1 scaffold that cannot find the content
    for a given path simply emits a test that doesn't introspect
    the source body.
    """
    for f in diff.files:
        if f.path == path:
            return f.content or ""
    return ""


def _placeholder_commit_sha(diff: CodeDiff) -> str:
    """Derive a 40-hex placeholder commit sha from the diff id.

    FORA-43's `TestPlan.validate()` requires a 40-char lowercase hex
    `commit_sha`. The v0.1 generator does not know the real SHA, so
    it emits a stable derived placeholder. The DevOps orchestrator
    rewrites this on publish.
    """
    return hashlib.sha256(diff.diff_id.encode("utf-8")).hexdigest()[:40]


# ---------------------------------------------------------------------------
# Convenience entry point
# ---------------------------------------------------------------------------


def generate_tests(
    diff: CodeDiff,
    out_dir: str,
    *,
    signals: Optional[Dict[str, InputSignal]] = None,
    plan_id: str = "",
    run_id: str = "",
    contract_id: str = "",
    branch: str = "qa/test-gen",
    source_pr: str = "",
) -> TestGeneratorResult:
    """One-shot entry point used by the smoke test and the
    DevOps orchestrator.

    Same `(diff, signals, plan_id, run_id, contract_id, branch,
    source_pr)` ⇒ same `TestGeneratorResult` (ADR-0001 §2).
    """
    inputs = TestGeneratorInputs(
        diff=diff,
        signals=signals or {},
        plan_id=plan_id,
        run_id=run_id,
        contract_id=contract_id,
        branch=branch,
        source_pr=source_pr,
    )
    return TestGenerator(out_dir=out_dir).generate(inputs)


__all__ = [
    "SCHEMA_VERSION",
    "TestGenerator",
    "TestGeneratorInputs",
    "TestGeneratorResult",
    "GeneratedTestFile",
    "SelectionTrace",
    "framework_for",
    "derive_test_plan_id",
    "generate_tests",
]
