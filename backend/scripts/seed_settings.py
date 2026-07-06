#!/usr/bin/env python3
"""Seed settings data: roles, members, env vars, agent configs.

Idempotent — re-running inserts only rows that don't exist yet
(matched by the natural key per entity).

Run from backend/:
    python -m scripts.seed_settings
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.crypto import encrypt
from app.db.models.agent import Agent
from app.db.models.agent_config import AgentConfig
from app.db.models.env_var import EnvVar
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.role import Role
from app.db.models.user import User
from app.db.session import async_session_maker

SEED_ROLES = [
    {
        "name": "Owner",
        "description": "Full access to everything",
        "permissions": ["*"],
    },
    {
        "name": "Admin",
        "description": "All permissions except billing",
        "permissions": ["*"],
    },
    {
        "name": "Member",
        "description": "Standard member permissions",
        "permissions": ["read", "write"],
    },
    {
        "name": "Viewer",
        "description": "Read-only access",
        "permissions": ["read"],
    },
]


SEED_ENV_VARS = [
    {
        "key": "ANTHROPIC_API_KEY",
        "value": "sk-ant-demo-replace-me",
        "scope": "runtime",
        "visibility": "secret",
        "description": "Anthropic API key",
    },
    {
        "key": "GITHUB_TOKEN",
        "value": "ghp_demo_replace_me",
        "scope": "build",
        "visibility": "secret",
        "description": "GitHub PAT for CI",
    },
    {
        "key": "JIRA_API_TOKEN",
        "value": "demo-jira-token",
        "scope": "runtime",
        "visibility": "secret",
        "description": "Jira integration token",
    },
    {
        "key": "DATABASE_URL",
        "value": "postgresql://forge:forge@postgres:5432/forge",
        "scope": "build",
        "visibility": "secret",
        "description": "Postgres connection string",
    },
    {
        "key": "NODE_ENV",
        "value": "production",
        "scope": "runtime",
        "visibility": "public",
        "description": "Node environment",
    },
    {
        "key": "LOG_LEVEL",
        "value": "info",
        "scope": "runtime",
        "visibility": "public",
        "description": "Logging level",
    },
    {
        "key": "REDIS_HOST",
        "value": "redis",
        "scope": "runtime",
        "visibility": "public",
        "description": "Redis host",
    },
    {
        "key": "REDIS_PORT",
        "value": "6379",
        "scope": "runtime",
        "visibility": "public",
        "description": "Redis port",
    },
    {
        "key": "SENTRY_DSN",
        "value": "https://demo@sentry.io/123",
        "scope": "runtime",
        "visibility": "secret",
        "description": "Sentry error reporting",
    },
    {
        "key": "OPENAI_API_KEY",
        "value": "sk-demo-replace-me",
        "scope": "runtime",
        "visibility": "secret",
        "description": "OpenAI API key",
    },
    {
        "key": "SLACK_WEBHOOK_URL",
        "value": "https://hooks.slack.com/services/demo",
        "scope": "runtime",
        "visibility": "secret",
        "description": "Slack notification webhook",
    },
    {
        "key": "AWS_REGION",
        "value": "us-east-1",
        "scope": "build",
        "visibility": "public",
        "description": "AWS region",
    },
]


async def seed() -> None:
    async with async_session_maker() as session:
        # Pick the seeded demo user + tenant from the acme-corp package.
        user = (
            await session.execute(select(User).where(User.email == "arun@acme-corp.com"))
        ).scalar_one_or_none()
        if user is None:
            print("✗ User arun@acme-corp.com not found — run base seed first.")
            return

        project = (
            (await session.execute(select(Project).where(Project.tenant_id == user.tenant_id)))
            .scalars()
            .first()
        )
        if project is None:
            print("✗ No project found — run base seed first.")
            return

        tenant_id = user.tenant_id
        now = datetime.now(UTC)

        # Roles (per-tenant, unique on (tenant_id, name)).
        print("→ Seeding roles...")
        role_by_name: dict[str, Role] = {}
        for spec in SEED_ROLES:
            existing = (
                await session.execute(
                    select(Role).where(
                        Role.tenant_id == tenant_id,
                        Role.name == spec["name"],
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                role_by_name[spec["name"]] = existing
                continue
            role = Role(
                id=uuid4(),
                tenant_id=tenant_id,
                name=spec["name"],
                description=spec["description"],
                permissions=spec["permissions"],
                created_at=now,
                updated_at=now,
            )
            session.add(role)
            await session.flush()
            role_by_name[spec["name"]] = role

        # Arun as Owner of the first project.
        print("→ Seeding members...")
        arun_member = (
            await session.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == project.id,
                    ProjectMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if arun_member is None:
            session.add(
                ProjectMember(
                    id=uuid4(),
                    project_id=project.id,
                    user_id=user.id,
                    role_id=role_by_name["Owner"].id,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
            )

        # Env vars — Fernet-encrypted at rest.
        print("→ Seeding env vars...")
        for spec in SEED_ENV_VARS:
            existing = (
                await session.execute(
                    select(EnvVar).where(
                        EnvVar.project_id == project.id,
                        EnvVar.key == spec["key"],
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue
            session.add(
                EnvVar(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    project_id=project.id,
                    key=spec["key"],
                    encrypted_value=encrypt(spec["value"]),
                    description=spec["description"],
                    scope=spec["scope"],
                    visibility=spec["visibility"],
                    created_by=user.id,
                    created_at=now,
                    updated_at=now,
                )
            )

        # Agent configs — one row per agent in the tenant.
        print("→ Seeding agent configs...")
        agents = (
            (await session.execute(select(Agent).where(Agent.tenant_id == tenant_id)))
            .scalars()
            .all()
        )
        for agent in agents:
            existing = (
                await session.execute(
                    select(AgentConfig).where(
                        AgentConfig.project_id == project.id,
                        AgentConfig.agent_id == agent.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue
            session.add(
                AgentConfig(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    project_id=project.id,
                    agent_id=agent.id,
                    enabled=True,
                    default_model="claude-3-5-sonnet",
                    temperature=0.7,
                    max_tokens=4096,
                    allowed_tools=["*"],
                    config={},
                    created_at=now,
                    updated_at=now,
                )
            )

        await session.commit()
        print(
            f"\n✅ Seeded {len(SEED_ROLES)} roles, "
            f"{len(SEED_ENV_VARS)} env vars, "
            f"{len(agents)} agent configs"
        )


if __name__ == "__main__":
    asyncio.run(seed())
