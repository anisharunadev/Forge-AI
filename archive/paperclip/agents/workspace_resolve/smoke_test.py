"""Smoke test for FORA-411 / 0.8.4 customer extension hook.

Drives the four acceptance criteria from the issue:

  AC1 — Write tenants/acme/workspace/customer/standards.md;
        resolve --tenant acme --path customer/standards.md returns
        the tenant version; the same call for globex returns the seed.
  AC2 — The next sub-agent run on ``acme`` reads the tenant
        standards.md. (Exercised through ``read_text`` + a call
        that simulates an orchestrator read.)
  AC3 — A tenant cannot write to memory/; the write is denied and
        an audit event is appended.
  AC4 — The audit row for every resolve/write call is present in
        the JSONL log with the expected fields.

The test runs in a temp directory so it never touches the real
``tenants/`` tree or the real seed ``workspace/`` — every artifact
is wiped on exit. The "real" tenant resolution is exercised
separately via the smoke-output script and the
``forge/0.8/0.8.4_extension.md`` evidence file.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)


def _print(label: str, ok: bool, detail: str = "") -> None:
    mark = "OK  " if ok else "FAIL"
    print(f"  [{mark}] {label}{(' - ' + detail) if detail else ''}")


def _build_fake_seed(seed_root: str) -> None:
    """Drop a small but realistic seed tree: README + memory + customer + project."""
    for sub in ("memory", "customer", "project"):
        os.makedirs(os.path.join(seed_root, sub), exist_ok=True)
    with open(os.path.join(seed_root, "README.md"), "w", encoding="utf-8") as fh:
        fh.write("# Knowledge Layer\n")
    with open(os.path.join(seed_root, "customer", "standards.md"), "w", encoding="utf-8") as fh:
        fh.write("# Seed standards\n\nThis is the seed (global) standards doc.\n")
    with open(os.path.join(seed_root, "memory", "coding.md"), "w", encoding="utf-8") as fh:
        fh.write("# Seed coding rules\n\nRead-only for tenants.\n")
    with open(os.path.join(seed_root, "project", "PRD.md"), "w", encoding="utf-8") as fh:
        fh.write("# Seed PRD\n\nProject-level doc.\n")


def main() -> int:
    failures: list[str] = []

    tmp_root = tempfile.mkdtemp(prefix="resolve_smoke_")
    fake_seed = os.path.join(tmp_root, "workspace")
    fake_tenants = os.path.join(tmp_root, "tenants")
    fake_var = os.path.join(tmp_root, "var")
    os.makedirs(fake_seed)
    os.makedirs(fake_tenants)
    os.makedirs(fake_var)
    _build_fake_seed(fake_seed)

    from agents.workspace_resolve import (
        DEFAULT_AUDIT_LOG,
        PROTECTED_RELPATH_PREFIXES,
        ResolverError,
        clear_cache,
        read_text,
        resolve,
        write_to_tenant,
    )

    # The CLI uses process-global cache state; clear it before we
    # touch the fake trees so a stale cache from another test cannot
    # leak in.
    clear_cache()

    print("FORA-411 acceptance test (workspace:resolve)\n")
    print(f"  seed root:    {fake_seed}")
    print(f"  tenants root: {fake_tenants}")
    print(f"  audit log:    {os.path.join(fake_var, 'resolve-audit.jsonl')}\n")

    audit_log = os.path.join(fake_var, "resolve-audit.jsonl")

    # ---- AC1a: tenant override wins for acme ----
    acme_body = "# ACME standards\n\nTenant-owned override.\n"
    try:
        rp = write_to_tenant(
            "acme", "customer/standards.md", acme_body,
            actor="smoke-test", tenants_root=fake_tenants, audit_log=audit_log,
        )
    except ResolverError as exc:
        failures.append(f"write_to_tenant raised: {exc}")
        _print("write_to_tenant (acme override)", False, str(exc))
        shutil.rmtree(tmp_root, ignore_errors=True)
        return 1
    if rp.source != "tenant":
        failures.append(f"after write, resolve.source should be 'tenant', got {rp.source!r}")
    on_disk = os.path.join(fake_tenants, "acme", "workspace", "customer", "standards.md")
    if not os.path.isfile(on_disk):
        failures.append(f"tenant file missing on disk: {on_disk}")
    if open(on_disk, "r", encoding="utf-8").read() != acme_body:
        failures.append("tenant file body != written body")
    _print(
        "write_to_tenant (acme override)",
        rp.source == "tenant" and os.path.isfile(on_disk),
        f"path={rp.path}",
    )

    # ---- AC1b: resolve --tenant acme returns the tenant version ----
    clear_cache()
    rp_acme = resolve("acme", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
    if rp_acme is None:
        failures.append("acme resolve returned None")
        _print("resolve acme -> tenant override", False, "None")
    else:
        if rp_acme.source != "tenant":
            failures.append(f"acme resolve.source != tenant: {rp_acme.source}")
        body = read_text("acme", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
        if body != acme_body:
            failures.append(f"acme body != tenant body: {body!r}")
        else:
            _print(
                "resolve acme -> tenant override",
                True,
                f"source={rp_acme.source}, bytes={rp_acme.size}",
            )

    # ---- AC1c: globex falls through to the seed ----
    clear_cache()
    rp_globex = resolve("globex", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
    if rp_globex is None:
        failures.append("globex resolve returned None (expected seed fallthrough)")
        _print("resolve globex -> seed fallthrough", False, "None")
    else:
        if rp_globex.source != "seed":
            failures.append(f"globex resolve.source != seed: {rp_globex.source}")
        body = read_text("globex", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
        if body != open(os.path.join(fake_seed, "customer", "standards.md")).read():
            failures.append("globex body != seed body")
        else:
            _print(
                "resolve globex -> seed fallthrough",
                True,
                f"source={rp_globex.source}, bytes={rp_globex.size}",
            )

    # ---- AC2: sub-agent read path ----
    # Simulate the orchestrator read path: a sub-agent for tenant
    # ``acme`` asks for ``customer/standards.md`` and the resolver
    # returns the tenant version (not the seed). Acceptance #2 from
    # FORA-103 / 0.8.
    clear_cache()
    sub_agent_body = read_text("acme", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
    if sub_agent_body != acme_body:
        failures.append(
            f"sub-agent read path returned wrong body: {sub_agent_body!r}"
        )
    else:
        _print(
            "sub-agent read path (acme)",
            True,
            f"{len(sub_agent_body)} bytes from tenant tree",
        )

    # ---- AC3: tenant cannot write to memory/ ----
    clear_cache()
    denied = False
    try:
        write_to_tenant(
            "acme", "memory/coding.md", "tenant wants to write memory",
            actor="smoke-test", tenants_root=fake_tenants, audit_log=audit_log,
        )
    except ResolverError as exc:
        denied = True
        if "memory" not in str(exc).lower():
            failures.append(f"denial reason does not mention memory: {exc}")
    if not denied:
        failures.append("memory/ write was NOT denied")
    # The on-disk tenant memory/ file must NOT exist.
    if os.path.isfile(os.path.join(fake_tenants, "acme", "workspace", "memory", "coding.md")):
        failures.append("tenant memory/coding.md was written despite the contract")
    # The denial must be recorded in the audit log.
    with open(audit_log, "r", encoding="utf-8") as fh:
        rows = [json.loads(l) for l in fh if l.strip()]
    denial_rows = [
        r for r in rows
        if r.get("operation") == "write_to_tenant"
        and r.get("outcome") == "denied"
        and r.get("slug") == "acme"
        and r.get("relpath", "").startswith("memory/")
    ]
    if not denial_rows:
        failures.append(f"no denial audit row found; rows={rows}")
    else:
        _print(
            "memory/ write blocked + audit row",
            denied and len(denial_rows) >= 1,
            f"denied=true, audit_row.reason={denial_rows[-1].get('reason')!r}",
        )

    # ---- AC4: audit log shape + happy-path rows present ----
    if not os.path.isfile(audit_log):
        failures.append(f"audit log missing: {audit_log}")
    else:
        with open(audit_log, "r", encoding="utf-8") as fh:
            rows = [json.loads(l) for l in fh if l.strip()]
        ok_rows = [
            r for r in rows
            if r.get("operation") == "write_to_tenant"
            and r.get("outcome") == "ok"
            and r.get("slug") == "acme"
            and r.get("relpath") == "customer/standards.md"
        ]
        if not ok_rows:
            failures.append(f"no happy-path audit row found; rows={rows}")
        else:
            row = ok_rows[-1]
            required = {"actor", "operation", "outcome", "slug", "relpath", "bytes", "sha256"}
            missing = required - row.keys()
            if missing:
                failures.append(f"audit row missing fields: {missing}; got={row}")
            else:
                _print(
                    "audit row shape (happy-path + denial)",
                    True,
                    f"{len(rows)} rows, sha256={row['sha256'][:12]}...",
                )

    # ---- AC5: cache invalidation on subsequent read ----
    # Mutate the tenant file on disk; the cached entry should be
    # invalidated by mtime drift on the next read.
    clear_cache()
    rp_first = resolve("acme", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
    time.sleep(0.01)  # ensure mtime_ns changes on coarse-grained FS
    new_body = "# ACME standards v2\n"
    open(os.path.join(fake_tenants, "acme", "workspace", "customer", "standards.md"), "w", encoding="utf-8").write(new_body)
    rp_second = resolve("acme", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
    if rp_second is None or rp_second.size != len(new_body):
        failures.append(
            f"cache did not invalidate on mtime drift; second={rp_second}"
        )
    else:
        body = read_text("acme", "customer/standards.md", seed_root=fake_seed, tenants_root=fake_tenants)
        if body != new_body:
            failures.append(f"post-mutation body != new body: {body!r}")
        else:
            _print(
                "cache invalidation on mtime drift",
                True,
                f"first={rp_first.size}B, second={rp_second.size}B",
            )

    # ---- AC6: CLI exit codes + JSON output ----
    import subprocess
    cli_cmd_resolve = [
        sys.executable, "-m", "agents.workspace_resolve",
        "--tenant", "acme",
        "--path", "customer/standards.md",
        "--seed-root", fake_seed,
        "--tenants-root", fake_tenants,
        "--audit-log", audit_log,
        "--json", "--quiet",
    ]
    proc = subprocess.run(cli_cmd_resolve, cwd=ROOT, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        failures.append(f"CLI resolve exit {proc.returncode}: {proc.stderr.strip()}")
    else:
        try:
            payload = json.loads(proc.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            failures.append(f"CLI resolve did not emit JSON: {exc} ({proc.stdout!r})")
            payload = None
        if payload and (payload.get("slug") != "acme" or payload.get("source") != "tenant"):
            failures.append(f"CLI resolve JSON wrong: {payload}")
        elif payload:
            _print(
                "CLI resolve (--json)",
                True,
                f"exit=0, source={payload['source']}, bytes={payload['size']}",
            )

    cli_cmd_deny = [
        sys.executable, "-m", "agents.workspace_resolve",
        "--tenant", "acme",
        "--path", "memory/coding.md",
        "--seed-root", fake_seed,
        "--tenants-root", fake_tenants,
        "--audit-log", audit_log,
        "--write",
        "--body", "should be denied",
        "--actor", "smoke-test",
    ]
    proc = subprocess.run(cli_cmd_deny, cwd=ROOT, capture_output=True, text=True, timeout=30)
    if proc.returncode == 2:
        _print("CLI memory/ write denied (exit 2)", True, proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "denied")
    else:
        failures.append(f"CLI memory/ write did not exit 2; got {proc.returncode}: {proc.stderr}")

    shutil.rmtree(tmp_root, ignore_errors=True)

    print()
    if failures:
        print(f"FAIL ({len(failures)} issue(s))")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())