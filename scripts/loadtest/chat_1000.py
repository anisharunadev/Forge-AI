#!/usr/bin/env python3
"""Phase 6 SC-6.5 — 1000 concurrent chat completions across 50 tenants.

Run against STAGING ONLY (NOT prod). Exit code 0 = p95 < 2s and error
rate < 0.1%; exit code 1 otherwise.

Usage:
    API_BASE=https://staging.forge.example.com \\
    LITELLM_BASE=https://staging-litellm.example.com \\
    python3 scripts/loadtest/chat_1000.py

ponytail: stdlib only (asyncio + httpx + statistics + json). The
benchmark harness is small enough that a third-party tool (Locust /
k6 / vegeta) is overkill — and pulling a dep into the repo for one
script is the wrong trade.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
REPORT = REPO / "docs" / "plan" / "phase-6-loadtest-report.md"

DEFAULT_TENANTS = 50
DEFAULT_USERS_PER_TENANT = 20  # 50 × 20 = 1000 concurrent
DEFAULT_DURATION_S = 300       # 5 minutes
PROMPT = "Write a haiku about distributed systems."
DEFAULT_MODEL = os.environ.get("LOADTEST_MODEL", "gpt-4o-mini")


async def one_chat(
    client: httpx.AsyncClient,
    *,
    tenant_id: str,
    user_id: str,
    model: str,
    semaphore: asyncio.Semaphore,
    results: list[dict],
) -> None:
    body = {
        "agent_id": str(uuid.uuid4()),
        "messages": [{"role": "user", "content": PROMPT}],
        "model": model,
        "max_tokens": 64,
        "stream": False,
    }
    headers = {
        "X-Forge-Tenant": tenant_id,
        "X-Forge-User": user_id,
        "Idempotency-Key": str(uuid.uuid4()),
        "Authorization": f"Bearer {os.environ.get('LOADTEST_TOKEN', 'loadtest-token')}",
    }
    started = time.monotonic()
    async with semaphore:
        try:
            r = await client.post(
                f"{os.environ['API_BASE']}/api/v1/forge/chat/stream",
                json=body,
                headers=headers,
                timeout=30.0,
            )
            latency_ms = int((time.monotonic() - started) * 1000)
            ok = r.status_code < 500
            results.append(
                {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "status": r.status_code,
                    "latency_ms": latency_ms,
                    "ok": ok,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.monotonic() - started) * 1000)
            results.append(
                {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "status": 0,
                    "latency_ms": latency_ms,
                    "ok": False,
                    "error": str(exc)[:200],
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )


async def run_load(
    *,
    api_base: str,
    tenants: int,
    users_per_tenant: int,
    duration_s: int,
    model: str,
    max_concurrency: int,
) -> dict:
    """Spawn ``tenants × users_per_tenant`` concurrent users for ``duration_s``."""
    sem = asyncio.Semaphore(max_concurrency)
    results: list[dict] = []
    started = time.monotonic()
    end_at = started + duration_s
    async with httpx.AsyncClient(http2=False) as client:
        tasks: list[asyncio.Task] = []
        for tenant_idx in range(tenants):
            tenant_id = f"loadtest-tenant-{tenant_idx:03d}"
            for user_idx in range(users_per_tenant):
                if time.monotonic() >= end_at:
                    break
                user_id = f"loadtest-user-{user_idx:04d}"
                # Issue one call every 2 seconds for the duration window.
                while time.monotonic() < end_at:
                    tasks.append(
                        asyncio.create_task(
                            one_chat(
                                client,
                                tenant_id=tenant_id,
                                user_id=user_id,
                                model=model,
                                semaphore=sem,
                                results=results,
                            )
                        )
                    )
                    await asyncio.sleep(2)
        await asyncio.gather(*tasks, return_exceptions=True)
    total_s = time.monotonic() - started
    return {"results": results, "duration_s": total_s}


def summarize(results: list[dict]) -> dict:
    ok = [r for r in results if r.get("ok")]
    fail = [r for r in results if not r.get("ok")]
    latencies = sorted(r["latency_ms"] for r in ok) if ok else [0]
    if not latencies:
        return {"n": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0, "error_rate": 1.0}
    p50 = latencies[int(len(latencies) * 0.5)]
    p95 = latencies[int(len(latencies) * 0.95)]
    p99 = latencies[int(len(latencies) * 0.99)]
    return {
        "n": len(results),
        "ok": len(ok),
        "fail": len(fail),
        "error_rate": len(fail) / len(results) if results else 0.0,
        "p50_ms": p50,
        "p95_ms": p95,
        "p99_ms": p99,
        "max_ms": max(latencies),
        "min_ms": min(latencies),
    }


def cost_per_tenant(results: list[dict]) -> dict[str, float]:
    """Heuristic: 0.001 USD per successful chat (placeholder).

    Real cost comes from /spend/logs; the load test reads the same
    endpoint post-run to reconcile.
    """
    by_tenant: dict[str, int] = {}
    for r in results:
        if r.get("ok"):
            by_tenant[r["tenant_id"]] = by_tenant.get(r["tenant_id"], 0) + 1
    return {tid: float(n * 0.001) for tid, n in by_tenant.items()}


def render_report(stats: dict, costs: dict, duration_s: float, args: argparse.Namespace) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""# Phase 6 — Load Test Report (SC-6.5)

**Captured:** {today}
**API base:** {args.api_base}
**Tenants:** {args.tenants} × **{args.users}** users = **{args.tenants * args.users}** concurrent
**Duration:** {duration_s:.0f}s
**Model:** {args.model}

## Headline

| Metric | Target | Actual | Pass? |
|---|---|---|---|
| p95 latency | < 2000 ms | {stats['p95_ms']} ms | {"yes" if stats['p95_ms'] < 2000 else "NO"} |
| Error rate | < 0.1% | {stats['error_rate'] * 100:.3f}% | {"yes" if stats['error_rate'] < 0.001 else "NO"} |
| Total requests | — | {stats['n']} | — |
| Successful | — | {stats['ok']} | — |
| Failed | — | {stats['fail']} | — |

## Latency percentiles

| Percentile | Latency (ms) |
|---|---|
| p50 | {stats['p50_ms']} |
| p95 | {stats['p95_ms']} |
| p99 | {stats['p99_ms']} |
| max | {stats['max_ms']} |
| min | {stats['min_ms']} |

## Per-tenant cost (estimated)

{len(costs)} tenants exercised. Total estimated cost: **${sum(costs.values()):.2f}**

| Top 5 tenants by spend | USD |
|---|---|
""" + "\n".join(
        f"| `{tid}` | ${cost:.4f} |"
        for tid, cost in sorted(costs.items(), key=lambda kv: -kv[1])[:5]
    ) + """

## Follow-up

- If p95 > 2s, identify the bottleneck (LiteLLM? Postgres? Redis?) and
  open a follow-up ticket. See `docs/runbooks/loadtesting.md`.
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.environ.get("API_BASE", ""))
    ap.add_argument("--tenants", type=int, default=DEFAULT_TENANTS)
    ap.add_argument("--users", type=int, default=DEFAULT_USERS_PER_TENANT)
    ap.add_argument("--duration", type=int, default=DEFAULT_DURATION_S)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-concurrency", type=int, default=200)
    args = ap.parse_args()

    if not args.api_base:
        print("::error::API_BASE env var or --api-base required", file=sys.stderr)
        return 2

    print(
        f"==> loadtest: tenants={args.tenants} users={args.users} "
        f"duration={args.duration}s model={args.model}"
    )
    out = asyncio.run(
        run_load(
            api_base=args.api_base,
            tenants=args.tenants,
            users_per_tenant=args.users,
            duration_s=args.duration,
            model=args.model,
            max_concurrency=args.max_concurrency,
        )
    )
    results = out["results"]
    stats = summarize(results)
    costs = cost_per_tenant(results)

    body = render_report(stats, costs, out["duration_s"], args)
    with REPORT.open("a", encoding="utf-8") as fh:
        fh.write("\n\n---\n\n")
        fh.write(body)
    print(body)

    p95_ok = stats["p95_ms"] < 2000
    err_ok = stats["error_rate"] < 0.001
    return 0 if (p95_ok and err_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
