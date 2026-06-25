"""Connector ingestion services (Pillar 1 — Phase 1).

Bridges the TypeScript ``packages/connector-events`` family into the
Python in-process bus. Subscribers on this side turn raw
``connector.event.observed`` payloads into typed ``Idea`` upserts,
``IdeaStatus`` transitions, and ``add_comment`` MCP calls.
"""
