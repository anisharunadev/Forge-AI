"""step-78 F14 — async (files / batches / fine-tuning / responses) schemas.

Typed artifacts for the long-running-workload surface. The fields here
mirror LiteLLM's ``/v1/files``, ``/v1/batches``, ``/v1/fine_tuning/jobs``,
and ``/v1/responses`` shapes so the HTTP layer can hand back the same
payload LiteLLM produces. Where the spec calls for a derived field
(e.g. ``bytes`` on a file, parsed JSONL on batch results) we materialise
it on top of the upstream response.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import Field

from app.schemas.common import ForgeBaseModel

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class FilePurpose(StrEnum):
    ASSISTANTS = "assistants"
    BATCH = "batch"
    FINE_TUNE = "fine-tune"
    VISION = "vision"
    USER_DATA = "user_data"
    EVALS = "evals"


class BatchStatus(StrEnum):
    VALIDATING = "validating"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    FAILED = "failed"


class FineTuneStatus(StrEnum):
    VALIDATING_FILES = "validating_files"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    FAILED = "failed"


class ResponseStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


class FileCreate(ForgeBaseModel):
    purpose: FilePurpose = FilePurpose.USER_DATA
    content_b64: str | None = None
    filename: str | None = None
    content_type: str | None = None


class FileRead(ForgeBaseModel):
    id: str
    purpose: str
    bytes: int = 0
    created_at: datetime | int | None = None
    filename: str | None = None
    content_type: str | None = None


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------


class BatchCreate(ForgeBaseModel):
    input_file_id: str
    endpoint: str = "/v1/chat/completions"
    completion_window: str = "24h"
    metadata: dict[str, Any] | None = None


class BatchRequestCounts(ForgeBaseModel):
    total: int = 0
    completed: int = 0
    failed: int = 0


class BatchRead(ForgeBaseModel):
    id: str
    status: str
    endpoint: str | None = None
    input_file_id: str | None = None
    completion_window: str | None = None
    output_file_id: str | None = None
    error_file_id: str | None = None
    request_counts: BatchRequestCounts = Field(default_factory=BatchRequestCounts)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | int | None = None
    cancelled_at: datetime | int | None = None
    completed_at: datetime | int | None = None
    failed_at: datetime | int | None = None


class BatchResultsResponse(ForgeBaseModel):
    batch_id: str
    output_file_id: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
    jsonl_content: str | None = None
    line_count: int = 0
    parsed_lines: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Fine-tuning
# ---------------------------------------------------------------------------


class FineTuneHyperparameters(ForgeBaseModel):
    n_epochs: int | Literal["auto"] = "auto"
    learning_rate_multiplier: float | Literal["auto"] = "auto"
    batch_size: int | Literal["auto"] = "auto"


class FineTuneJobCreate(ForgeBaseModel):
    model: str
    training_file: str
    validation_file: str | None = None
    hyperparameters: FineTuneHyperparameters | None = None
    suffix: str | None = None


class FineTuneJobRead(ForgeBaseModel):
    id: str
    model: str
    status: str
    fine_tuned_model: str | None = None
    trained_tokens: int | None = None
    training_file: str | None = None
    validation_file: str | None = None
    hyperparameters: dict[str, Any] | None = None
    suffix: str | None = None
    error: dict[str, Any] | None = None
    created_at: datetime | int | None = None
    finished_at: datetime | int | None = None


# ---------------------------------------------------------------------------
# Background responses
# ---------------------------------------------------------------------------


class ResponseInputItem(ForgeBaseModel):
    role: Literal["user", "system", "assistant", "tool"] = "user"
    content: Any


class ResponseCreate(ForgeBaseModel):
    model: str
    input: list[ResponseInputItem] | str | None = None
    instructions: str | None = None
    previous_response_id: str | None = None
    metadata: dict[str, Any] | None = None
    stream: bool | None = None


class ResponseRead(ForgeBaseModel):
    id: str
    status: ResponseStatus = ResponseStatus.QUEUED
    model: str | None = None
    output: list[Any] = Field(default_factory=list)
    usage: dict[str, Any] | None = None
    previous_response_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | int | None = None
    completed_at: datetime | int | None = None
    error: dict[str, Any] | None = None


class ResponseInputItemsRequest(ForgeBaseModel):
    items: list[ResponseInputItem] = Field(default_factory=list)


class CompactRequest(ForgeBaseModel):
    response_id: str
    keep_last_n_turns: int = 20
    strategy: Literal["truncate_turns", "summarize"] = "truncate_turns"


class WSProgressEvent(ForgeBaseModel):
    """Reserved shape for the future WebSocket job-progress stream."""

    event: str
    data: dict[str, Any] = Field(default_factory=dict)
    emitted_at: datetime | None = None


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class FineTuneUncancelable(ForgeBaseModel):
    error: str = "fine_tune_uncancelable"
    job_id: str
    status: str


class BatchNotCancellable(ForgeBaseModel):
    error: str = "batch_not_cancellable"
    batch_id: str
    status: str


__all__ = [
    "FilePurpose",
    "BatchStatus",
    "FineTuneStatus",
    "ResponseStatus",
    "FileCreate",
    "FileRead",
    "BatchCreate",
    "BatchRequestCounts",
    "BatchRead",
    "BatchResultsResponse",
    "FineTuneHyperparameters",
    "FineTuneJobCreate",
    "FineTuneJobRead",
    "ResponseInputItem",
    "ResponseCreate",
    "ResponseRead",
    "ResponseInputItemsRequest",
    "CompactRequest",
    "WSProgressEvent",
    "FineTuneUncancelable",
    "BatchNotCancellable",
]
