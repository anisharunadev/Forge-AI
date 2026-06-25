---
rule_id: knackforge-security-standards
scope: project
applies_to_stages: [pre_code, pre_commit, pre_review]
sources: [ADR-008, ADR-009]
---

# KnackForge — Security Standards

## Secrets Handling (ADR-008)

- MCP credentials live in ``Connector.credential_envelope``; they
  must **never** be logged, echoed, or stamped into error messages.
- ``ConnectorManager`` redacts ``credential_envelope`` on every
  read; tests that need raw credentials inject them via
  ``set_jira_connector_override(...)`` (see
  ``agents/tools/mcp_client.py``).
- Phase 4 introduces Vault / AWS Secrets Manager wiring for
  Connector Center Add; the redact envelope stays the seam.

## Audit Chain (ADR-009)

- Every state transition emits an ``AuditService.record(...)`` call
  with ``tenant_id``, ``project_id``, ``actor_id``, ``action``,
  ``target_type``, ``target_id``, and a typed ``payload``.
- MCP traffic emits ``McpAuditEvent`` from the router itself; the
  Python side surfaces failures through ``MCPResult.ok = False``
  + ``error`` string.
- Persona memory writes are audited
  (``action='persona.memory.append'``,
  ``target_type='persona_file'``,
  ``target_id='{tenant_slug}/{persona}/{key}'``).
- Daily ingest runs are audited
  (``action='ideation.ingest.run'``, ``target_type='tenant'``).

## Authorization

- The Forge shell reads the ``forge.persona`` cookie on every
  request and forwards ``X-Forge-Persona``. Backed by
  ``Tenant.default_persona`` (added Phase 3).
- All v1 endpoints require ``AuthenticatedPrincipal`` (RBAC).
  Write endpoints additionally require ``require_permission(...)``.
- No anonymous writes — every row carries an ``actor_id``.

## Transport

- TLS terminates at the ingress; the app speaks plain HTTP behind
  it. ``CORSMiddleware`` is configured with explicit
  ``allow_origins`` (no ``*``).
- WebSocket routes carry the same auth as the REST surface.