"""Smoke for ``backend/scripts/_smoke_helpers.py``.

Locks the JWT shape the in-process smoke tests depend on so a
refactor of the helper doesn't silently change which user the tests
authenticate as. We mock ``jose.jwt.encode`` so the assertions check
the claim dict rather than the signature.
"""
from __future__ import annotations

import os
from unittest import mock

from scripts import _smoke_helpers as helpers


def test_acme_constants_match_seed_bootstrap() -> None:
    # These are the values ``day_one_bootstrap`` and ``seeds/framework``
    # write; an HS256 token signed against them must use the same IDs.
    assert helpers.ACME_TENANT_ID == "a6500631-1930-5afa-9d38-24de9bedcb37"
    assert helpers.ACME_USER_ID == "00000000-0000-0000-0000-000000000999"
    assert helpers.ACME_USER_EMAIL == "arun@acme-corp.com"


def test_mint_dev_token_uses_jwt_secret_from_env() -> None:
    os.environ["JWT_SECRET"] = "test-secret"
    with mock.patch.object(helpers.jwt, "encode", return_value="signed.jwt.value") as enc:
        token = helpers.mint_dev_token()
    assert token == "signed.jwt.value"
    enc.assert_called_once()
    args, kwargs = enc.call_args
    claims, secret = args
    assert secret == "test-secret"
    assert kwargs == {"algorithm": "HS256"}


def test_mint_dev_token_carries_canonical_claims() -> None:
    os.environ["JWT_SECRET"] = "test-secret"
    with mock.patch.object(helpers.jwt, "encode") as enc:
        helpers.mint_dev_token()
    args, _ = enc.call_args
    claims = args[0]
    assert claims["sub"] == helpers.ACME_USER_ID
    assert claims["email"] == helpers.ACME_USER_EMAIL
    assert claims["forge.tenant"] == helpers.ACME_TENANT_ID
    assert claims["tenant_id"] == helpers.ACME_TENANT_ID
    assert claims["forge.project"] is None
    assert claims["realm_access"] == {"roles": ["forge-admin"]}
    assert "iat" in claims and "exp" in claims
    assert claims["exp"] - claims["iat"] == 3600  # one hour


def test_mint_dev_token_accepts_project_id() -> None:
    os.environ["JWT_SECRET"] = "test-secret"
    with mock.patch.object(helpers.jwt, "encode") as enc:
        helpers.mint_dev_token(forge_project_id="22222222-2222-4222-8222-222222222222")
    args, _ = enc.call_args
    claims = args[0]
    assert claims["forge.project"] == "22222222-2222-4222-8222-222222222222"


def test_mint_dev_token_raises_on_missing_jwt_secret() -> None:
    # Pop JWT_SECRET if present, then assert the KeyError surfaces.
    os.environ.pop("JWT_SECRET", None)
    import pytest

    with pytest.raises(KeyError):
        helpers.mint_dev_token()
