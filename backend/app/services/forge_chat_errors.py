"""Typed errors for the Forge chat surface.

All chat-side failures map to one of these so the API layer can emit a
uniform error envelope: ``{"ok": false, "error": {"code", "message", "details"}}``.
"""

from __future__ import annotations

from typing import Any


class ForgeChatError(Exception):
    """Base class for Forge chat surface errors."""

    code: str = "forge_chat_error"
    status_code: int = 500

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.__class__.__doc__ or self.code
        self.details: dict[str, Any] = dict(details or {})
        super().__init__(f"[{self.code}] {self.message}")


class AuthenticationError(ForgeChatError):
    code = "authentication_error"
    status_code = 401
    message = "Invalid or missing virtual key"


class AgentBudgetExceededError(ForgeChatError):
    code = "agent_budget_exceeded"
    status_code = 402
    message = "Agent budget exceeded"

    def __init__(
        self,
        *,
        agent_id: str,
        spent_usd: float,
        ceiling_usd: float,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.spent_usd = spent_usd
        self.ceiling_usd = ceiling_usd
        merged = {
            "agent_id": agent_id,
            "spent_usd": spent_usd,
            "ceiling_usd": ceiling_usd,
            **(details or {}),
        }
        super().__init__(details=merged)


class ContextLengthExceededError(ForgeChatError):
    code = "context_length_exceeded"
    status_code = 413
    message = "Context length exceeded"


class ValidationError(ForgeChatError):
    code = "validation_error"
    status_code = 422
    message = "Request validation failed"


class RateLimitError(ForgeChatError):
    code = "rate_limit_error"
    status_code = 429
    message = "Rate limit exceeded"

    def __init__(
        self,
        *,
        retry_after_seconds: float | int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.retry_after_seconds = retry_after_seconds
        merged = {
            "retry_after_seconds": retry_after_seconds,
            **(details or {}),
        }
        super().__init__(details=merged)


class GuardrailViolationError(ForgeChatError):
    """Placeholder for Phase 2 — guardrail enforcement on the chat path."""

    code = "guardrail_violation"
    status_code = 422
    message = "Guardrail blocked the request"


class UpstreamError(ForgeChatError):
    code = "upstream_error"
    status_code = 502
    message = "Upstream LLM error"

    def __init__(
        self,
        *,
        upstream_status: int | None = None,
        upstream_message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.upstream_status = upstream_status
        self.upstream_message = upstream_message
        merged = {
            "upstream_status": upstream_status,
            "upstream_message": upstream_message,
            **(details or {}),
        }
        super().__init__(details=merged)


_STATUS_TO_EXC: dict[int, type[ForgeChatError]] = {
    401: AuthenticationError,
    402: AgentBudgetExceededError,
    413: ContextLengthExceededError,
    429: RateLimitError,
}


def from_response_status(
    status_code: int, body: dict[str, Any] | None = None
) -> ForgeChatError:
    """Map an HTTP status from LiteLLM to a typed chat exception."""
    body = body or {}

    if status_code == 422:
        # Disambiguate validation vs guardrail by body shape.
        if "guardrail" in str(body).lower() or body.get("code") == "guardrail_violation":
            return GuardrailViolationError(details=body)
        return ValidationError(details=body)

    if status_code in _STATUS_TO_EXC:
        return _STATUS_TO_EXC[status_code](details=body)

    if 500 <= status_code < 600:
        return UpstreamError(upstream_status=status_code, details=body)

    return ForgeChatError(details=body)