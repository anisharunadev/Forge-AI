"""Architect sub-agent (Sync Plane Architect).

See charter.md in this directory for the role definition, ownership boundaries,
hard rules, cost budget, and day-0 success criteria.

The actual Architect implementation lives under the per-stage packages in this
repository (e.g. agents/sync_plane, agents/architecture) and is invoked by the
Paperclip runtime per the staged workflow in memory/architecture.md.

This package is the Knowledge Layer entry point — it carries the charter and
the 30/60/90 plan, not the runtime code. The runtime code is colocated with
the tools it implements; the charter travels with the agent's name.
"""
