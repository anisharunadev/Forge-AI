"""F-800 — Forge Co-pilot service layer (Plans 0.3, 1.x).

The Co-pilot is a conversational assistant sitting on top of the
project knowledge graph, the architecture accelerator, and the audit
ledger. It is *not* an autonomous agent — every action is mediated
through typed :mod:`app.copilot.tools` which the registry dispatches
with explicit permission checks and tenant isolation (Rule 2 + Rule 3).

Plan 0.3 ships the **tool registry** and the 11 V1 tools from spec §3.3.
Plan 1.x ships the conversation/message service that consumes them.
"""
