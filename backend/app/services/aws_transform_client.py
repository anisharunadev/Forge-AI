"""AWS Transform client (F-601 / DL-029).

Forge does NOT reimplement source-to-target translation. The Refactor
Agent delegates that heavy lifting to AWS Transform (via the boto3
``transform`` client). This module is the thin wrapper the agent
calls.

Why a wrapper
-------------
* Single place that knows the AWS service name and SDK quirks.
* Graceful degradation: boto3 is OPTIONAL. If the package isn't
  installed or AWS credentials aren't configured, ``AWSTransformClient``
  logs a warning and returns a placeholder result so the agent can
  still emit a :class:`MigrationPlan` with a heuristic inventory
  derived from the source repo.
* Testability: ``boto3_client_factory`` is injectable so tests can
  swap in a mock without monkey-patching ``boto3.client``.

Job lifecycle
-------------
1. ``start_job(source_inventory)`` -> ``job_id``
2. ``poll_job(job_id)`` -> ``status`` (one of SUCCEEDED / FAILED /
   IN_PROGRESS) and ``results``
3. ``get_results(job_id)`` -> ``dict`` containing AWS Transform's
   translated inventory / diagram output

The Refactor Agent only needs ``start_job`` + ``poll_job``. The
``get_results`` method is exposed so other agents can consume the raw
AWS Transform payload downstream.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class Boto3ClientFactory(Protocol):
    """Protocol for the boto3 client factory.

    Tests inject a callable that returns a stand-in for
    ``boto3.client("transform", ...)`` without needing boto3 installed.
    """

    def __call__(self, service_name: str, **kwargs: Any) -> Any:  # pragma: no cover
        ...


@dataclass(slots=True)
class TransformJob:
    """In-memory representation of an AWS Transform job."""

    job_id: str
    status: str = "IN_PROGRESS"
    submitted_at: float = field(default_factory=time.time)
    results: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "submitted_at": self.submitted_at,
            "results": self.results,
            "error": self.error,
        }


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class AWSTransformClient:
    """Thin wrapper around boto3's ``transform`` client.

    Falls back to a placeholder when boto3 / credentials are missing.
    The :class:`.RefactorAgent` is expected to use this client through
    the ``start_job`` / ``poll_job`` interface only.
    """

    def __init__(
        self,
        *,
        region: str = "us-east-1",
        poll_interval_seconds: float = 5.0,
        max_polls: int = 60,
        boto3_client_factory: Boto3ClientFactory | None = None,
    ) -> None:
        self._region = region
        self._poll_interval = poll_interval_seconds
        self._max_polls = max_polls
        self._factory = boto3_client_factory
        self._client: Any | None = None
        self._init_failed: bool = False
        self._jobs: dict[str, TransformJob] = {}
        self._disabled: bool = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def _try_init(self) -> Any | None:
        """Lazily initialize the boto3 client.

        Returns the client on success, ``None`` on any failure (logged
        at warning level). Subsequent calls reuse the cached client
        (or the cached failure flag).
        """
        if self._client is not None:
            return self._client
        if self._init_failed or self._disabled:
            return None

        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError:
            logger.warning(
                "aws_transform.boto3_missing",
                extra={"detail": "boto3 not installed; using placeholder client"},
            )
            self._init_failed = True
            return None

        try:
            factory: Boto3ClientFactory = self._factory or boto3.client  # type: ignore[assignment]
            self._client = factory("transform", region_name=self._region)
            return self._client
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "aws_transform.init_failed",
                extra={"error": f"{type(exc).__name__}: {exc}"},
            )
            self._init_failed = True
            return None

    @property
    def available(self) -> bool:
        """``True`` when boto3 + AWS credentials are usable."""
        return self._try_init() is not None

    # ------------------------------------------------------------------
    # Job API
    # ------------------------------------------------------------------

    def start_job(self, source_inventory: dict[str, Any]) -> str:
        """Submit an inventory to AWS Transform.

        Returns the ``job_id``. If the boto3 client cannot be
        initialised, returns a synthetic ``placeholder-...`` id so the
        caller can still proceed and emit a heuristic plan.
        """
        client = self._try_init()
        if client is None:
            placeholder = f"placeholder-{int(time.time() * 1000)}"
            self._jobs[placeholder] = TransformJob(
                job_id=placeholder,
                status="PLACEHOLDER",
                results={
                    "source_inventory": source_inventory,
                    "note": "AWS Transform unavailable; placeholder used.",
                },
            )
            logger.info(
                "aws_transform.start_job.placeholder",
                extra={"job_id": placeholder},
            )
            return placeholder

        try:
            response = client.start_transform_job(
                sourceRepositoryUrl=source_inventory.get("repository_url", ""),
                sourceLanguage=source_inventory.get("language", "java"),
                targetLanguage=source_inventory.get("target_language", "java"),
            )
            job_id = response.get("jobId") or response.get("transformJobId")
            if not job_id:
                raise RuntimeError("AWS Transform returned no jobId")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "aws_transform.start_job.failed",
                extra={"error": f"{type(exc).__name__}: {exc}"},
            )
            placeholder = f"placeholder-{int(time.time() * 1000)}"
            self._jobs[placeholder] = TransformJob(
                job_id=placeholder,
                status="FAILED",
                error=f"{type(exc).__name__}: {exc}",
            )
            return placeholder

        self._jobs[job_id] = TransformJob(job_id=job_id, status="IN_PROGRESS")
        logger.info("aws_transform.start_job", extra={"job_id": job_id})
        return job_id

    def poll_job(self, job_id: str) -> TransformJob:
        """Poll an in-flight job until it reaches a terminal status.

        A real call delegates to ``describe_transform_job``. In
        placeholder mode (no boto3), returns the cached job unchanged
        so the agent can move forward.
        """
        client = self._try_init()
        cached = self._jobs.get(job_id)
        if cached is None:
            raise LookupError(f"unknown job_id {job_id}")

        if cached.status in {"PLACEHOLDER", "FAILED", "SUCCEEDED"}:
            return cached

        if client is None:
            return cached

        for _attempt in range(self._max_polls):
            try:
                response = client.describe_transform_job(transformJobId=job_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "aws_transform.describe_failed",
                    extra={"job_id": job_id, "error": f"{type(exc).__name__}: {exc}"},
                )
                cached.status = "FAILED"
                cached.error = f"{type(exc).__name__}: {exc}"
                return cached

            status = response.get("status", "IN_PROGRESS")
            cached.status = status
            if status in {"SUCCEEDED", "FAILED"}:
                cached.results = response.get("results", {})
                cached.error = response.get("failureReason")
                return cached

            time.sleep(self._poll_interval)

        cached.status = "TIMEOUT"
        cached.error = "exceeded max_polls"
        return cached

    def get_results(self, job_id: str) -> dict[str, Any]:
        """Return the cached results dict for ``job_id``."""
        cached = self._jobs.get(job_id)
        if cached is None:
            raise LookupError(f"unknown job_id {job_id}")
        return cached.results


# ---------------------------------------------------------------------------
# Module-level singleton (lazy)
# ---------------------------------------------------------------------------

_default_client: AWSTransformClient | None = None


def get_default_client() -> AWSTransformClient:
    """Return the process-wide :class:`AWSTransformClient`."""
    global _default_client  # noqa: PLW0603
    if _default_client is None:
        _default_client = AWSTransformClient()
    return _default_client


__all__ = [
    "AWSTransformClient",
    "TransformJob",
    "Boto3ClientFactory",
    "get_default_client",
]
