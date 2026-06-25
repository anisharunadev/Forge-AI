"""Typed helpers for LiteLLM tool-calling (F-800 Plan 0.2).

This module owns the *shape* of tool calls flowing between Forge and
the LiteLLM proxy. Keeping the schema here (instead of inlined in
``litellm_client.py``) lets the Co-pilot tool registry (Plan 0.3)
import the same types without depending on the HTTP client.

The on-the-wire shape mirrors OpenAI's function-calling schema:

    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "Search the project knowledge graph.",
            "parameters": {<JSON Schema>},
        },
    }

LiteLLM proxies that schema verbatim to upstream providers, so we do
not need provider-specific forks.

Exports:

- ``ToolSpec`` — TypedDict describing one tool the model may call.
- ``ToolCall`` — dataclass for a single tool invocation returned by
  the model (``id``, ``name``, ``arguments_json``).
- ``ToolResult`` — dataclass for the executor's reply (``tool_call_id``,
  ``name``, ``content``, ``is_error``).
- ``ToolLoopExhausted`` — raised when ``agent_loop`` hits ``max_turns``
  without the model returning a final answer.
- ``ToolExecutor`` — ``Callable[[ToolCall], Awaitable[ToolResult]]``
  alias used by ``agent_loop``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, TypedDict


class ToolSpec(TypedDict):
    """OpenAI-compatible tool spec.

    Fields:
        type: always ``"function"`` for the OpenAI function-calling
            schema LiteLLM accepts today.
        function: ``{"name", "description", "parameters"}`` where
            ``parameters`` is a JSON Schema object describing the
            tool's arguments.
    """

    type: str  # always "function"
    function: dict[str, object]


@dataclass(frozen=True)
class ToolCall:
    """A single tool invocation requested by the model.

    Attributes:
        id: Provider-assigned identifier; must be echoed back in the
            corresponding :class:`ToolResult` so the model can match
            results to calls.
        name: Tool name (matches the ``function.name`` in the spec).
        arguments_json: JSON-encoded argument string. Kept as a raw
            string to avoid a second serialization round-trip; the
            executor is responsible for parsing it.
    """

    id: str
    name: str
    arguments_json: str


@dataclass(frozen=True)
class ToolResult:
    """The executor's reply to a :class:`ToolCall`.

    Attributes:
        tool_call_id: The :attr:`ToolCall.id` this result answers.
        name: Echoed tool name (matches the originating call).
        content: Human-/model-readable payload. For errors this is the
            error message; the model sees ``is_error=True`` as a
            separate signal and is expected to recover.
        is_error: ``True`` when the executor failed; the model is
            shown the error content and may retry or surface it to
            the user. Defaults to ``False``.
    """

    tool_call_id: str
    name: str
    content: str
    is_error: bool = False


class ToolLoopExhausted(RuntimeError):
    """Raised when ``agent_loop`` reaches ``max_turns`` without convergence.

    Attributes:
        max_turns: The cap that was hit. Carried on the exception so
            callers can map it to a 503 response with a useful message.
    """

    def __init__(self, max_turns: int) -> None:
        super().__init__(
            f"agent_loop hit the {max_turns}-turn cap without the model "
            "returning a final answer"
        )
        self.max_turns = max_turns


# Executor signature consumed by ``LiteLLMClient.agent_loop``.
ToolExecutor = Callable[[ToolCall], Awaitable[ToolResult]]


__all__ = [
    "ToolSpec",
    "ToolCall",
    "ToolResult",
    "ToolLoopExhausted",
    "ToolExecutor",
]