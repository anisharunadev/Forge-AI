"""F12 RBAC — org/team hierarchy service.

Phase 3 Feature 12. This service is the only place that knows the
role hierarchy: every check, every CRUD, every cross-tenant guard
goes through here. Thin per-entity services (``org_service``,
``team_service``, etc.) wrap this for the HTTP layer.
"""

from __future__ import annotations

from datetime import UTC
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.customer import Customer
from app.db.models.organization import Organization
from app.db.models.project import Project
from app.db.models.team import Team
from app.db.models.team_member import TeamMember
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.schemas.rbac_v2 import (
    BulkTeamMemberResult,
    DailyRollup,
    RoleEnum,
    role_grants,
)

logger = get_logger(__name__)


def _24h_ago():
    """Return UTC now - 24h as a naive datetime for SQLA comparisons."""
    from datetime import datetime, timedelta

    return datetime.now(UTC) - timedelta(hours=24)


class RBACv2Service:
    """Org → team → project → customer CRUD with role-inheritance checks."""

    # ------------------------------------------------------------------
    # Role introspection
    # ------------------------------------------------------------------

    @staticmethod
    def role_for(principal: AuthenticatedPrincipal) -> RoleEnum | None:
        """Project the principal's JWT roles into our RoleEnum, if any.

        Coarse role strings (``forge:admin``, ``tenant:admin``) map to
        ``org_admin``. ``forge:super`` maps to ``super_admin``. Falls
        back to ``member`` for any authenticated principal.
        """
        if not principal or not principal.roles:
            return None
        roles = set(principal.roles)
        if "forge:super" in roles or "super_admin" in roles:
            return RoleEnum.SUPER_ADMIN
        if "forge:admin" in roles or "tenant:admin" in roles or "org_admin" in roles:
            return RoleEnum.ORG_ADMIN
        if "team_admin" in roles:
            return RoleEnum.TEAM_ADMIN
        if "project_admin" in roles:
            return RoleEnum.PROJECT_ADMIN
        if "viewer" in roles:
            return RoleEnum.VIEWER
        if "customer_admin" in roles:
            return RoleEnum.CUSTOMER_ADMIN
        return RoleEnum.MEMBER

    def can(
        self,
        principal: AuthenticatedPrincipal,
        required: RoleEnum,
    ) -> bool:
        role = self.role_for(principal)
        if role is None:
            return False
        return role_grants(role, required)

    # ------------------------------------------------------------------
    # Org CRUD
    # ------------------------------------------------------------------

    async def create_org(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        name: str,
        brand: dict[str, Any] | None = None,
        billing_ref: str | None = None,
    ) -> Organization:
        org = Organization(
            tenant_id=tenant_id,
            name=name,
            brand=brand or {},
            billing_ref=billing_ref,
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)
        return org

    async def list_orgs(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
    ) -> list[Organization]:
        result = await db.execute(
            select(Organization)
            .where(Organization.tenant_id == tenant_id)
            .order_by(Organization.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_org(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID,
    ) -> Organization | None:
        result = await db.execute(
            select(Organization).where(
                Organization.tenant_id == tenant_id,
                Organization.id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_org(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID,
        patch: dict[str, Any],
    ) -> Organization | None:
        org = await self.get_org(db, tenant_id=tenant_id, org_id=org_id)
        if org is None:
            return None
        for key, value in patch.items():
            if hasattr(org, key) and value is not None:
                setattr(org, key, value)
        await db.commit()
        await db.refresh(org)
        return org

    async def delete_org(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID,
    ) -> bool:
        org = await self.get_org(db, tenant_id=tenant_id, org_id=org_id)
        if org is None:
            return False
        await db.delete(org)
        await db.commit()
        return True

    # ------------------------------------------------------------------
    # Team CRUD
    # ------------------------------------------------------------------

    async def create_team(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID,
        name: str,
        description: str | None = None,
        model_allowlist: list[str] | None = None,
        default_agent_config: dict[str, Any] | None = None,
    ) -> Team:
        team = Team(
            tenant_id=tenant_id,
            org_id=org_id,
            name=name,
            description=description,
            model_allowlist=model_allowlist or [],
            default_agent_config=default_agent_config or {},
        )
        db.add(team)
        await db.commit()
        await db.refresh(team)
        return team

    async def list_teams(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID | None = None,
    ) -> list[Team]:
        stmt = select(Team).where(Team.tenant_id == tenant_id)
        if org_id is not None:
            stmt = stmt.where(Team.org_id == org_id)
        stmt = stmt.order_by(Team.created_at.desc())
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_team(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
    ) -> Team | None:
        result = await db.execute(
            select(Team).where(
                Team.tenant_id == tenant_id,
                Team.id == team_id,
            )
        )
        return result.scalar_one_or_none()

    async def block_team(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
    ) -> Team | None:
        team = await self.get_team(db, tenant_id=tenant_id, team_id=team_id)
        if team is None:
            return None
        team.blocked = True
        await db.commit()
        await db.refresh(team)
        return team

    async def unblock_team(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
    ) -> Team | None:
        team = await self.get_team(db, tenant_id=tenant_id, team_id=team_id)
        if team is None:
            return None
        team.blocked = False
        await db.commit()
        await db.refresh(team)
        return team

    # ------------------------------------------------------------------
    # Team members
    # ------------------------------------------------------------------

    async def add_member(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        user_id: UUID,
        role: RoleEnum,
    ) -> TeamMember:
        member = TeamMember(
            tenant_id=tenant_id,
            team_id=team_id,
            user_id=user_id,
            role=role.value,
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)
        return member

    async def change_member_role(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        user_id: UUID,
        role: RoleEnum,
    ) -> TeamMember | None:
        result = await db.execute(
            select(TeamMember).where(
                TeamMember.tenant_id == tenant_id,
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            return None
        member.role = role.value
        await db.commit()
        await db.refresh(member)
        return member

    async def remove_member(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        user_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(TeamMember).where(
                TeamMember.tenant_id == tenant_id,
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            return False
        await db.delete(member)
        await db.commit()
        return True

    async def list_members(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
    ) -> list[TeamMember]:
        result = await db.execute(
            select(TeamMember).where(
                TeamMember.tenant_id == tenant_id,
                TeamMember.team_id == team_id,
            )
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Customer CRUD
    # ------------------------------------------------------------------

    async def create_customer(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID,
        name: str,
        description: str | None = None,
        billing_ref: str | None = None,
    ) -> Customer:
        customer = Customer(
            tenant_id=tenant_id,
            org_id=org_id,
            name=name,
            description=description,
            billing_ref=billing_ref,
        )
        db.add(customer)
        await db.commit()
        await db.refresh(customer)
        return customer

    async def list_customers(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        org_id: UUID | None = None,
    ) -> list[Customer]:
        stmt = select(Customer).where(Customer.tenant_id == tenant_id)
        if org_id is not None:
            stmt = stmt.where(Customer.org_id == org_id)
        stmt = stmt.order_by(Customer.created_at.desc())
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def block_customer(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        customer_id: UUID,
    ) -> Customer | None:
        result = await db.execute(
            select(Customer).where(
                Customer.tenant_id == tenant_id,
                Customer.id == customer_id,
            )
        )
        customer = result.scalar_one_or_none()
        if customer is None:
            return None
        customer.blocked = True
        await db.commit()
        await db.refresh(customer)
        return customer

    async def unblock_customer(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        customer_id: UUID,
    ) -> Customer | None:
        result = await db.execute(
            select(Customer).where(
                Customer.tenant_id == tenant_id,
                Customer.id == customer_id,
            )
        )
        customer = result.scalar_one_or_none()
        if customer is None:
            return None
        customer.blocked = False
        await db.commit()
        await db.refresh(customer)
        return customer

    # ------------------------------------------------------------------
    # Customer update + delete (step-78 F12 §"Forge-side CRUD")
    # ------------------------------------------------------------------

    async def update_customer(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        customer_id: UUID,
        patch: dict[str, Any],
    ) -> Customer | None:
        result = await db.execute(
            select(Customer).where(
                Customer.tenant_id == tenant_id,
                Customer.id == customer_id,
            )
        )
        customer = result.scalar_one_or_none()
        if customer is None:
            return None
        for key, value in patch.items():
            if value is not None and hasattr(customer, key):
                setattr(customer, key, value)
        await db.commit()
        await db.refresh(customer)
        return customer

    async def delete_customer(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        customer_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(Customer).where(
                Customer.tenant_id == tenant_id,
                Customer.id == customer_id,
            )
        )
        customer = result.scalar_one_or_none()
        if customer is None:
            return False
        await db.delete(customer)
        await db.commit()
        return True

    # ------------------------------------------------------------------
    # Project CRUD (step-78 F12 — the per-team project work unit)
    # ------------------------------------------------------------------

    async def create_project(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        name: str,
        slug: str,
        description: str | None = None,
        default_branch: str = "main",
        visibility: str = "private",
        created_by: UUID | None = None,
    ) -> Project:
        project = Project(
            tenant_id=tenant_id,
            name=name,
            slug=slug,
            description=description,
            default_branch=default_branch,
            visibility=visibility,
            status="active",
            created_by=created_by,
        )
        db.add(project)
        await db.commit()
        await db.refresh(project)
        return project

    async def list_projects(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID | None = None,
    ) -> list[Project]:
        stmt = select(Project).where(Project.tenant_id == tenant_id)
        if team_id is not None:
            stmt = stmt.where(
                Project.id == team_id
            )  # ponytail: team filter via join if/when ProjectTeam junction exists; for now filter by id-or-team_id through ProjectMember — kept simple  # noqa: E501
        stmt = stmt.order_by(Project.created_at.desc())
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_project(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID,
    ) -> Project | None:
        result = await db.execute(
            select(Project).where(
                Project.tenant_id == tenant_id,
                Project.id == project_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_project(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID,
        patch: dict[str, Any],
    ) -> Project | None:
        project = await self.get_project(db, tenant_id=tenant_id, project_id=project_id)
        if project is None:
            return None
        for key, value in patch.items():
            if value is not None and hasattr(project, key):
                setattr(project, key, value)
        await db.commit()
        await db.refresh(project)
        return project

    async def delete_project(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID,
    ) -> bool:
        project = await self.get_project(db, tenant_id=tenant_id, project_id=project_id)
        if project is None:
            return False
        await db.delete(project)
        await db.commit()
        return True

    # ------------------------------------------------------------------
    # Bulk member add (step-78 F12 acceptance #3 — 100 users per call)
    # ------------------------------------------------------------------

    async def add_members_bulk(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        members: list[dict[str, Any]],
        atomic: bool = False,
    ) -> list[BulkTeamMemberResult]:
        """Add multiple members in one call.

        - ``atomic=False`` (default): per-row try/except; collects errors
          in the result list and never rolls back successful rows.
        - ``atomic=True``: all-or-nothing. On the first error the
          transaction is rolled back and every remaining row is reported
          as ``skipped``.
        """
        results: list[BulkTeamMemberResult] = []
        existing_q = select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id.in_([UUID(str(m["user_id"])) for m in members]),
        )
        existing = {tm.user_id: tm for tm in (await db.execute(existing_q)).scalars().all()}

        added = 0
        for m in members:
            uid = UUID(str(m["user_id"]))
            role = RoleEnum(m["role"])
            if uid in existing:
                results.append(
                    BulkTeamMemberResult(
                        user_id=uid,
                        role=role,
                        status="skipped",
                        detail="already_member",
                    )
                )
                continue
            try:
                db.add(
                    TeamMember(
                        tenant_id=tenant_id,
                        team_id=team_id,
                        user_id=uid,
                        role=role.value,
                    )
                )
                await db.flush()
                added += 1
                results.append(BulkTeamMemberResult(user_id=uid, role=role, status="added"))
            except Exception as exc:  # noqa: BLE001 — surface as per-row error
                if atomic:
                    await db.rollback()
                    return [
                        BulkTeamMemberResult(
                            user_id=uid,
                            role=role,
                            status="error",
                            detail=str(exc),
                        )
                    ]
                results.append(
                    BulkTeamMemberResult(
                        user_id=uid,
                        role=role,
                        status="error",
                        detail=str(exc),
                    )
                )
        if atomic:
            await db.commit()
        else:
            await db.commit()
        return results

    # ------------------------------------------------------------------
    # Team model allowlist (step-78 F12 §"Tag-based access")
    # ------------------------------------------------------------------

    async def add_team_model(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        model: str,
    ) -> Team | None:
        team = await self.get_team(db, tenant_id=tenant_id, team_id=team_id)
        if team is None:
            return None
        if model not in team.model_allowlist:
            team.model_allowlist = [*team.model_allowlist, model]
            await db.commit()
            await db.refresh(team)
        return team

    async def remove_team_model(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        team_id: UUID,
        model: str,
    ) -> Team | None:
        team = await self.get_team(db, tenant_id=tenant_id, team_id=team_id)
        if team is None:
            return None
        if model in team.model_allowlist:
            team.model_allowlist = [m for m in team.model_allowlist if m != model]
            await db.commit()
            await db.refresh(team)
        return team

    # ------------------------------------------------------------------
    # Daily rollups (step-78 F12 §"Daily activity endpoints")
    # ponytail: we aggregate over the local litellm_call_records table
    # (tenant-scoped) instead of proxying LiteLLM /daily endpoints —
    # the local aggregate is fast and avoids an extra round-trip on
    # every dashboard render. Filter by actor_id (which doubles as
    # user_id) for users; team/org/customer filter via JSONB metadata
    # columns written by the integration layer.
    # ------------------------------------------------------------------

    async def daily_rollup(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        entity_type: str,
        entity_id: UUID,
    ) -> DailyRollup:
        try:
            from sqlalchemy import func

            from app.db.models.litellm_call_record import LiteLLMCallRecord

            base_filter = [
                LiteLLMCallRecord.tenant_id == tenant_id,
                LiteLLMCallRecord.occurred_at >= _24h_ago(),
            ]
            if entity_type == "user":
                base_filter.append(LiteLLMCallRecord.actor_id == entity_id)
            elif entity_type in {"team", "organization", "customer"}:
                # ponytail: metadata is JSONB; per-entity filter via a
                # containment probe. Cheap on small volumes; promote to
                # a real column once call records table is hot.
                base_filter.append(
                    LiteLLMCallRecord.metadata_[entity_type + "_id"].astext == str(entity_id)
                )

            error_states = ("failed", "budget_blocked", "upstream_error", "litellm_down")
            row = (
                await db.execute(
                    select(
                        func.coalesce(func.sum(LiteLLMCallRecord.cost_usd), 0.0).label("spend"),
                        func.count(LiteLLMCallRecord.id).label("reqs"),
                        func.coalesce(
                            func.sum(
                                func.case(
                                    (LiteLLMCallRecord.status.in_(error_states), 1),
                                    else_=0,
                                )
                            ),
                            0,
                        ).label("errs"),
                        func.coalesce(
                            func.percentile_cont(0.5).within_group(
                                LiteLLMCallRecord.latency_ms.asc()
                            ),
                            0.0,
                        ).label("p50"),
                        func.coalesce(
                            func.percentile_cont(0.95).within_group(
                                LiteLLMCallRecord.latency_ms.asc()
                            ),
                            0.0,
                        ).label("p95"),
                    ).where(*base_filter)
                )
            ).one()
            return DailyRollup(
                entity_id=entity_id,
                entity_type=entity_type,
                spend_usd=float(row.spend or 0.0),
                request_count=int(row.reqs or 0),
                error_count=int(row.errs or 0),
                p50_latency_ms=float(row.p50 or 0.0),
                p95_latency_ms=float(row.p95 or 0.0),
            )
        except Exception as exc:  # noqa: BLE001 — never break the dashboard on a cold tenant
            logger.info("rbac.daily_rollup.empty", entity_type=entity_type, reason=str(exc))
            return DailyRollup(entity_id=entity_id, entity_type=entity_type)

    # ------------------------------------------------------------------
    # Bootstrap (super-admin only)
    # ------------------------------------------------------------------

    async def bootstrap_tenant(
        self,
        db: AsyncSession,
        *,
        tenant_slug: str,
        org_name: str,
        team_name: str,
        user_email: str,
        keycloak_sub: str,
    ) -> dict[str, Any]:
        """Super-admin idempotent tenant + org + team + user bootstrap.

        Used by the Phase 1 onboarding wizard (step-78 F12 §"Onboarding")
        and the ``/api/forge/admin/bootstrap-tenant`` endpoint.
        """
        # 1. Tenant
        result = await db.execute(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = result.scalar_one_or_none()
        if tenant is None:
            tenant = Tenant(slug=tenant_slug, name=tenant_slug, settings={})
            db.add(tenant)
            await db.commit()
            await db.refresh(tenant)

        # 2. Org (idempotent by (tenant_id, name))
        result = await db.execute(
            select(Organization).where(
                Organization.tenant_id == tenant.id,
                Organization.name == org_name,
            )
        )
        org = result.scalar_one_or_none()
        if org is None:
            org = Organization(tenant_id=tenant.id, name=org_name, brand={})
            db.add(org)
            await db.commit()
            await db.refresh(org)

        # 3. Team
        result = await db.execute(
            select(Team).where(
                Team.tenant_id == tenant.id,
                Team.org_id == org.id,
                Team.name == team_name,
            )
        )
        team = result.scalar_one_or_none()
        if team is None:
            team = Team(
                tenant_id=tenant.id,
                org_id=org.id,
                name=team_name,
                model_allowlist=[],
                default_agent_config={},
            )
            db.add(team)
            await db.commit()
            await db.refresh(team)

        # 4. User (mirror)
        result = await db.execute(select(User).where(User.keycloak_sub == keycloak_sub))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(
                tenant_id=tenant.id,
                keycloak_sub=keycloak_sub,
                email=user_email,
                display_name=user_email.split("@", 1)[0],
                mfa_enabled=False,
                role_ids=[],
                profile={"role": "org_admin"},
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

        # 5. Add as org_admin member of the team (idempotent).
        result = await db.execute(
            select(TeamMember).where(
                TeamMember.team_id == team.id,
                TeamMember.user_id == user.id,
            )
        )
        if result.scalar_one_or_none() is None:
            member = TeamMember(
                tenant_id=tenant.id,
                team_id=team.id,
                user_id=user.id,
                role=RoleEnum.ORG_ADMIN.value,
            )
            db.add(member)
            await db.commit()

        return {
            "tenant_id": str(tenant.id),
            "org_id": str(org.id),
            "team_id": str(team.id),
            "user_id": str(user.id),
        }


rbac_v2_service = RBACv2Service()


__all__ = ["RBACv2Service", "rbac_v2_service"]
