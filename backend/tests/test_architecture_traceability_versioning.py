"""Tests for F-306 (Traceability) and F-307 (Versioning)."""

from uuid import uuid4

import pytest

from backend.app.services.architecture.traceability import TraceabilityService
from backend.app.services.architecture.versioning import ArchitectureVersioningService


@pytest.mark.asyncio
async def test_build_matrix_returns_structure():
    service = TraceabilityService()
    matrix = await service.build_matrix(uuid4(), uuid4())
    assert "nodes" in matrix
    assert "edges" in matrix


@pytest.mark.asyncio
async def test_get_lineage_returns_structure():
    service = TraceabilityService()
    lineage = await service.get_lineage("adr", uuid4(), "upstream")
    assert lineage["direction"] == "upstream"


@pytest.mark.asyncio
async def test_find_orphans():
    service = TraceabilityService()
    orphans = await service.find_orphans(uuid4(), uuid4())
    assert isinstance(orphans, list)


@pytest.mark.asyncio
async def test_create_version():
    service = ArchitectureVersioningService()
    version = await service.create_version("adr", uuid4(), "test snapshot", uuid4())
    assert version.artifact_type == "adr"
    assert version.snapshot_reason == "test snapshot"


@pytest.mark.asyncio
async def test_list_versions():
    service = ArchitectureVersioningService()
    versions = await service.list_versions("adr", uuid4())
    assert isinstance(versions, list)


@pytest.mark.asyncio
async def test_diff_versions():
    service = ArchitectureVersioningService()
    diff = await service.diff_versions(uuid4(), uuid4())
    assert "added" in diff
    assert "removed" in diff
    assert "modified" in diff


@pytest.mark.asyncio
async def test_rollback_creates_new_version():
    service = ArchitectureVersioningService()
    new_version = await service.rollback_to_version("adr", uuid4(), uuid4(), uuid4())
    assert "rollback" in new_version.snapshot_reason.lower()
