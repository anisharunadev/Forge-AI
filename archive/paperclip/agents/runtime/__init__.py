"""
Agent Runtime (FORA-30).

The plan-then-act execution loop that every Forge sub-agent runs on top
of. The runtime is the spine; specialist agents (BA, Architect,
Developer, QA, Security, DevOps, ...) are thin skins that declare a
plan, a tool allow-list, and a step handler.

Public surface:

    with AgentRuntime(config) as rt:
        record = rt.run(plan, executor)
"""

from .runtime import (
    AgentRuntime,
    RuntimeConfig,
    StageHandler,
    StepExecutor,
)
from .schemas import (
    Plan,
    PlanStep,
    ToolCall,
    ToolResult,
    RunRecord,
    StepRecord,
    RetryRecord,
    CostSnapshot,
    Stage,
    StageStatus,
    RunStatus,
)
from .allowlist import ToolAllowList, ToolNotAllowedError
from .retry import retry_with_idempotency, RetryConfig
from .cost import CostBudget, BudgetExceededError

__all__ = [
    "AgentRuntime",
    "RuntimeConfig",
    "StageHandler",
    "StepExecutor",
    "Plan",
    "PlanStep",
    "ToolCall",
    "ToolResult",
    "RunRecord",
    "StepRecord",
    "RetryRecord",
    "CostSnapshot",
    "Stage",
    "StageStatus",
    "RunStatus",
    "ToolAllowList",
    "ToolNotAllowedError",
    "retry_with_idempotency",
    "RetryConfig",
    "CostBudget",
    "BudgetExceededError",
]
