"""JSON Schema declarations for the 11 V1 Co-pilot tools (F-800 Plan 0.3).

These schemas are *not* enforced at runtime — :class:`Tool` implementations
parse their own arguments and raise :class:`ToolArgumentInvalid` when
something is missing or malformed. The schemas here exist so the tool
catalog can be rendered in documentation and so tests can pin the shape
without having to import each tool module.

Each entry mirrors what the tool publishes via :attr:`Tool.parameters_schema`.
The model sees these schemas inline in the LiteLLM ``tools`` array.
"""

from __future__ import annotations


SEARCH_KNOWLEDGE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "minLength": 1, "description": "Search string."},
        "node_types": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Optional filter by KG node type (e.g. service, adr).",
        },
        "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 5},
    },
    "required": ["query"],
    "additionalProperties": False,
}


GET_SERVICE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "service_id": {"type": "string", "format": "uuid"},
    },
    "required": ["service_id"],
    "additionalProperties": False,
}


GET_ADR_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "adr_id": {"type": "string", "format": "uuid"},
    },
    "required": ["adr_id"],
    "additionalProperties": False,
}


LIST_RECENT_ADRS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
    },
    "additionalProperties": False,
}


GET_STANDARDS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "keys": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "description": "Standard keys to fetch.",
        },
    },
    "required": ["keys"],
    "additionalProperties": False,
}


GET_TEMPLATE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "template_key": {"type": "string", "minLength": 1},
    },
    "required": ["template_key"],
    "additionalProperties": False,
}


NAVIGATE_TO_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "target_type": {
            "type": "string",
            "enum": ["service", "adr", "repo", "command", "page"],
        },
        "target_id": {"type": "string", "description": "Opaque target id."},
        "path": {"type": "string", "description": "Explicit path (target_type=page)."},
    },
    "required": ["target_type"],
    "additionalProperties": False,
}


DRAFT_ARTIFACT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "artifact_type": {
            "type": "string",
            "enum": ["adr", "ideation_bundle", "risk_register"],
        },
        "title": {"type": "string", "minLength": 1},
        "content": {"type": "string", "minLength": 1, "description": "Markdown body."},
        "based_on": {
            "type": "array",
            "items": {"type": "string"},
            "default": [],
            "description": "Source artifact IDs / KG node ids.",
        },
    },
    "required": ["artifact_type", "title", "content"],
    "additionalProperties": False,
}


RUN_COMMAND_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "command_id": {
            "type": "string",
            "pattern": "^forge-[a-z][a-z0-9-]*$",
            "description": "forge-* command id (see FORGE_COMMAND_MAP).",
        },
        "inputs": {
            "type": "object",
            "additionalProperties": True,
            "default": {},
            "description": "Command-specific arguments.",
        },
    },
    "required": ["command_id"],
    "additionalProperties": False,
}


CHECK_BUDGET_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "scope": {
            "type": "string",
            "enum": ["tenant", "conversation", "command"],
            "default": "tenant",
        },
        "scope_id": {"type": "string"},
    },
    "additionalProperties": False,
}


AUDIT_EVENT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "minLength": 1, "description": "e.g. copilot.tool.search_knowledge"},
        "target_type": {"type": "string", "minLength": 1},
        "target_id": {"type": "string", "minLength": 1},
        "payload": {"type": "object", "additionalProperties": True, "default": {}},
    },
    "required": ["action", "target_type", "target_id"],
    "additionalProperties": False,
}


__all__ = [
    "SEARCH_KNOWLEDGE_SCHEMA",
    "GET_SERVICE_SCHEMA",
    "GET_ADR_SCHEMA",
    "LIST_RECENT_ADRS_SCHEMA",
    "GET_STANDARDS_SCHEMA",
    "GET_TEMPLATE_SCHEMA",
    "NAVIGATE_TO_SCHEMA",
    "DRAFT_ARTIFACT_SCHEMA",
    "RUN_COMMAND_SCHEMA",
    "CHECK_BUDGET_SCHEMA",
    "AUDIT_EVENT_SCHEMA",
]
