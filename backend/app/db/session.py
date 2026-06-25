"""Async SQLAlchemy session factory.

Uses asyncpg. The factory is set up lazily so import-time doesn't open
a pool; tests and CLI tools can run without DATABASE_URL set.
"""

from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Lazy engine singleton."""
    global _engine
    if _engine is None:
        logger.info("db.engine.create", url=_safe_url())
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_pre_ping=True,
            future=True,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Lazy session factory singleton."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yield a session, close on exit."""
    factory = get_session_factory()
    async with factory() as session:
        yield session


def _safe_url() -> str:
    """Render DATABASE_URL with credentials masked for logs."""
    url = settings.database_url
    if "@" in url:
        head, tail = url.split("@", 1)
        if "://" in head:
            scheme, _ = head.split("://", 1)
            return f"{scheme}://***@{tail}"
    return url
