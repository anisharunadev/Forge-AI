"""Prompt templates for Forge agent sub-graphs.

Each sub-graph owns its own prompt template:

* ``sdlc.j2``            — SDLC supervisor (when present)
* ``code_validator.j2``  — F-501 Code Validator sub-graph

Templates are intentionally not imported by node modules at module
load time — they are loaded lazily by the sub-graph entry point so the
template path can be overridden in tests.
"""

from __future__ import annotations

import os  # noqa: F401
from pathlib import Path
from typing import Any

_PROMPTS_DIR = Path(__file__).resolve().parent


def _load_template(name: str) -> str:
    """Load a Jinja2 template by filename."""
    path = _PROMPTS_DIR / name
    if not path.is_file():
        raise FileNotFoundError(f"prompt template missing: {path}")
    return path.read_text(encoding="utf-8")


def render(name: str, **context: Any) -> str:
    """Render a prompt template.

    Uses Jinja2 if available (it ships transitively with langchain).
    Falls back to a basic ``str.format_map`` if Jinja2 is not installed.
    """
    template_text = _load_template(name)
    try:
        from jinja2 import Environment, StrictUndefined

        env = Environment(
            autoescape=False,
            undefined=StrictUndefined,
            keep_trailing_newline=True,
        )
        template = env.from_string(template_text)
        return template.render(**context)
    except ImportError:
        # Fallback: best-effort format_map. Jinja expressions in the
        # template become literal text, but plain {{ var }} still works.
        return template_text.replace(
            "{{ validator_version }}",
            str(context.get("validator_version", "")),
        )


def load_code_validator_prompt(**context: Any) -> str:
    """Load + render the Code Validator system prompt (NFR-043)."""
    return render("code_validator.j2", **context)


__all__ = ["render", "load_code_validator_prompt"]
