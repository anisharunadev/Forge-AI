"""Phase 8 SC-8.5 - chat load test.

Drives 1000 concurrent ``POST /forge/chat`` calls at the FastAPI
backend using ``httpx.AsyncClient`` + ``asyncio.gather`` (capped at
100 in flight). Records p50 / p95 / p99 latency, error rate, and
total cost_usd, and writes a report to
``docs/plan/phase-8-loadtest-report.md``.

Run with::

    cd backend && PYTHONPATH=. \\
      python3 ../scripts/loadtest/chat_1000.py \\
        --base-url http://localhost:4000 \\
        --token "$JWT_TOKEN" \\
        --tenant-id "$TENANT_ID"

Ponytail: in-process asyncio load driver. Upgrade to Locust/k6 when
the harness needs parameterised ramp-up or distributed load.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import httpx


async def _one_chat(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    tenant_id: str,
    prompt: str,
    semaphore: asyncio.Semaphore,
    results: list[tuple[float, int, float]],
) -> None:
    async with semaphore:
        start = time.perf_counter()
        try:
            resp = await client.post(
                f"{base_url}/api/v1/forge/chat",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Tenant-ID": tenant_id,
                    "Content-Type": "application/json",
                },
                content=json.dumps({"message": prompt}),
                timeout=30.0,
            )
            elapsed = time.perf_counter() - start
            cost_usd = 0.0
            try:
                body = resp.json()
                cost_usd = float(body.get("cost_usd", 0.0))
            except Exception:
                pass
            results.append((elapsed, resp.status_code, cost_usd))
        except Exception as exc:
            elapsed = time.perf_counter() - start
            print(f"  request failed: {exc!r}", file=sys.stderr)
            results.append((elapsed, 599, 0.0))


async def run(
    *,
    base_url: str,
    token: str,
    tenant_id: str,
    total: int = 1000,
    concurrency: int = 100,
    prompt: str = "what is the status of the build?",
) -> dict[str, Any]:
    """Drive ``total`` chat calls at ``concurrency`` in flight."""
    semaphore = asyncio.Semaphore(concurrency)
    results: list[tuple[float, int, float]] = []
    async with httpx.AsyncClient() as client:
        tasks = [
            asyncio.create_task(
                _one_chat(
                    client,
                    base_url=base_url,
                    token=token,
                    tenant_id=tenant_id,
                    prompt=prompt,
                    semaphore=semaphore,
                    results=results,
                )
            )
            for _ in range(total)
        ]
        await asyncio.gather(*tasks)

    latencies = sorted(r[0] for r in results)
    statuses = [r[1] for r in results]
    costs = sum(r[2] for r in results)
    errors = sum(1 for s in statuses if s >= 400)

    def _pct(p: float) -> float:
        if not latencies:
            return 0.0
        idx = max(0, min(len(latencies) - 1, int(len(latencies) * p)))
        return latencies[idx]

    return {
        "total": total,
        "concurrency": concurrency,
        "errors": errors,
        "error_rate": errors / max(1, total),
        "latency_p50_ms": _pct(0.50) * 1000,
        "latency_p95_ms": _pct(0.95) * 1000,
        "latency_p99_ms": _pct(0.99) * 1000,
        "latency_mean_ms": (statistics.mean(latencies) * 1000 if latencies else 0.0),
        "total_cost_usd": costs,
        "statuses": dict((s, statuses.count(s)) for s in set(statuses)),
    }


def _write_report(result: dict[str, Any], report_path: Path) -> None:
    """Write the markdown report."""
    md = f"""# Phase 8 — Load Test Report

## Summary

- **Total requests:** {result["total"]}
- **Concurrency:** {result["concurrency"]}
- **Errors:** {result["errors"]} ({result["error_rate"]:.2%})
- **Latency p50:** {result["latency_p50_ms"]:.1f}ms
- **Latency p95:** {result["latency_p95_ms"]:.1f}ms
- **Latency p99:** {result["latency_p99_ms"]:.1f}ms
- **Latency mean:** {result["latency_mean_ms"]:.1f}ms
- **Total cost:** ${result["total_cost_usd"]:.4f}

## Status distribution

| Status | Count |
|---|---|
"""
    for status, count in sorted(result["statuses"].items()):
        md += f"| {status} | {count} |\n"
    md += "\n## Pass/fail\n\n"
    if result["latency_p95_ms"] < 2000 and result["error_rate"] < 0.001:
        md += "PASS — p95 < 2000ms, error rate < 0.1%.\n"
    else:
        md += "FAIL — investigate the latency tail or error spike.\n"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(md)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://localhost:4000")
    p.add_argument("--token", required=True, help="JWT bearer token")
    p.add_argument("--tenant-id", required=True, help="X-Tenant-ID header")
    p.add_argument("--total", type=int, default=1000)
    p.add_argument("--concurrency", type=int, default=100)
    p.add_argument(
        "--report",
        default=str(
            Path(__file__).resolve().parents[2]
            / "docs/plan/phase-8-loadtest-report.md"
        ),
    )
    args = p.parse_args()

    print(f"[chat_1000] driving {args.total} chat calls @ concurrency={args.concurrency}")
    result = asyncio.run(
        run(
            base_url=args.base_url,
            token=args.token,
            tenant_id=args.tenant_id,
            total=args.total,
            concurrency=args.concurrency,
        )
    )
    print(json.dumps(result, indent=2))
    report_path = Path(args.report)
    _write_report(result, report_path)
    print(f"[chat_1000] report at {report_path}")
    return 0 if result["error_rate"] < 0.001 else 1


if __name__ == "__main__":
    raise SystemExit(main())
