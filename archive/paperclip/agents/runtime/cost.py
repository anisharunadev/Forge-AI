"""
Cost budget tracker (FORA-30 deliverable: budget-aware cancellation).

A run has two budgets:

* a token budget (in + out), for reporting
* a dollar budget, for the hard stop

The runtime aborts the run with `BudgetExceededError` the moment the
dollar budget would be breached -- not after, not silently.  This is
the property the acceptance criteria require.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from .schemas import BudgetExceededError, CostSnapshot


_log = logging.getLogger("fora.runtime.cost")


@dataclass
class CostBudget:
    """A hard cost ceiling for one run.  The runtime aborts when the
    next attempt's projected cost would breach either the token or
    dollar ceiling."""
    max_usd: float
    max_tokens: int = 0       # 0 means "no token ceiling"
    spent: CostSnapshot = field(default_factory=CostSnapshot)

    def __post_init__(self) -> None:
        # `field(default_factory=...)` already gives us a fresh
        # CostSnapshot, but if a caller passed `None` explicitly we
        # normalise it.
        if self.spent is None:
            self.spent = CostSnapshot()

    def charge(self, cost: CostSnapshot) -> None:
        """Add `cost` to the running total.  Raises BudgetExceededError
        if the ceiling is breached."""
        self.spent = self.spent + cost
        _log.debug(
            "cost_charge usd=%.6f tokens_in=%d tokens_out=%d spent_usd=%.6f",
            cost.usd, cost.tokens_in, cost.tokens_out, self.spent.usd,
        )
        if self.spent.usd > self.max_usd:
            raise BudgetExceededError(
                f"cost ceiling breached: spent ${self.spent.usd:.4f} > cap ${self.max_usd:.4f}",
                spent_usd=self.spent.usd, ceiling_usd=self.max_usd,
            )
        if self.max_tokens and (self.spent.tokens_in + self.spent.tokens_out) > self.max_tokens:
            raise BudgetExceededError(
                f"token ceiling breached: spent {self.spent.tokens_in + self.spent.tokens_out} "
                f"> cap {self.max_tokens}",
                spent_tokens=self.spent.tokens_in + self.spent.tokens_out,
                ceiling_tokens=self.max_tokens,
            )

    def can_afford(self, cost: CostSnapshot) -> bool:
        """Return True if `cost` can be charged without breaching the
        ceiling.  Used by the retry loop to abort early."""
        projected = self.spent + cost
        if projected.usd > self.max_usd:
            return False
        if self.max_tokens and (projected.tokens_in + projected.tokens_out) > self.max_tokens:
            return False
        return True

    def remaining_usd(self) -> float:
        return max(0.0, self.max_usd - self.spent.usd)

    def snapshot(self) -> CostSnapshot:
        return CostSnapshot(
            tokens_in=self.spent.tokens_in,
            tokens_out=self.spent.tokens_out,
            usd=self.spent.usd,
        )
