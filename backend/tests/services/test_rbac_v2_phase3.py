"""step-78 F12 gap coverage — schemas + service surface.

These are the smallest checks that fail if the phase-3 additions break.
Run with: cd backend && python -m pytest tests/services/test_rbac_v2_phase3.py -q
"""

from __future__ import annotations

from app.schemas.rbac_v2 import (
    BulkTeamMemberAddRequest,
    CustomerUpdate,
    DailyRollup,
    ProjectCreate,
    ProjectUpdate,
    RoleEnum,
    TeamMemberCreate,
    TeamModelAllowlistRequest,
    TeamPermissionOverride,
    role_grants,
)
from app.services.rbac_v2_service import RBACv2Service, rbac_v2_service


def test_role_inheritance_step78():
    # Acceptance #8: team_admin inherits member; revoking team_admin does not revoke member.
    assert role_grants(RoleEnum.TEAM_ADMIN, RoleEnum.MEMBER)
    assert role_grants(RoleEnum.ORG_ADMIN, RoleEnum.TEAM_ADMIN)
    assert role_grants(RoleEnum.SUPER_ADMIN, RoleEnum.CUSTOMER_ADMIN) is False  # orthogonal axis
    assert not role_grants(RoleEnum.VIEWER, RoleEnum.MEMBER)


def test_bulk_request_shape():
    req = BulkTeamMemberAddRequest(
        members=[TeamMemberCreate(user_id=__import__("uuid").uuid4(), role=RoleEnum.MEMBER)]
    )
    assert req.atomic is False
    assert len(req.members) == 1


def test_project_create_shape():
    from uuid import uuid4

    p = ProjectCreate(name="Demo", slug="demo", team_id=uuid4())
    assert p.visibility == "private"
    assert p.default_branch == "main"
    u = ProjectUpdate(name="Renamed")
    assert u.name == "Renamed" and u.slug is None


def test_customer_update_partial():
    u = CustomerUpdate(name="Acme")
    assert u.description is None and u.billing_ref is None and u.name == "Acme"


def test_daily_rollup_defaults():
    r = DailyRollup(entity_id=__import__("uuid").uuid4(), entity_type="team")
    assert r.spend_usd == 0.0 and r.request_count == 0 and r.window == "24h"


def test_team_model_allowlist():
    req = TeamModelAllowlistRequest(model="claude-sonnet-4-6")
    assert req.model == "claude-sonnet-4-6"


def test_permission_override_shape():
    from uuid import uuid4

    o = TeamPermissionOverride(user_id=uuid4(), granted=["rbac:foo:bar"], revoked=["rbac:baz"])
    assert o.granted == ["rbac:foo:bar"]


def test_service_has_phase3_methods():
    expected = {
        "create_project",
        "list_projects",
        "get_project",
        "update_project",
        "delete_project",
        "add_members_bulk",
        "add_team_model",
        "remove_team_model",
        "update_customer",
        "delete_customer",
        "daily_rollup",
    }
    missing = expected - set(dir(rbac_v2_service))
    assert not missing, f"missing: {missing}"


def test_role_for_principal():
    from uuid import uuid4

    from app.core.security import AuthenticatedPrincipal

    p = AuthenticatedPrincipal(
        user_id=uuid4(),
        email="a@b.c",
        tenant_id=uuid4(),
        project_id=uuid4(),
        roles={"forge:admin"},
        raw_claims={},
    )
    assert RBACv2Service.role_for(p) == RoleEnum.ORG_ADMIN
    p_super = AuthenticatedPrincipal(
        user_id=uuid4(),
        email="a@b.c",
        tenant_id=uuid4(),
        project_id=uuid4(),
        roles={"forge:super"},
        raw_claims={},
    )
    assert RBACv2Service.role_for(p_super) == RoleEnum.SUPER_ADMIN


if __name__ == "__main__":  # pragma: no cover
    import sys

    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as e:
                print(f"FAIL {name}: {e}")
                sys.exit(1)
