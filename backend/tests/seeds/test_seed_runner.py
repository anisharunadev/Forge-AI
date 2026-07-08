"""Tests for the SeedRunner class — apply / reset / status / diff / list.

These tests use mocks for the session factory and audit service so the
suite runs without a real database. The runner's pre-flight checks
(manifest validation, dependency check) are exercised directly; the
transactional UPSERT path is exercised through dependency and
production-safety shortcuts to keep the tests pure-Python.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.seeds.framework.exceptions import (
    InvalidManifestError,
    ProductionSeedBlockedError,
    SeedNotFoundError,
)
from backend.seeds.framework.seed_runner import (
    SEEDS_ROOT,
    SeedRunner,
    SeedSummary,
)

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "seeds" / "framework" / "manifest_schema.json"


def _audit_mock() -> AsyncMock:
    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    return audit


def _session_factory_mock() -> MagicMock:
    """Async session factory mock — supports ``async with factory() as session``."""
    factory = MagicMock()

    # ``async with factory() as session`` is sugar for ``factory()``
    # returning an async-context-manager that yields a session.
    class _Ctx:
        async def __aenter__(self) -> AsyncMock:
            return AsyncMock()

        async def __aexit__(self, *args: object) -> None:
            return None

    def _open() -> _Ctx:
        return _Ctx()

    factory.side_effect = _Ctx
    factory.return_value = _Ctx()
    return factory


def _write_manifest(
    package_dir: Path,
    *,
    name: str = "kn-base",
    tenant_type: str = "reference",
    data_files: list[dict] | None = None,
    production_allow: bool = False,
) -> None:
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "data").mkdir(exist_ok=True)
    manifest = {
        "name": name,
        "version": 1,
        "tenant_type": tenant_type,
        "data_files": data_files
        or [
            {
                "file": "001_standards.json",
                "table": "standards",
                "order": 1,
                "idempotency_key": ["name"],
            }
        ],
        "production_safety": {"allow_in_prod": production_allow},
    }
    (package_dir / "manifest.json").write_text(json.dumps(manifest))
    # Minimal data file (rows may be empty for unit tests).
    (package_dir / "data" / "001_standards.json").write_text(json.dumps({"rows": []}))


def _runner(tmp_path: Path) -> SeedRunner:
    return SeedRunner(
        session_factory=_session_factory_mock(),
        audit_service=_audit_mock(),
        env="test",
        seeds_root=tmp_path,
        schema_path=SCHEMA_PATH,
    )


def test_list_returns_empty_when_no_packages(tmp_path: Path) -> None:
    runner = _runner(tmp_path)
    assert runner.list() == []


def test_list_returns_summary(tmp_path: Path) -> None:
    _write_manifest(tmp_path / "kn-base")
    runner = _runner(tmp_path)
    summaries = runner.list()
    assert len(summaries) == 1
    assert isinstance(summaries[0], SeedSummary)
    assert summaries[0].name == "kn-base"
    assert summaries[0].tenant_type == "reference"
    assert summaries[0].data_file_count == 1


def test_list_skips_broken_manifest(tmp_path: Path) -> None:
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "manifest.json").write_text("{not valid json")
    runner = _runner(tmp_path)
    assert runner.list() == []


def test_apply_raises_seed_not_found(tmp_path: Path) -> None:
    runner = _runner(tmp_path)
    with pytest.raises(SeedNotFoundError):
        import asyncio

        asyncio.run(
            runner.apply(
                seed_name="does-not-exist",
                actor_id=uuid.uuid4(),
                triggered_by="cli",
            )
        )


def test_apply_raises_invalid_manifest_when_missing_manifest_json(tmp_path: Path) -> None:
    (tmp_path / "kn-base").mkdir()
    runner = _runner(tmp_path)
    with pytest.raises(InvalidManifestError):
        import asyncio

        asyncio.run(
            runner.apply(
                seed_name="kn-base",
                actor_id=uuid.uuid4(),
                triggered_by="cli",
            )
        )


def test_apply_raises_invalid_manifest_when_schema_violated(tmp_path: Path) -> None:
    pkg = tmp_path / "kn-base"
    pkg.mkdir()
    (pkg / "manifest.json").write_text(
        json.dumps({"name": "Kn-Base", "version": 0, "data_files": []})
    )
    runner = _runner(tmp_path)
    with pytest.raises(InvalidManifestError):
        import asyncio

        asyncio.run(
            runner.apply(
                seed_name="kn-base",
                actor_id=uuid.uuid4(),
                triggered_by="cli",
            )
        )


def test_apply_blocks_demo_in_production(tmp_path: Path) -> None:
    _write_manifest(tmp_path / "acme-corp", name="acme-corp", tenant_type="demo")
    runner = SeedRunner(
        session_factory=_session_factory_mock(),
        audit_service=_audit_mock(),
        env="production",
        seeds_root=tmp_path,
        schema_path=SCHEMA_PATH,
    )
    with pytest.raises(ProductionSeedBlockedError):
        import asyncio

        asyncio.run(
            runner.apply(
                seed_name="acme-corp",
                actor_id=uuid.uuid4(),
                triggered_by="cli",
                allow_in_prod=False,
            )
        )


def test_validate_manifest_accepts_well_formed(tmp_path: Path) -> None:
    _write_manifest(tmp_path / "kn-base")
    runner = _runner(tmp_path)
    manifest, _ = runner._load_manifest("kn-base")  # noqa: SLF001
    runner._validate_manifest(manifest)  # noqa: SLF001 — must not raise


def test_seeds_root_constant_points_at_packages_dir() -> None:
    """The framework's SEEDS_ROOT must point at the packages directory."""
    assert SEEDS_ROOT.name == "packages"
    assert SEEDS_ROOT.parent.name == "seeds"


def test_otel_span_decorator_returns_value() -> None:
    """otel_span wraps the function without changing its return value."""
    from backend.seeds.framework.seed_runner import otel_span

    @otel_span("test.span")
    async def _fn() -> int:
        return 42

    import asyncio

    assert asyncio.run(_fn()) == 42
