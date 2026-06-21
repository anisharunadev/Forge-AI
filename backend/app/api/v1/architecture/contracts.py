"""F-302 — API Contract HTTP endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.architecture import (
    APIContractCreateRequest,
    APIContractListResponse,
    APIContractResponse,
    APIContractValidationResponse,
)
from app.services.architecture.api_contract_generator import APIContractGenerator
from app.services.artifact_registry import artifact_registry
from app.services.event_bus import bus
from app.services.litellm_client import LiteLLMClient

router = APIRouter(
    prefix="/architecture/contracts", tags=["architecture:contracts"]
)


def _generator() -> APIContractGenerator:
    return APIContractGenerator(
        litellm_client=LiteLLMClient(),
        artifact_registry=artifact_registry,
        event_bus=bus,
    )


@router.post("", response_model=APIContractResponse, status_code=status.HTTP_201_CREATED)
@audit(action="architecture.contract.create", target_type="api_contract")
async def create_contract(
    body: APIContractCreateRequest,
    principal: Principal,
    _perm: Principal = require_permission("architecture:contract:create"),
) -> APIContractResponse:
    contract = await _generator().generate_from_description(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        description=body.description,
        contract_type=body.contract_type,
        actor_id=principal.user_id,
    )
    return APIContractResponse.model_validate(contract)


@router.get("", response_model=APIContractListResponse)
@audit(action="architecture.contract.list", target_type="api_contract")
async def list_contracts(
    principal: Principal,
    _perm: Principal = require_permission("architecture:contract:read"),
    project_id: UUID = Query(...),
) -> APIContractListResponse:
    rows = await _generator().list_contracts(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    return APIContractListResponse(
        items=[APIContractResponse.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.get("/{contract_id}", response_model=APIContractResponse)
@audit(action="architecture.contract.get", target_type="api_contract")
async def get_contract(
    contract_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("architecture:contract:read"),
) -> APIContractResponse:
    factory = __import__(
        "app.db.session", fromlist=["get_session_factory"]
    ).get_session_factory()
    async with factory() as session:
        from app.db.models.architecture import APIContract

        contract = await session.get(APIContract, str(contract_id))
    if contract is None or contract.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="contract_not_found")
    return APIContractResponse.model_validate(contract)


@router.post("/{contract_id}/validate", response_model=APIContractValidationResponse)
@audit(action="architecture.contract.validate", target_type="api_contract")
async def validate_contract(
    contract_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("architecture:contract:read"),
) -> APIContractValidationResponse:
    return APIContractValidationResponse(
        **await _generator().validate_spec(contract_id)
    )


@router.post("/{contract_id}/publish", response_model=APIContractResponse)
@audit(action="architecture.contract.publish", target_type="api_contract")
async def publish_contract(
    contract_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("architecture:contract:publish"),
) -> APIContractResponse:
    try:
        contract = await _generator().publish_contract(contract_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if contract.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="contract_not_found")
    return APIContractResponse.model_validate(contract)


__all__ = ["router"]
