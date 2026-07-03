"""Structured logging configuration.

JSON in production; key=value in development. Every log line carries
tenant_id and project_id via contextvars when set, so audit/observability
(Rule 6, Rule 7) is automatic.
"""

from __future__ import annotations

import logging
import sys
from contextvars import ContextVar
from typing import Any

import structlog

from app.core.secret_filter import secret_filter

# Context that propagates through async boundaries via contextvars.
tenant_id_ctx: ContextVar[str | None] = ContextVar("tenant_id", default=None)
project_id_ctx: ContextVar[str | None] = ContextVar("project_id", default=None)
actor_id_ctx: ContextVar[str | None] = ContextVar("actor_id", default=None)


def _inject_context(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """structlog processor: inject tenant/project/actor from contextvars."""
    if (tid := tenant_id_ctx.get()) is not None:
        event_dict.setdefault("tenant_id", tid)
    if (pid := project_id_ctx.get()) is not None:
        event_dict.setdefault("project_id", pid)
    if (aid := actor_id_ctx.get()) is not None:
        event_dict.setdefault("actor_id", aid)
    return event_dict


def configure_logging(level: str = "INFO", json_output: bool | None = None) -> None:
    """Configure stdlib logging + structlog.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR).
        json_output: Force JSON logs. Defaults to True outside development.
    """
    if json_output is None:
        from app.core.config import settings

        json_output = settings.environment != "development"

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    # step-75 Phase 1 — SecretFilter is the FIRST processor so it
    # redacts sensitive values before any other transformation
    # (timestamps, log levels, etc.) sees them. ponytail: this means
    # DEBUG-level log lines that include a raw Authorization header
    # never leak the key.
    shared_processors: list[structlog.types.Processor] = [
        secret_filter,
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        _inject_context,
        timestamper,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if json_output:
        renderer: structlog.types.Processor = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper())),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Bridge stdlib (uvicorn, sqlalchemy) into structlog.
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            processor=renderer,
            foreign_pre_chain=shared_processors,
        )
    )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger."""
    return structlog.get_logger(name)
