#!/usr/bin/env python3
"""Seed agents + model providers for the acme-corp tenant.

Step-54-v2 Zone 4 — inserts the six "common agent patterns" shown in the
Agent Center empty state plus four model providers (Anthropic, OpenAI,
AWS Bedrock, Google Vertex).

Runtimes are NOT seeded here: they're process-local (see
``app.services.agent_runtime.AgentRuntime._handles``) and are created on
demand via ``POST /runtimes/start``.

Run with:
    docker compose exec backend python -m scripts.seed_agents
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from sqlalchemy import select

from app.db.models.agent import Agent, AgentStatus, AgentType
from app.db.models.model_provider import ModelProvider, ModelProviderType
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

logger = logging.getLogger("seed_agents")
logging.basicConfig(level=logging.INFO, format="%(message)s")

# Stable IDs make the seed idempotent — re-running the script will skip
# rows that already exist rather than duplicating them.
SEED_PROVIDERS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("11111111-1111-4111-8111-111111111111"),
        "name": "Anthropic",
        "type": ModelProviderType.ANTHROPIC,
        "litellm_model_alias": "anthropic/claude-sonnet-4.5",
        "config": {
            "api_base": "https://api.anthropic.com",
            "api_key": "sk-ant-***",
            "models": ["claude-sonnet-4.5", "claude-opus-4", "claude-haiku-4"],
            "default_model": "claude-sonnet-4.5",
        },
        "enabled": True,
        "rate_limit_rpm": 60,
        "rate_limit_tpm": 100_000,
    },
    {
        "id": uuid.UUID("22222222-2222-4222-8222-222222222222"),
        "name": "OpenAI",
        "type": ModelProviderType.OPENAI,
        "litellm_model_alias": "openai/gpt-4o",
        "config": {
            "api_base": "https://api.openai.com/v1",
            "api_key": "sk-***",
            "models": ["gpt-4o", "gpt-4o-mini", "o3-mini"],
            "default_model": "gpt-4o",
        },
        "enabled": True,
        "rate_limit_rpm": 60,
        "rate_limit_tpm": 200_000,
    },
    {
        "id": uuid.UUID("33333333-3333-4333-8333-333333333333"),
        "name": "AWS Bedrock",
        "type": ModelProviderType.BEDROCK,
        "litellm_model_alias": "bedrock/anthropic.claude-sonnet-4.5-v2:0",
        "config": {
            "api_base": "https://bedrock-runtime.us-east-1.amazonaws.com",
            "region": "us-east-1",
            "models": [
                "anthropic.claude-sonnet-4.5-v2:0",
                "amazon.nova-pro-v1:0",
            ],
            "default_model": "anthropic.claude-sonnet-4.5-v2:0",
        },
        "enabled": True,
        "rate_limit_rpm": 30,
        "rate_limit_tpm": 80_000,
    },
    {
        "id": uuid.UUID("44444444-4444-4444-8444-444444444444"),
        "name": "Google Vertex",
        "type": ModelProviderType.GOOGLE,
        "litellm_model_alias": "vertex_ai/gemini-2.5-pro",
        "config": {
            "api_base": "https://us-central1-aiplatform.googleapis.com",
            "project": "acme-corp-dev",
            "models": ["gemini-2.5-pro", "gemini-2.5-flash"],
            "default_model": "gemini-2.5-pro",
        },
        "enabled": False,  # mirrors the disconnected state in step-54-v2
        "rate_limit_rpm": 0,
        "rate_limit_tpm": 0,
    },
]


# The six "common agent patterns" from the Agent Center empty state.
# Each agent's `capabilities` carries the provider + model it targets
# (the Agent table has no FK to model_providers — the link is opaque
# JSONB so the registry can describe future-state concepts like
# multi-model agents).
SEED_AGENTS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        "name": "Code reviewer",
        "type": AgentType.CLAUDE_CODE,
        "version": "1.0.0",
        "capabilities": {
            "provider_id": "11111111-1111-4111-8111-111111111111",
            "provider_name": "Anthropic",
            "model": "claude-sonnet-4.5",
            "runtime": "claude-code",
            "languages": ["python", "typescript", "go"],
            "tools": ["shell", "git", "github"],
            "actions": ["code-review", "pr-analysis", "security-scan"],
            "description": "Reviews PRs automatically, flags issues, suggests fixes. Saves ~3h/week per dev.",
        },
        "status": AgentStatus.ENABLED,
    },
    {
        "id": uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        "name": "Refactor agent",
        "type": AgentType.CODEX,
        "version": "1.0.0",
        "capabilities": {
            "provider_id": "22222222-2222-4222-8222-222222222222",
            "provider_name": "OpenAI",
            "model": "gpt-4o",
            "runtime": "codex",
            "languages": ["python", "typescript"],
            "tools": ["shell", "git"],
            "actions": ["refactor", "code-transformation", "test-generation"],
            "description": "Tackles large refactors across the codebase. Auto-generates PRs with tests.",
        },
        "status": AgentStatus.ENABLED,
    },
    {
        "id": uuid.UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        "name": "Sync agent",
        "type": AgentType.CUSTOM,
        "version": "1.0.0",
        "capabilities": {
            "provider_id": "11111111-1111-4111-8111-111111111111",
            "provider_name": "Anthropic",
            "model": "claude-haiku-4",
            "runtime": "custom",
            "tools": ["webhook", "rest"],
            "actions": ["data-sync", "webhook-handler", "event-routing"],
            "description": "Syncs data between Jira, GitHub, Slack, and Forge. Keeps everyone in the loop.",
        },
        "status": AgentStatus.ENABLED,
    },
    {
        "id": uuid.UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        "name": "Test runner",
        "type": AgentType.CLAUDE_CODE,
        "version": "1.0.0",
        "capabilities": {
            "provider_id": "11111111-1111-4111-8111-111111111111",
            "provider_name": "Anthropic",
            "model": "claude-sonnet-4.5",
            "runtime": "claude-code",
            "languages": ["python", "typescript", "go"],
            "tools": ["shell", "pytest", "vitest"],
            "actions": ["test-generation", "test-execution", "coverage-analysis"],
            "description": "Writes tests, runs them, reports coverage. Increases test coverage by 20% in a sprint.",
        },
        "status": AgentStatus.ENABLED,
    },
    {
        "id": uuid.UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
        "name": "Doc generator",
        "type": AgentType.CLAUDE_CODE,
        "version": "1.0.0",
        "capabilities": {
            "provider_id": "11111111-1111-4111-8111-111111111111",
            "provider_name": "Anthropic",
            "model": "claude-sonnet-4.5",
            "runtime": "claude-code",
            "tools": ["shell", "markdown"],
            "actions": ["doc-generation", "readme-update", "api-docs"],
            "description": "Auto-generates docs from code. Keeps README and API docs in sync.",
        },
        "status": AgentStatus.ENABLED,
    },
    {
        "id": uuid.UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"),
        "name": "Security auditor",
        "type": AgentType.CUSTOM,
        "version": "1.0.0",
        "capabilities": {
            "provider_id": "11111111-1111-4111-8111-111111111111",
            "provider_name": "Anthropic",
            "model": "claude-opus-4",
            "runtime": "kiro",
            "tools": ["shell", "static-analysis"],
            "actions": ["security-scan", "vulnerability-detection", "compliance-check"],
            "description": "Scans for security issues, suggests fixes. Runs nightly on the main branch.",
        },
        "status": AgentStatus.ENABLED,
    },
]


# acme-corp is the dev tenant seeded by `day_one_bootstrap` (see
# app/services/day_one_bootstrap.py). Its UUID is stable across
# re-seeds because the bootstrap uses an idempotent insert.
ACME_TENANT_ID = uuid.UUID("a6500631-1930-5afa-9d38-24de9bedcb37")


async def seed() -> None:
    """Insert seed rows for the acme-corp tenant. Idempotent."""
    sf = get_session_factory()

    async with sf() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.id == ACME_TENANT_ID))
        ).scalar_one_or_none()
        if tenant is None:
            raise RuntimeError(
                f"acme-corp tenant {ACME_TENANT_ID} not found. "
                "Run the day_one_bootstrap service first."
            )
        logger.info("tenant: %s (%s)", tenant.slug, tenant.name)

        providers_created = 0
        for row in SEED_PROVIDERS:
            existing = (
                await session.execute(
                    select(ModelProvider).where(
                        ModelProvider.id == row["id"],
                        ModelProvider.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ provider exists: %s", row["name"])
                continue
            session.add(ModelProvider(tenant_id=tenant.id, **row))
            providers_created += 1
            logger.info("  ✓ provider created: %s (%s)", row["name"], row["type"].value)

        agents_created = 0
        for row in SEED_AGENTS:
            existing = (
                await session.execute(
                    select(Agent).where(
                        Agent.id == row["id"],
                        Agent.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ agent exists: %s", row["name"])
                continue
            session.add(Agent(tenant_id=tenant.id, **row))
            agents_created += 1
            logger.info("  ✓ agent created: %s (%s)", row["name"], row["type"].value)

        await session.commit()

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info("   - 1 tenant (acme-corp)")
        logger.info("   - %d providers created (%d total)",
                    providers_created, len(SEED_PROVIDERS))
        logger.info("   - %d agents created (%d total)",
                    agents_created, len(SEED_AGENTS))


if __name__ == "__main__":
    asyncio.run(seed())
