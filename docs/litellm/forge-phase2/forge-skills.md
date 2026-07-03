# Forge Skills (Phase 2 F9)

> Spec: `docs/goals/step-76.md` §Feature 9
> Module: `app/services/skills_service.py` + `app/api/v1/skills.py`
> Proxy: `app/integrations/litellm/skills_apply.py`

## Skill object

```yaml
Skill {
  id, name, description, version
  status: draft | active | archived
  prompt_template: string         # Jinja2-style: {{language}}, {{customer}}
  tools: ToolRef[]                # MCP or registry entries
  config: { default_model?, temperature?, max_tokens?, response_format?, reasoning_effort? }
  metadata: { forge_tenant_id, created_by, category, tags }
}
```

## Lifecycle

- `POST /api/v1/skills` — admin create (idempotent on `(tenant, name, version)`).
- `PATCH /api/v1/skills/{id}` — update creates a new version (default `bump_version: true`).
- `POST /api/v1/skills/{id}/archive` — soft-delete; pinned agents still resolve the version.
- `POST /api/v1/skills/preview` — render a template with variables (no chat call).

## Composition

An agent references `skill_ids: [...]`. For each chat:
1. `SkillsService.inject` iterates in order.
2. For each skill, `POST /utils/transform_request` (called once per skill per chat — AC #9).
3. Merged request goes to `/v1/chat/completions`.
4. `forge.skills.injected` audit row per skill.

## Public hub

`GET /api/v1/skills/hub` reads `/public/agent_hub`. `POST /api/v1/skills/hub/import` clones a public skill into a tenant-local copy with `metadata.forge_tenant_id` set.

## Errors

`SkillRenderError` (422) → `SkillRenderErrorEnvelope { code, skill_id, template_error }`. Templates are validated at save time (AC #10), not at first chat use.