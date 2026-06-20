"""v1 integration-test skeleton for the api service boundary.

Source PR: FORA-org/checkout-api#482
Plan id:    tplan-fora43-final

v1 emits a skeleton; Phase 2 will spin up real testcontainers
based on tech-stack.md and replace the placeholders.
"""
from __future__ import annotations

import pytest


@pytest.mark.integration
class TestApiBoundary:
    def test_writes_propagate_to_downstream(self) -> None:
        # TODO(phase-2): assert cross-service contract for api.
        assert True

    def test_idempotency_under_retry(self) -> None:
        # TODO(phase-2): re-run a write and assert no duplicate effect.
        assert True
