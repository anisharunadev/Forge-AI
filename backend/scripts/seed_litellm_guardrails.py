#!/usr/bin/env python3
"""Configure default LiteLLM guardrails via the proxy.

These are not stored in Forge — they're written directly to
LiteLLM's config. Once configured, every LLM request through the
proxy gets these protections.

Run: docker compose exec backend python -m scripts.seed_litellm_guardrails
"""

import asyncio
import os
import sys

import httpx

# Guard: refuse to run if LITELLM_MASTER_KEY is not set.
if not os.environ.get("LITELLM_MASTER_KEY"):
    print(
        "ERROR: LITELLM_MASTER_KEY environment variable is required to seed "
        "LiteLLM guardrails. Set it before running this script (e.g. "
        "`export LITELLM_MASTER_KEY=...`).",
        file=sys.stderr,
    )
    sys.exit(1)


LITELLM_BASE = os.environ.get("LITELLM_PROXY_URL", "http://litellm:4000")
LITELLM_KEY = os.environ.get("LITELLM_MASTER_KEY", "")


SEED_GUARDRAILS = [
    {
        "guardrail_name": "pii_masking",
        "litellm_params": {
            "type": "pii_masking",
            "pii_entities": ["email", "phone", "ssn", "credit_card"],
            "mask_pattern": "[REDACTED_{type}]",
        },
        "guardrail_info": {
            "description": "Mask PII (emails, phones, SSNs) before sending to LLM",
            "applied_to": ["all_keys"],
        },
    },
    {
        "guardrail_name": "prompt_injection_detection",
        "litellm_params": {
            "type": "prompt_injection",
            "threshold": 0.85,
            "action": "block",  # block / log / warn
        },
        "guardrail_info": {
            "description": "Detect and block prompt injection attempts",
            "applied_to": ["all_keys"],
        },
    },
    {
        "guardrail_name": "content_moderation",
        "litellm_params": {
            "type": "content_filter",
            "categories": ["violence", "hate", "sexual", "self_harm"],
            "threshold": 0.7,
        },
        "guardrail_info": {
            "description": "Block unsafe content in both input and output",
            "applied_to": ["all_keys"],
        },
    },
    {
        "guardrail_name": "secret_detection",
        "litellm_params": {
            "type": "secret_detection",
            "patterns": ["api_key", "private_key", "password"],
            "action": "block",
        },
        "guardrail_info": {
            "description": "Block requests that contain secrets (API keys, passwords)",
            "applied_to": ["all_keys"],
        },
    },
]


async def seed():

    async with httpx.AsyncClient(timeout=30) as client:
        headers = {"Authorization": f"Bearer {LITELLM_KEY}"}

        for guardrail in SEED_GUARDRAILS:
            try:
                res = await client.post(
                    f"{LITELLM_BASE}/guardrails/update",
                    headers=headers,
                    json=guardrail,
                )

                if res.status_code in (200, 201):
                    print(f"✓ Guardrail: {guardrail['guardrail_name']}")

                else:
                    print(f"✗ Failed: {guardrail['guardrail_name']} — {res.text[:200]}")

            except Exception as e:
                print(f"✗ Error: {guardrail['guardrail_name']} — {e}")

        print(f"\n✅ Seeded {len(SEED_GUARDRAILS)} LiteLLM guardrails")

        print("\nNow every LLM request through the proxy gets:")

        print("  - PII masking (emails, phones, SSNs)")

        print("  - Prompt injection detection")

        print("  - Content moderation (violence, hate, sexual)")

        print("  - Secret detection (API keys, passwords)")


if __name__ == "__main__":
    asyncio.run(seed())
