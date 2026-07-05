"""F-302 — API Contract Generator.

Generates OpenAPI 3.0 / GraphQL SDL / gRPC proto specs from natural
language descriptions. Validates structure and emits contract lifecycle
events.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.architecture import APIContract
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


_OPENAPI_PROMPT = """You are an API designer. Produce a valid OpenAPI 3.0
specification (JSON, not YAML) that captures the described API. Return
ONLY the JSON object — no markdown, no commentary.

Rules:
- Top-level keys: openapi, info, paths, components.
- `openapi` MUST be "3.0.3".
- `info.title` and `info.version` are required.
- Every operation has parameters and a 2xx response.
- Use $ref for shared schemas in components.schemas.
"""

_GRAPHQL_PROMPT = """You are an API designer. Produce a valid GraphQL
Schema Definition Language document for the described API. Return
ONLY the SDL string — no markdown fences, no commentary.

Rules:
- Include a `schema { query: Query }` declaration.
- Every type has a docstring-less body and explicit nullability.
- Use enums, inputs, and unions where appropriate.
"""

_GRPC_PROMPT = """You are an API designer. Produce a valid Protocol
Buffers v3 file for the described API. Return ONLY the proto source —
no markdown fences, no commentary.

Rules:
- Use `syntax = "proto3";` at the top.
- Each service method takes a request message and returns a response
  message; never reuse google.protobuf.Empty.
"""


class APIContractGenerator:
    """Generate / validate / publish API contracts."""

    def __init__(self, litellm_client: Any, artifact_registry: Any | None = None, event_bus: Any | None = None) -> None:
        from app.services.artifact_registry import artifact_registry as _default_registry
        self._llm = litellm_client
        self._registry = artifact_registry if artifact_registry is not None else _default_registry
        self._bus = event_bus

    async def generate_from_description(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        description: str,
        contract_type: str = "openapi",
        actor_id: UUID | str | None = None,
    ) -> APIContract:
        """Generate a contract from a free-form description."""
        contract_type = contract_type.lower()
        if contract_type not in {"openapi", "graphql", "grpc"}:
            raise ValueError(f"unsupported contract_type: {contract_type}")

        system_prompt, user_prompt = _prompts_for(contract_type, description)

        async with self._llm as client:
            response = await client.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )

        spec_content = _materialize_spec(contract_type, response)
        validation = _validate_spec(contract_type, spec_content)
        if not validation["valid"]:
            logger.warning(
                "api_contract.generated_invalid",
                errors=validation["errors"],
                contract_type=contract_type,
            )

        factory = get_session_factory()
        async with factory() as session:
            contract = APIContract(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                name=_derive_name(description, contract_type),
                version="0.1.0",
                spec_type=contract_type,
                spec_content=spec_content,
                status="draft",
                generated_by=str(actor_id) if actor_id else None,
            )
            session.add(contract)
            await session.commit()
            await session.refresh(contract)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": "api_contract",
                "contract_id": str(contract.id),
                "spec_type": contract_type,
                "valid": validation["valid"],
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        # M5-G2 — mirror the API Contract row into the Knowledge Graph
        # so the React Flow viz sees a typed
        # ``KGNode(artifact_type='api_contract')`` node.
        await self._registry.register(
            artifact_type="api_contract",
            artifact_id=str(contract.id),
            tenant_id=tenant_id,
            project_id=project_id,
            payload={
                "name": contract.name,
                "spec_type": contract_type,
                "status": contract.status,
                "valid": validation["valid"],
            },
            actor_id=actor_id,
        )
        logger.info(
            "api_contract.created",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            contract_id=str(contract.id),
            spec_type=contract_type,
        )
        return contract

    async def validate_spec(self, contract_id: UUID | str) -> dict[str, Any]:
        """Return ``{valid: bool, errors: list[str]}`` for a stored contract."""
        factory = get_session_factory()
        async with factory() as session:
            contract = await session.get(APIContract, str(contract_id))
        if contract is None:
            return {"valid": False, "errors": ["contract_not_found"]}
        return _validate_spec(contract.spec_type, contract.spec_content)

    async def publish_contract(self, contract_id: UUID | str) -> APIContract:
        """Promote a contract to the ``published`` status."""
        factory = get_session_factory()
        async with factory() as session:
            contract = await session.get(APIContract, str(contract_id))
            if contract is None:
                raise LookupError("contract_not_found")
            validation = _validate_spec(contract.spec_type, contract.spec_content)
            if not validation["valid"]:
                raise ValueError(
                    "cannot publish invalid spec: " + "; ".join(validation["errors"])
                )
            contract.status = "published"
            await session.commit()
            await session.refresh(contract)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": "api_contract",
                "contract_id": str(contract.id),
                "status": "published",
            },
            tenant_id=contract.tenant_id,
            project_id=contract.project_id,
            actor_id=None,
        )
        return contract

    async def list_contracts(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[APIContract]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(APIContract)
                .where(
                    APIContract.tenant_id == str(tenant_id),
                    APIContract.project_id == str(project_id),
                )
                .order_by(APIContract.created_at.desc())
            )
            return list((await session.execute(stmt)).scalars().all())


def _prompts_for(contract_type: str, description: str) -> tuple[str, str]:
    if contract_type == "openapi":
        return _OPENAPI_PROMPT, description
    if contract_type == "graphql":
        return _GRAPHQL_PROMPT, description
    return _GRPC_PROMPT, description


def _materialize_spec(contract_type: str, response: Any) -> dict[str, Any]:
    """Normalize the LLM response into a dict suitable for spec_content."""
    if isinstance(response, dict) and "choices" in response:
        content = response["choices"][0]["message"]["content"]
    elif isinstance(response, dict):
        return response
    else:
        content = str(response)

    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json") or text.startswith("graphql") or text.startswith("proto"):
            text = text.split("\n", 1)[-1] if "\n" in text else ""
        text = text.strip()

    if contract_type == "openapi":
        return {"raw": text, "parsed": _safe_json(text)}
    return {"raw": text}


def _validate_spec(contract_type: str, spec_content: dict[str, Any]) -> dict[str, Any]:
    """Cheap structural validation. Schema-strict checks live in F-302 later."""
    errors: list[str] = []
    if not spec_content:
        return {"valid": False, "errors": ["empty_spec"]}

    raw = spec_content.get("raw") or ""
    if not raw.strip():
        return {"valid": False, "errors": ["empty_raw"]}

    if contract_type == "openapi":
        parsed = spec_content.get("parsed")
        if not isinstance(parsed, dict):
            return {"valid": False, "errors": ["openapi_not_json_object"]}
        if parsed.get("openapi", "").startswith("3."):
            if "info" not in parsed:
                errors.append("openapi_missing_info")
            if "paths" not in parsed:
                errors.append("openapi_missing_paths")
        else:
            errors.append("openapi_version_unsupported")
    elif contract_type == "graphql":
        if "type Query" not in raw and "type Query {" not in raw:
            errors.append("graphql_missing_query_root")
    elif contract_type == "grpc":
        if 'syntax = "proto3"' not in raw:
            errors.append("proto_missing_syntax_directive")
        if "service " not in raw:
            errors.append("proto_missing_service")

    return {"valid": not errors, "errors": errors}


def _safe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _derive_name(description: str, contract_type: str) -> str:
    head = (description or "untitled").strip().splitlines()[0][:80]
    return f"{head} ({contract_type})"


__all__ = ["APIContractGenerator"]
