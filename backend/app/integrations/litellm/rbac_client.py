"""F12 RBAC — thin LiteLLM proxy method group.

Phase 3 Feature 12 wraps the LiteLLM admin endpoints for org / team /
user / project / customer hierarchy. All methods use admin auth
(``LiteLLMBaseClient.admin_client``) because these are management
endpoints, not per-tenant chat endpoints.

Per-tenant scoping is enforced by the Forge Backend layer (Rule 2);
this client is the typed proxy to the upstream LiteLLM API.

Endpoint coverage (one method per LiteLLM endpoint family from
step-78 §"LiteLLM endpoints used", F12):
  - /user/{new,list,info,update,delete,available,daily}
  - /team/{new,list,info,update,delete,available,daily,block,unblock,
          member_add,member_delete,member_update,bulk_member_add,
          model_add,model_delete,permissions_list,permissions_update}
  - /organization/{new,list,info,update,delete,member_add,
                   member_update,member_delete,daily}
  - /project/{new,list,info,update,delete}
  - /customer/{new,list,info,update,delete,block,unblock,daily}

Sister method groups for F11/F13/F14/F15 live alongside this one.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx


class RBACClientGroup:
    """Typed proxy for the F12 RBAC endpoints on the LiteLLM proxy.

    Constructed by :meth:`LiteLLMBaseClient.rbac`. The wrapped
    ``_base`` is the admin-authed ``httpx.AsyncClient`` from
    :class:`LiteLLMBaseClient`; methods return the parsed JSON body
    or ``{}`` on non-2xx so callers can branch on the shape instead
    of raising.
    """

    __slots__ = ("_base",)

    def __init__(self, base: httpx.AsyncClient) -> None:
        self._base = base

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _ok(response: httpx.Response) -> dict[str, Any]:
        """Return parsed JSON or an empty dict on non-2xx / parse failure."""
        if not (200 <= response.status_code < 300):
            return {"_status": response.status_code, "_body": response.text[:500]}
        if not response.content:
            return {}
        try:
            return response.json()
        except Exception:  # noqa: BLE001
            return {"_raw": response.text[:500]}

    # ------------------------------------------------------------------
    # /user/*
    # ------------------------------------------------------------------

    async def user_new(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/user/new", json=payload)
        return self._ok(r)

    async def user_list(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/user/list", params=params or {})
        return self._ok(r)

    async def user_info(self, user_id: str) -> dict[str, Any]:
        r = await self._base.get("/user/info", params={"user_id": user_id})
        return self._ok(r)

    async def user_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/user/update", json=payload)
        return self._ok(r)

    async def user_delete(self, user_id: str) -> dict[str, Any]:
        r = await self._base.post("/user/delete", json={"user_id": user_id})
        return self._ok(r)

    async def user_available(self) -> dict[str, Any]:
        r = await self._base.get("/user/available_users")
        return self._ok(r)

    async def user_daily(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/user/daily/activity", params=params or {})
        return self._ok(r)

    # ------------------------------------------------------------------
    # /team/*
    # ------------------------------------------------------------------

    async def team_new(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/new", json=payload)
        return self._ok(r)

    async def team_list(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/team/list", params=params or {})
        return self._ok(r)

    async def team_info(self, team_id: str) -> dict[str, Any]:
        r = await self._base.get("/team/info", params={"team_id": team_id})
        return self._ok(r)

    async def team_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/update", json=payload)
        return self._ok(r)

    async def team_delete(self, team_id: str) -> dict[str, Any]:
        r = await self._base.post("/team/delete", json={"team_id": team_id})
        return self._ok(r)

    async def team_available(self) -> dict[str, Any]:
        r = await self._base.get("/team/available")
        return self._ok(r)

    async def team_daily(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/team/daily/activity", params=params or {})
        return self._ok(r)

    async def team_block(self, team_id: str) -> dict[str, Any]:
        r = await self._base.post("/team/block", json={"team_id": team_id})
        return self._ok(r)

    async def team_unblock(self, team_id: str) -> dict[str, Any]:
        r = await self._base.post("/team/unblock", json={"team_id": team_id})
        return self._ok(r)

    async def team_member_add(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/member_add", json=payload)
        return self._ok(r)

    async def team_member_delete(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/member_delete", json=payload)
        return self._ok(r)

    async def team_member_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/member_update", json=payload)
        return self._ok(r)

    async def team_bulk_member_add(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/bulk_member_add", json=payload)
        return self._ok(r)

    async def team_model_add(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/model/add", json=payload)
        return self._ok(r)

    async def team_model_delete(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/model/delete", json=payload)
        return self._ok(r)

    async def team_permissions_list(self, team_id: str) -> dict[str, Any]:
        r = await self._base.get("/team/permissions_list", params={"team_id": team_id})
        return self._ok(r)

    async def team_permissions_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/team/permissions_update", json=payload)
        return self._ok(r)

    # ------------------------------------------------------------------
    # /organization/*
    # ------------------------------------------------------------------

    async def org_new(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/organization/new", json=payload)
        return self._ok(r)

    async def org_list(self) -> dict[str, Any]:
        r = await self._base.get("/organization/list")
        return self._ok(r)

    async def org_info(self, org_id: str) -> dict[str, Any]:
        r = await self._base.get("/organization/info", params={"org_id": org_id})
        return self._ok(r)

    async def org_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/organization/update", json=payload)
        return self._ok(r)

    async def org_delete(self, org_id: str) -> dict[str, Any]:
        r = await self._base.post("/organization/delete", json={"org_id": org_id})
        return self._ok(r)

    async def org_member_add(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/organization/member_add", json=payload)
        return self._ok(r)

    async def org_member_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/organization/member_update", json=payload)
        return self._ok(r)

    async def org_member_delete(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/organization/member_delete", json=payload)
        return self._ok(r)

    async def org_daily(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/organization/daily/activity", params=params or {})
        return self._ok(r)

    # ------------------------------------------------------------------
    # /project/*
    # ------------------------------------------------------------------

    async def project_new(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/project/new", json=payload)
        return self._ok(r)

    async def project_list(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/project/list", params=params or {})
        return self._ok(r)

    async def project_info(self, project_id: str) -> dict[str, Any]:
        r = await self._base.get("/project/info", params={"project_id": project_id})
        return self._ok(r)

    async def project_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/project/update", json=payload)
        return self._ok(r)

    async def project_delete(self, project_id: str) -> dict[str, Any]:
        r = await self._base.post("/project/delete", json={"project_id": project_id})
        return self._ok(r)

    # ------------------------------------------------------------------
    # /customer/*
    # ------------------------------------------------------------------

    async def customer_new(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/customer/new", json=payload)
        return self._ok(r)

    async def customer_list(self) -> dict[str, Any]:
        r = await self._base.get("/customer/list")
        return self._ok(r)

    async def customer_info(self, customer_id: str) -> dict[str, Any]:
        r = await self._base.get("/customer/info", params={"customer_id": customer_id})
        return self._ok(r)

    async def customer_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/customer/update", json=payload)
        return self._ok(r)

    async def customer_delete(self, customer_id: str) -> dict[str, Any]:
        r = await self._base.post("/customer/delete", json={"customer_id": customer_id})
        return self._ok(r)

    async def customer_block(self, customer_id: str) -> dict[str, Any]:
        r = await self._base.post("/customer/block", json={"customer_id": customer_id})
        return self._ok(r)

    async def customer_unblock(self, customer_id: str) -> dict[str, Any]:
        r = await self._base.post("/customer/unblock", json={"customer_id": customer_id})
        return self._ok(r)

    async def customer_daily(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/customer/daily/activity", params=params or {})
        return self._ok(r)


__all__ = ["RBACClientGroup"]
