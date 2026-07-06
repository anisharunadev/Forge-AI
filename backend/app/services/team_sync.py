"""Sync Forge tenants <-> LiteLLM teams.

When a tenant is created or a user joins:

  1. Create the LiteLLM team (if not exists) with the tenant's budget
  2. Mint a virtual key for each user
  3. Apply guardrails as tenant-level metadata

LiteLLM does NOT do multi-tenancy natively. We map:

  Forge tenant (UUID)  ->  LiteLLM team (string alias)
  Forge user (UUID)    ->  LiteLLM internal user (string email)
  Forge project (UUID) ->  LiteLLM virtual key (per project)
"""

from app.services.litellm_admin import (
    create_team,
    generate_virtual_key,
    list_teams,
    list_virtual_keys,
)


async def ensure_team_for_tenant(tenant_id: str, tenant_name: str, max_budget: float):
    """Idempotent - create LiteLLM team if it doesn't exist."""
    teams = await list_teams()
    existing = next((t for t in teams if t.get("team_alias") == tenant_id), None)

    if existing:
        return existing

    return await create_team(
        team_alias=tenant_id,
        max_budget=max_budget,
        metadata={"forge_tenant_name": tenant_name, "managed_by": "forge-ai"},
    )


async def ensure_key_for_project(
    tenant_id: str,
    project_id: str,
    user_email: str,
    models: list[str] | None = None,
    max_budget: float | None = None,
):
    """Mint a virtual key for a project + user combo."""
    keys = await list_virtual_keys(team_id=tenant_id)
    alias = f"{tenant_id}:{project_id}:{user_email}"

    if any(k.get("key_alias") == alias for k in keys):
        return next(k for k in keys if k.get("key_alias") == alias)

    return await generate_virtual_key(
        team_id=tenant_id,
        alias=alias,
        models=models,
        max_budget=max_budget,
        user_id=user_email,
        metadata={
            "forge_tenant_id": tenant_id,
            "forge_project_id": project_id,
        },
    )
