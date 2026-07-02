"""Step-73 — Feature flag catalog.

Hardcoded system defaults for the per-tenant feature-flag surface.
Per-tenant overrides live in ``Tenant.settings['feature_flags']`` JSONB.
The runtime merge is system-first, tenant-overrides-second (later wins).

ponytail: this is the simplest possible shape — a dict of ``key ->
{'default': value, 'description': str, 'type': 'bool'|'int'|'str'}``.
When a flag needs more (e.g. cohort gating, rollout windows), move it to
its own service module.
"""

from __future__ import annotations

from typing import Any

_CATALOG: dict[str, dict[str, Any]] = {
    "copilot.enabled": {
        "default": True,
        "type": "bool",
        "description": "Enable the Co-pilot FAB (⌘J).",
    },
    "connectors.github.enabled": {
        "default": True,
        "type": "bool",
        "description": "Show the GitHub connector in Connector Center.",
    },
    "kg.auto_rebuild": {
        "default": False,
        "type": "bool",
        "description": "Auto-rebuild the Knowledge Graph on repo ingest.",
    },
    "audit.retention_days": {
        "default": 90,
        "type": "int",
        "description": "How many days of audit events to retain (1-365).",
    },
    "ideation.auto_score": {
        "default": True,
        "type": "bool",
        "description": "Score new ideas automatically on intake.",
    },
    "billing.hard_cap": {
        "default": False,
        "type": "bool",
        "description": "Hard-block workflows when quota is exhausted.",
    },
    # ── Phase 4 flags (step-80) ──────────────────────────────────────
    "forge.cache.enabled": {
        "default": True,
        "type": "bool",
        "description": "Enable LLM response cache for this tenant (F19).",
    },
    "forge.cache.semantic": {
        "default": False,
        "type": "bool",
        "description": "Enable semantic (embedding-similarity) cache lookups.",
    },
    "forge.pass_through.enabled": {
        "default": False,
        "type": "bool",
        "description": "Allow this tenant to use provider pass-through proxy (F16).",
    },
    "forge.media.enabled": {
        "default": False,
        "type": "bool",
        "description": "Allow multimodal endpoints (audio/image/video/moderation).",
    },
    "forge.identity.sso": {
        "default": False,
        "type": "bool",
        "description": "Enable OIDC SSO for this tenant (F18).",
    },
    "forge.identity.scim": {
        "default": False,
        "type": "bool",
        "description": "Enable SCIM v2 provisioning for this tenant.",
    },
    "forge.identity.fallback_login": {
        "default": False,
        "type": "bool",
        "description": "Allow emergency local fallback login when SSO is down.",
    },
    "forge.realtime.enabled": {
        "default": False,
        "type": "bool",
        "description": "Enable /api/forge/realtime WebSocket sessions (F17).",
    },
    "forge.a2a.enabled": {
        "default": False,
        "type": "bool",
        "description": "Enable agent-to-agent delegation endpoints.",
    },
    "forge.credentials.enabled": {
        "default": True,
        "type": "bool",
        "description": "Allow this tenant to manage LiteLLM provider credentials.",
    },
    "forge.vault.enabled": {
        "default": False,
        "type": "bool",
        "description": "Allow HashiCorp Vault as the credential backend.",
    },
    "forge.finops.enabled": {
        "default": False,
        "type": "bool",
        "description": "Enable CloudZero/Vantage export surfaces (F20).",
    },
}


def get_catalog() -> dict[str, dict[str, Any]]:
    """Return the hardcoded system catalog (immutable snapshot)."""
    return _CATALOG


__all__ = ["get_catalog"]
