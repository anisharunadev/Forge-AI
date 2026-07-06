"""M2 Plan 01-04 (PITFALL-6) — scheduler facade.

Re-exports the canonical approval-expiry surface from
:mod:`app.scheduler.approval_expiry` so callers can import from a
single location.
"""

from app.scheduler.approval_expiry import (
    ApprovalExpiryService,
    approval_expiry_service,
    effective_timeout_hours,
    start_scheduler,
    stop_scheduler,
)

__all__ = [
    "ApprovalExpiryService",
    "approval_expiry_service",
    "effective_timeout_hours",
    "start_scheduler",
    "stop_scheduler",
]
