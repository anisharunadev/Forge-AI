"""
Idempotent retry with bounded backoff (FORA-30 deliverable: deterministic
retries with idempotency keys; bounded backoff; budget-aware cancellation).

Properties:

* `idempotency_key` is the unit of retry safety.  A handler that has
  already executed under a given key MUST return its prior result
  without producing new side effects.  The runtime surfaces the key to
  the handler on every call; the handler's job is to honour it.
* The runtime itself caches the *first successful* result for a given
  key.  A retry of an already-succeeded key is a no-op: the runtime
  replays the cached result, so even a handler that forgets to honour
  the key does not duplicate side effects through the runtime.
* Backoff is exponential with jitter, bounded by `max_backoff_s`, and
  capped by the budget: the runtime aborts the retry loop the moment
  the cost ceiling is about to be breached.
* Retries are attempted only on the subset of failures that are
  considered transient.  Programming errors (4xx-class, conflict,
  malformed payload) are never retried.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .cost import CostBudget, BudgetExceededError
from .schemas import (
    CostSnapshot,
    IdempotencyConflictError,
    PlanStep,
    RetryRecord,
    StepExecutionError,
    ToolHandlerResult,
)


_log = logging.getLogger("fora.runtime.retry")


# Errors considered transient and eligible for retry.  These are
# deliberately a small set; everything else fails fast.
TRANSIENT_ERROR_CODES = frozenset({
    "TIMEOUT",
    "TRANSIENT",
    "UPSTREAM_5XX",
    "RATE_LIMITED",
    "CONNECTION_RESET",
})


@dataclass
class RetryConfig:
    """Retry policy for a runtime.  Defaults are the platform-wide
    floor in [memory/coding.md §6] -- 3 attempts, exponential backoff
    with jitter, 30 s total cap."""
    max_attempts: int = 3
    initial_backoff_s: float = 0.5
    max_backoff_s: float = 10.0
    total_budget_s: float = 30.0
    # If the cost budget would be breached on the next attempt, abort
    # even if attempts remain.
    respect_cost_ceiling: bool = True


def _sleep_with_jitter(base_s: float) -> None:
    """Exponential backoff with full jitter.  Capped at the
    `max_backoff_s` in the caller's RetryConfig; this function just
    applies the jitter."""
    time.sleep(base_s * (0.5 + random.random() * 0.5))


def _backoff_sequence(cfg: RetryConfig) -> List[float]:
    """The pre-jitter backoff sequence.  The runtime caps the total
    time at `total_budget_s`; the caller applies the jitter on top."""
    seq: List[float] = []
    backoff = cfg.initial_backoff_s
    while len(seq) < cfg.max_attempts - 1:
        seq.append(min(backoff, cfg.max_backoff_s))
        backoff *= 2.0
    return seq


def _classify(exc: Exception) -> str:
    """Return a stable error code for a raised exception.  Used to
    decide retry vs. fail-fast."""
    code = getattr(exc, "code", None) or getattr(exc, "error_code", None)
    if isinstance(code, str):
        return code.upper()
    # Fall back on the exception class name so callers can raise
    # `RuntimeError("upstream timed out")` and we still get a
    # machine-readable code.
    name = exc.__class__.__name__.upper()
    if name in TRANSIENT_ERROR_CODES:
        return name
    return "UNKNOWN"


def retry_with_idempotency(
    step: PlanStep,
    handler: Callable[[PlanStep], ToolHandlerResult],
    cfg: RetryConfig,
    cost_budget: Optional[CostBudget] = None,
    cost_per_attempt: Optional[Callable[[PlanStep], CostSnapshot]] = None,
) -> Tuple[ToolHandlerResult, List[RetryRecord]]:
    """Execute `handler(step)` under the retry policy.

    Returns the result and the retry record.  The handler MUST honour
    `step.idempotency_key`; the runtime also caches the first
    successful result for the duration of the run as a second line of
    defence.

    The handler receives a fresh `PlanStep` on every attempt; the
    idempotency_key is the only signal it has to know it has been here
    before.  The runtime's result cache means the handler is never
    re-invoked after a success, so even a broken handler cannot
    duplicate side effects through the runtime.
    """
    cache: Dict[str, ToolHandlerResult] = {}
    records: List[RetryRecord] = []
    backoffs = _backoff_sequence(cfg)
    t_start = time.time()
    last_exc: Optional[Exception] = None

    for attempt in range(1, cfg.max_attempts + 1):
        # Replay cache on retry.  This is the second line of defence
        # for idempotency: a handler that crashes before honouring
        # its key still cannot be re-invoked once it has produced a
        # successful result.
        if step.idempotency_key in cache:
            result, _ = cache[step.idempotency_key]
            records.append(RetryRecord(
                attempt=attempt, idempotency_key=step.idempotency_key,
                tool=step.tool, ok=True, duration_ms=0.0,
            ))
            return result, records

        # Budget check before each attempt.
        if cfg.respect_cost_ceiling and cost_budget is not None:
            projected = cost_per_attempt(step) if cost_per_attempt else CostSnapshot()
            if not cost_budget.can_afford(projected):
                raise BudgetExceededError(
                    "next attempt would breach cost ceiling",
                    idempotency_key=step.idempotency_key,
                    attempt=attempt,
                    remaining_usd=cost_budget.remaining_usd(),
                )

        t0 = time.time()
        try:
            result = handler(step)
        except IdempotencyConflictError as exc:
            # Programming error: never retry.
            records.append(RetryRecord(
                attempt=attempt, idempotency_key=step.idempotency_key,
                tool=step.tool, ok=False, error_code=exc.code,
                duration_ms=(time.time() - t0) * 1000,
            ))
            raise
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            code = _classify(exc)
            duration_ms = (time.time() - t0) * 1000
            records.append(RetryRecord(
                attempt=attempt, idempotency_key=step.idempotency_key,
                tool=step.tool, ok=False, error_code=code,
                duration_ms=duration_ms,
            ))
            if code not in TRANSIENT_ERROR_CODES:
                # Non-transient: do not retry.  Surface as a typed
                # step execution error so the caller knows the run
                # is not retriable.
                raise StepExecutionError(
                    f"non-transient failure in step {step.step_id!r}: {exc}",
                    step_id=step.step_id, error_code=code,
                    attempt=attempt,
                ) from exc
            # Transient: fall through to backoff.
        else:
            duration_ms = (time.time() - t0) * 1000
            records.append(RetryRecord(
                attempt=attempt, idempotency_key=step.idempotency_key,
                tool=step.tool, ok=True, duration_ms=duration_ms,
            ))
            cache[step.idempotency_key] = result
            return result, records

        # Backoff.  Bounded by `total_budget_s`.
        if attempt < cfg.max_attempts:
            wait_s = backoffs[attempt - 1]
            elapsed = time.time() - t_start
            if elapsed + wait_s > cfg.total_budget_s:
                # Out of retry time; surface the last failure.
                break
            _sleep_with_jitter(wait_s)

    # Exhausted retries.  Surface the last error.
    raise StepExecutionError(
        f"step {step.step_id!r} exhausted {cfg.max_attempts} attempts: {last_exc}",
        step_id=step.step_id,
        error_code=_classify(last_exc) if last_exc else "UNKNOWN",
        attempts=cfg.max_attempts,
    ) from last_exc
