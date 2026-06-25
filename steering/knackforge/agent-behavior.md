---
rule_id: knackforge-agent-behavior
scope: project
applies_to_stages: [pre_plan, pre_code, pre_review]
sources: [ADR-004, GSD-stub decision]
---

# KnackForge — Agent Behavior

## White-Label Stubs (ADR-004)

- Forge consumes the real ``@forge-ai/forge-core`` engine at
  ``packages/forge-core/`` (migrated from ``@opengsd/gsd-core``).
  The backend invokes it via a subprocess bridge through
  ``packages/forge-core/forge-core/bin/forge_run capability invoke``;
  the dashboard imports its catalog directly as a workspace dep.
  We do NOT maintain our own GSD engine.
- All other provider stubs (Jira, Confluence, Zendesk, Slack,
  AWS, ArgoCD, K8s, …) follow the same posture: in-process shim
  today, real client when the upstream package publishes.

## MCP Discipline (Phase 1 + 3)

- Tool calls go through ``MCPClient.call_server(...)``. Never
  short-circuit to a raw ``httpx`` call from a service — that
  bypasses the audit chain.
- Phase 3 added ``confluence``, ``zendesk``, ``slack`` to
  ``DEFAULT_CATALOG`` with the same input shapes as the TS
  sources (``mcp-servers/{confluence,zendesk,slack}/src/tools.ts``).
  The Python handlers are deterministic stubs; Phase 4 swaps in
  the httpx-backed real implementations.

## Approval Discipline

- No workflow crosses Architecture, Security, or Deployment
  boundaries without an explicit human approval gate (Rule 3).
  The pattern is enforced by ``approval_gate.py`` in the SDLC
  agent.
- PM validation for ideation is separate from SDLC approval; it
  lives in ``approval_queue.py::decide()`` and posts status
  comments back to Jira via ``JiraCommenter``.

## Persona Discipline

- Persona memory is **Org Knowledge** — tenant-scoped, shared
  across users of the same persona in the tenant.
- The default persona is ``developer``; tenants override via
  ``Tenant.default_persona``.
- The agent runtime folds the persona's ``ideation`` memory
  into the analysis prompt (see
  ``idea_analysis._gather_persona_memory``).
- Concurrent writes don't clobber: the history log preserves
  every edit; the nightly consolidate rolls recent rows into
  the stable file under ``## {ISO date}`` section headers.

## Idempotency & Retry

- Subscribers to ``EventType.CONNECTOR_EVENT_OBSERVED`` MUST
  check for an existing row before insert.
- Source pullers use ``INSERT ... ON CONFLICT DO NOTHING`` so
  re-running a daily ingest is a no-op.
- The scheduler's ``max_instances=1`` + ``coalesce=True`` ensure
  a stuck tick doesn't pile up parallel runs.