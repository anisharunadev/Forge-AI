"""Structlog processor that scrubs secrets from any log event.

Phase 1 / step-75 F1: Master key, virtual keys, Authorization headers must
never appear in any log line, even at DEBUG. This processor walks the
event dict (no recursion beyond one level — values stay primitives) and
redacts:

* The string ``Authorization: Bearer <key>`` in any header-shaped field
* Any value matching ``^sk-[a-zA-Z0-9]{16,}`` (LiteLLM key prefix)
* Any value equal to ``settings.litellm_master_key`` (env var name included)

Spec lines 75-77 and 93-94. Anti-pattern check: ``grep -r
LITELLM_MASTER_KEY logs/`` returns 0 after a 100-request load.
"""

from __future__ import annotations

import re
from typing import Any

from structlog.types import EventDict, Processor

from app.core.config import settings

# ponytail: regex is intentionally cheap (linear, no backtracking on
# most inputs). Match sk-/sk_-prefix LiteLLM keys plus Forge prefixes.
_KEY_PREFIX_RE = re.compile(r"\b(sk[__-][A-Za-z0-9_-]{12,})")
_BEARER_RE = re.compile(r"(?i)bearer\s+([A-Za-z0-9._\-]+)")
_AUTH_HEADER_RE = re.compile(r"(?i)^authorization$")

_REDACTED = "[REDACTED]"


def _redact_string(value: str, *, master_key: str | None) -> str:
    """Apply regex redactions; replace full master-key occurrences."""
    if master_key and master_key and value == master_key:
        return _REDACTED
    if _KEY_PREFIX_RE.search(value):
        value = _KEY_PREFIX_RE.sub("sk-[REDACTED]", value)
    if _BEARER_RE.search(value):
        value = _BEARER_RE.sub("Bearer [REDACTED]", value)
    return value


def secret_filter(_logger: Any, _name: str, event_dict: EventDict) -> EventDict:
    """Structlog processor (module-level, no __call__ args beyond _logger/_name).

    Walks the top-level event_dict replacing sensitive values. Lists and
    nested dicts are walked one level deep — anything deeper is the
    caller's responsibility (and we never stuff secrets deeper than one
    level at the boundary anyway).
    """
    master = settings.litellm_master_key or settings.litellm_admin_key or None
    for key, value in list(event_dict.items()):
        if isinstance(value, str):
            event_dict[key] = _redact_string(value, master_key=master)
        elif isinstance(value, list):
            event_dict[key] = [
                _redact_string(v, master_key=master) if isinstance(v, str) else v for v in value
            ]
        elif isinstance(value, dict):
            for k, v in list(value.items()):
                if isinstance(v, str):
                    if _AUTH_HEADER_RE.match(k):
                        value[k] = _REDACTED
                    else:
                        value[k] = _redact_string(v, master_key=master)
    return event_dict


def make_secret_processor() -> Processor:
    """Return a structlog-compatible bound processor."""
    return secret_filter


__all__ = ["secret_filter", "make_secret_processor"]
