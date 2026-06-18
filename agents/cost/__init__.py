"""
The Cost tracking system (FORA-75, 0.6).

Per-run, per-stage, per-tenant cost ledger derived from the Audit
system 0.5, plus per-tenant monthly ceiling enforcement (soft + hard
thresholds) and a budget hint the Agent runtime 0.2 reads to abort
runs before they exceed the cap.  See `agents/cost/README.md` for the
operational contract and `docs/adr/0002-cost-tracking-one-way-doors.md`
for the one-way-door decisions.

Public surface:

    CostLedger            -- read-only derivation from the audit store
    BudgetPolicy          -- per-tenant monthly ceiling + thresholds
    TenantPolicyStore     -- per-tenant policy persistence (in-memory dev,
                             Postgres + SQS prod via the audit seam)
    CeilingMeter          -- consumes the ledger, fires soft/hard alerts,
                             idempotent on (tenant, month)
    AlertLog              -- append-only alert store
    AlertKind             -- "soft_threshold" | "hard_threshold" | "tenant_paused"
    TenantGate            -- refuses new runs when the tenant is paused
    BoardReader           -- board read API (monthly burn-down,
                             top-spending sub-agents, alert log)
    RuntimeBudgetHint     -- budget.remaining(runId) seam for FORA-30
    COST_SCHEMA_VERSION

The cardinal rule: there is exactly one write path into the cost
ledger, and it lives in the audit system (FORA-36, 0.5).  This module
never appends to `audit.events`; it only reads.  The acceptance test
in `tests/test_reconciliation.py` is the property test for
"cost ledger reconciles to the audit ledger to the cent."
"""

from .feature_flag import cost_enabled
from .policy import (
    COST_SCHEMA_VERSION,
    BudgetPolicy,
    DEFAULT_BUDGET_POLICY,
    TenantPolicyStore,
)
from .ledger import CostLedger, CostSummary
from .ceiling import CeilingMeter, CeilingState
from .alerts import AlertKind, AlertLog, AlertRecord
from .gate import TenantGate, GateDecision
from .board import BoardReader
from .integration import RuntimeBudgetHint


__all__ = [
    "COST_SCHEMA_VERSION",
    "BudgetPolicy",
    "DEFAULT_BUDGET_POLICY",
    "TenantPolicyStore",
    "CostLedger",
    "CostSummary",
    "CeilingMeter",
    "CeilingState",
    "AlertKind",
    "AlertLog",
    "AlertRecord",
    "TenantGate",
    "GateDecision",
    "BoardReader",
    "RuntimeBudgetHint",
    "cost_enabled",
]
