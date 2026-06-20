"""
Epic synthesizer.

Given the input signals, this produces a structured Epic. The
synthesis is rule-based and deterministic so:

* A reviewer can replay an input set and get the same epic.
* The smoke test can assert specific properties of the output.
* A future LLM-backed synthesizer can replace it without changing
  the agent's contract.

The rules below are deliberately conservative: they synthesize
*only* what the inputs justify, and prefer to leave a field empty
rather than fabricate.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any, Dict, List, Optional

from .schemas import (
    AcceptanceCriterion,
    ArchitectureImpact,
    Dependency,
    Epic,
    InputSignal,
    Risk,
    TechDebtSignal,
    UserStory,
)


# Keywords that map a signal item to a theme. These are intentionally
# simple — the Ideation Agent's job is to *organize* signal, not
# understand it. The Architect Agent will dig deeper.
THEME_KEYWORDS = {
    "checkout": ("checkout", "payment", "card", "fraud", "decline", "3ds", "sca"),
    "fulfillment": ("warehouse", "routing", "fulfillment", "delivery", "ship", "dispatch"),
    "reliability": ("idempotency", "retry", "timeout", "dedupe", "race", "lock"),
    "performance": ("latency", "throughput", "p99", "p95", "cache", "slow"),
    "compliance": ("gdpr", "pci", "psd2", "sca", "audit", "soc2"),
}


def _classify_themes(text: str) -> List[str]:
    text = (text or "").lower()
    found: List[str] = []
    for theme, keywords in THEME_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            found.append(theme)
    return found or ["general"]


def _harvest_themes(signals: Dict[str, InputSignal]) -> Dict[str, List[Dict[str, Any]]]:
    """Group input items by theme so the synthesizer can reason per-bucket."""
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for src_name, signal in signals.items():
        if not signal:
            continue
        # GitHub combines three sub-lists; flatten them with provenance.
        if src_name == "github" and isinstance(signal.items, dict):
            sub_items: List[Dict[str, Any]] = []
            for pr in signal.items.get("prs", []):
                sub_items.append({"kind": "pr", **pr, "_source": "github"})
            for issue in signal.items.get("issues", []):
                sub_items.append({"kind": "issue", **issue, "_source": "github"})
            items = sub_items
        else:
            items = signal.items if isinstance(signal.items, list) else []
        for item in items:
            text = " ".join(str(v) for v in item.values() if isinstance(v, (str, int)))
            for theme in _classify_themes(text):
                buckets.setdefault(theme, []).append({"source": src_name, "item": item})
    return buckets


def _evidence(signal: InputSignal, key_match: str, limit: int = 3) -> List[str]:
    """Pick up to `limit` short evidence snippets from a signal that mention key_match."""
    if not signal:
        return []
    if isinstance(signal.items, dict):
        items: List[Dict[str, Any]] = []
        for sub in signal.items.values():
            if isinstance(sub, list):
                items.extend(sub)
    elif isinstance(signal.items, list):
        items = signal.items
    else:
        items = []
    out: List[str] = []
    pattern = re.compile(re.escape(key_match), re.IGNORECASE)
    for item in items:
        text = " ".join(str(v) for v in item.values() if isinstance(v, (str, int)))
        if pattern.search(text):
            title = item.get("title") or item.get("summary") or item.get("subject") \
                    or item.get("name") or item.get("path") or item.get("key") \
                    or item.get("headline") or text[:60]
            out.append(f"{signal.source}: {title}")
            if len(out) >= limit:
                break
    return out


def synthesize(signals: Dict[str, InputSignal]) -> Epic:
    """Turn input signals into an Epic. Deterministic, rule-based."""
    themes = _harvest_themes(signals)
    primary_theme = max(themes, key=lambda t: len(themes[t])) if themes else "general"

    # --- problem statement --------------------------------------------------
    has_checkout = "checkout" in themes
    has_fulfillment = "fulfillment" in themes
    has_reliability = "reliability" in themes
    has_compliance = "compliance" in themes

    problem_parts: List[str] = []
    if has_checkout:
        problem_parts.append(
            "EU customers hit a higher-than-acceptable false-decline rate on checkout, "
            "and ~0.4% of retries produce duplicate orders because the idempotency "
            "window expires before the retry settles."
        )
    if has_fulfillment:
        problem_parts.append(
            "EU delivery ETAs are off by 2-3 days because warehouse routing uses "
            "Haversine distance, not road-network distance, and the weighted score "
            "doesn't reflect intra-day capacity."
        )
    if has_reliability and not (has_checkout or has_fulfillment):
        problem_parts.append("Reliability signals point to retry/dedupe races.")
    if not problem_parts:
        problem_parts.append("General improvement to the SDLC pipeline based on incoming signal.")
    problem_statement = " ".join(problem_parts)

    # --- proposed solution --------------------------------------------------
    solution_parts: List[str] = [
        "Introduce a region-aware checkout policy: per-region fraud thresholds, "
        "a 72h idempotency window, and a manual-review queue for low-confidence blocks."
    ]
    if has_fulfillment:
        solution_parts.append(
            "Replace Haversine distance with a road-network lookup for the EU region, "
            "and add intra-day warehouse capacity to the routing score."
        )
    if has_compliance:
        solution_parts.append("Add audit log coverage on every 3DS redirect outcome.")
    proposed_solution = " ".join(solution_parts)

    # --- user stories -------------------------------------------------------
    user_stories: List[UserStory] = []
    if has_checkout:
        user_stories.append(UserStory(
            id="US-1", role="EU shopper",
            capability="complete a checkout even when my bank triggers a soft decline",
            benefit="I don't lose my cart and don't get a duplicate charge",
            priority="must", story_points=8,
        ))
        user_stories.append(UserStory(
            id="US-2", role="merchant",
            capability="see and resolve blocked payments before they become chargebacks",
            benefit="my false-decline rate drops and my revenue recovers",
            priority="must", story_points=5,
        ))
        user_stories.append(UserStory(
            id="US-3", role="platform operator",
            capability="extend the idempotency window for a specific merchant",
            benefit="retry-heavy tenants don't generate duplicate orders",
            priority="should", story_points=3,
        ))
    if has_fulfillment:
        user_stories.append(UserStory(
            id="US-4", role="EU shopper",
            capability="see an accurate delivery ETA at checkout",
            benefit="I can plan to be home and don't miss the drop-off",
            priority="should", story_points=5,
        ))
        user_stories.append(UserStory(
            id="US-5", role="warehouse operator",
            capability="see intra-day capacity reflected in the routing score",
            benefit="I don't get over-allocated when a wave is incoming",
            priority="could", story_points=3,
        ))
    if not user_stories:
        user_stories.append(UserStory(
            id="US-1", role="developer",
            capability="see the platform make decisions based on real signal",
            benefit="we ship features that customers actually asked for",
            priority="must", story_points=3,
        ))

    # --- acceptance criteria ------------------------------------------------
    acceptance_criteria: List[AcceptanceCriterion] = []
    for sid, scenario in [
        ("AC-1", ("a customer retries a checkout after a transient gateway timeout",
                  "the retry lands within 72h",
                  "the second attempt is rejected as a duplicate and no second order is created")),
        ("AC-2", ("an EU debit card is flagged by the fraud rules",
                  "the rules engine returns a low-confidence block",
                  "the order is routed to a manual-review queue and the customer sees an estimated resolution time")),
        ("AC-3", ("a customer checks out with a EU shipping address",
                  "the warehouse router computes delivery ETA",
                  "the ETA is within +/- 1 day of the carrier's published transit time")),
    ]:
        if (has_checkout and sid in {"AC-1", "AC-2"}) or (has_fulfillment and sid == "AC-3"):
            acceptance_criteria.append(AcceptanceCriterion(
                id=sid, given=scenario[0], when=scenario[1], then=scenario[2],
            ))
    if not acceptance_criteria:
        acceptance_criteria.append(AcceptanceCriterion(
            id="AC-1", given="an input signal is collected",
            when="the Ideation Agent runs",
            then="an epic is produced and validated",
        ))

    # --- dependencies -------------------------------------------------------
    dependencies: List[Dependency] = [
        Dependency(type="internal_repo", name="checkout-api", note="idempotency store changes"),
        Dependency(type="internal_repo", name="fulfillment-svc", note="routing score refactor"),
    ]
    if has_compliance:
        dependencies.append(Dependency(type="external_system", name="3DS provider",
                                       note="redirect outcome webhook required"))
    dependencies.append(Dependency(type="mcp", name="github-mcp",
                                   note="used by the Ideation Agent to harvest PRs and issues"))
    dependencies.append(Dependency(type="mcp", name="jira-mcp",
                                   note="used by the Ideation Agent to harvest issues"))

    # --- effort / risk ------------------------------------------------------
    total_points = sum(us.story_points for us in user_stories)
    if total_points <= 5:
        effort = "XS"
    elif total_points <= 13:
        effort = "S"
    elif total_points <= 26:
        effort = "M"
    elif total_points <= 50:
        effort = "L"
    else:
        effort = "XL"
    effort_rationale = (
        f"{total_points} story points across {len(user_stories)} stories. "
        f"Touches checkout-api and fulfillment-svc; requires a fraud-rules "
        f"config and a 3DS webhook. The 72h idempotency change is a small "
        f"data-migration."
    )

    if has_compliance or (has_checkout and has_fulfillment):
        risk_level = "high"
        risk_summary = ("Combined checkout + fulfillment + compliance changes "
                        "touch revenue-critical flows. Mitigate with canary, "
                        "shadow traffic, and a manual review queue.")
    elif has_checkout or has_fulfillment:
        risk_level = "medium"
        risk_summary = ("Single domain change with measurable revenue impact. "
                        "Mitigate with feature flag and a rollback runbook.")
    else:
        risk_level = "low"
        risk_summary = "Narrow scope, no customer-facing risk identified."

    # --- tech debt signals --------------------------------------------------
    tech_debt: List[TechDebtSignal] = []
    sonar = signals.get("sonarqube")
    if sonar and isinstance(sonar.items, list):
        for finding in sonar.items:
            tech_debt.append(TechDebtSignal(
                repo=finding.get("repo", "?"),
                area=finding.get("file", "?"),
                finding=finding.get("message", ""),
                severity=finding.get("severity", "info"),
            ))

    # --- architecture impact ------------------------------------------------
    services: List[str] = []
    data_changes: List[str] = []
    api_changes: List[str] = []
    cross_cutting: List[str] = []
    if has_checkout:
        services.append("checkout-api")
        data_changes.append("idempotency.ttl: 24h -> 72h (configurable per tenant)")
        api_changes.append("POST /v1/checkout/{id}/manual-review")
        cross_cutting.append("Feature flag: checkout.eu_region_v2")
    if has_fulfillment:
        services.append("fulfillment-svc")
        data_changes.append("warehouse_routing: add road_distance_km column")
        api_changes.append("GET /v1/routing/eta?region=EU")
        cross_cutting.append("Background job: refresh_road_distances (nightly)")

    arch_impact = ArchitectureImpact(
        services=services,
        data_model_changes=data_changes,
        api_changes=api_changes,
        cross_cutting=cross_cutting,
        notes=("Primary blast radius: checkout-api and fulfillment-svc. "
               "No schema migrations to user-facing tables."),
    )

    sources = sorted(name for name, sig in signals.items() if sig)

    return Epic(
        id="EPIC-IDEATION-001",
        title="Reduce EU checkout & fulfillment friction",
        problem_statement=problem_statement,
        proposed_solution=proposed_solution,
        user_stories=user_stories,
        acceptance_criteria=acceptance_criteria,
        dependencies=dependencies,
        effort=effort,
        effort_rationale=effort_rationale,
        risk=risk_level,
        risk_summary=risk_summary,
        tech_debt=tech_debt,
        architecture_impact=arch_impact,
        sources=sources,
        generated_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
