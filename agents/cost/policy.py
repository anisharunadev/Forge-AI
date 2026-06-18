"""
Per-tenant monthly budget policy (FORA-75 deliverable).

A `BudgetPolicy` is the per-tenant contract:

* `monthly_ceiling_cents` is the hard cap; at >=100% the tenant is
  paused and new runs are refused.
* `soft_threshold_fraction` (default 0.80) is the warning level; at
  >=soft% a board notification is emitted within one heartbeat.
* `per_run_budget_cents` is a hint the runtime can read to abort a
  single run before it consumes the whole tenant's monthly cap
  (this is the `budget.remaining(runId)` seam in the issue body).

The default policy is the platform's house policy: $200 / month,
soft at 80%, $5 / run as a planning hint.  Per-tenant overrides come
from the `TenantPolicyStore`.  In dev the store is in-memory; in
prod it sits next to the audit store (Postgres in the audit account)
because ceiling changes themselves need to be auditable.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
from dataclasses import dataclass
from typing import Dict, Optional


_log = logging.getLogger("fora.cost.policy")


COST_SCHEMA_VERSION = "0.1.0"


@dataclass(frozen=True)
class BudgetPolicy:
    """The per-tenant monthly budget.

    All numbers are integers.  The audit store is in cents, so
    cents are the unit of truth; dollar amounts at the API boundary
    convert through usd_cents()/cents_usd() helpers.
    """
    monthly_ceiling_cents: int
    soft_threshold_fraction: float      # in [0.0, 1.0]
    per_run_budget_cents: int          # planning hint; 0 = no per-run cap
    policy_version: str = COST_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.monthly_ceiling_cents <= 0:
            raise ValueError(
                f"monthly_ceiling_cents must be positive, got {self.monthly_ceiling_cents}"
            )
        if not 0.0 <= self.soft_threshold_fraction < 1.0:
            raise ValueError(
                f"soft_threshold_fraction must be in [0.0, 1.0), got {self.soft_threshold_fraction}"
            )
        if self.per_run_budget_cents < 0:
            raise ValueError(
                f"per_run_budget_cents must be non-negative, got {self.per_run_budget_cents}"
            )

    @property
    def soft_threshold_cents(self) -> int:
        """The spend level (in cents) at which the soft alert fires."""
        return int(self.monthly_ceiling_cents * self.soft_threshold_fraction)

    @property
    def hard_threshold_cents(self) -> int:
        """The spend level (in cents) at which the tenant is paused."""
        return self.monthly_ceiling_cents

    def to_dict(self) -> dict:
        return {
            "monthlyCeilingCents": self.monthly_ceiling_cents,
            "softThresholdFraction": self.soft_threshold_fraction,
            "perRunBudgetCents": self.per_run_budget_cents,
            "softThresholdCents": self.soft_threshold_cents,
            "hardThresholdCents": self.hard_threshold_cents,
            "policyVersion": self.policy_version,
        }


# House default.  Matches the marketing-site headline
# ("$200/tenant/month, $5/run planning hint").  A per-tenant
# override replaces these numbers entirely -- a partial override is a
# programming error.
DEFAULT_BUDGET_POLICY = BudgetPolicy(
    monthly_ceiling_cents=20_000,        # $200 / month
    soft_threshold_fraction=0.80,
    per_run_budget_cents=500,            # $5 / run planning hint
)


def _month_key(now: Optional[dt.datetime] = None) -> str:
    """Return the canonical month key for a timestamp.  Used as the
    idempotency key for the soft/hard threshold alerts (a tenant
    that crosses the soft threshold at 80.1% does not get a second
    soft alert at 81%)."""
    n = now or dt.datetime.now(dt.timezone.utc)
    return n.strftime("%Y-%m")


class TenantPolicyStore:
    """Per-tenant `BudgetPolicy` persistence.

    The store is keyed on `tenant_id` and returns the `DEFAULT_BUDGET_POLICY`
    when a tenant has no override.  In production the store is
    backed by a Postgres table in the audit account (a sibling of
    `audit.retention_policy`); in dev the store is in-memory with the
    same protocol so the runtime and tests do not care which is wired in.
    """

    def __init__(self, defaults: Optional[BudgetPolicy] = None) -> None:
        self._lock = threading.Lock()
        self._overrides: Dict[str, BudgetPolicy] = {}
        self._defaults = defaults or DEFAULT_BUDGET_POLICY

    def get(self, tenant_id: str) -> BudgetPolicy:
        """Return the policy for `tenant_id`.  Falls back to the
        house default if the tenant has no override."""
        with self._lock:
            return self._overrides.get(tenant_id, self._defaults)

    def set(self, tenant_id: str, policy: BudgetPolicy) -> None:
        """Override the policy for `tenant_id`.  The override is
        logged at INFO -- a ceiling change is a customer-facing
        contract event and the audit log is the right place to
        capture it (the prod store writes to `audit.admin_log` with
        `action='retention_policy_changed'`-shaped row; the dev
        store writes to the Python logger)."""
        with self._lock:
            self._overrides[tenant_id] = policy
        _log.info(
            "policy_set tenant=%s monthly_ceiling_cents=%d soft=%.2f per_run_cents=%d",
            tenant_id, policy.monthly_ceiling_cents, policy.soft_threshold_fraction,
            policy.per_run_budget_cents,
        )

    def clear(self, tenant_id: str) -> None:
        """Remove the override; the tenant reverts to the house default."""
        with self._lock:
            self._overrides.pop(tenant_id, None)

    def all_overrides(self) -> Dict[str, BudgetPolicy]:
        """Snapshot of every override.  For the board read API."""
        with self._lock:
            return dict(self._overrides)
