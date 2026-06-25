"""Phase 3 ideation source-pullers + synthesizer.

Each puller reads from one external source via the in-process MCP
client and writes raw rows to ``ideation_source_signals``. The
``synthesizer`` clusters uncategorized signals into Ideas.

Mirrors the Phase 1 ``jira_consumer`` shape: async functions,
RULE-2 tenant + project always present, structured logging.
"""

from __future__ import annotations

__all__: list[str] = []