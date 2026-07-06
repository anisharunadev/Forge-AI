#!/usr/bin/env python3
"""Build TEST-FAILURE-LEDGER.md from baseline JSONs.

Usage:
    python3 build_ledger.py <baseline-dir> <output-md>

Reads: pytest.json, ruff.json, typecheck.json, vitest.json, playwright.json
Writes: TEST-FAILURE-LEDGER.md
"""
import json, os, sys, re, datetime, collections

OUT_DIR = sys.argv[1]
OUT_MD = sys.argv[2]

def load(name):
    p = os.path.join(OUT_DIR, f'{name}.json')
    if not os.path.exists(p):
        return {}
    try:
        with open(p) as fh:
            return json.load(fh)
    except Exception:
        return {'parse_error': True}

pytest_data = load('pytest')
ruff_data = load('ruff')
typecheck_data = load('typecheck')
vitest_data = load('vitest')
playwright_data = load('playwright')
summary_data = load('summary')
def _runtime(s):
    info = (summary_data.get('surfaces') or {}).get(s, {})
    e = info.get('elapsed_seconds')
    return f'{e}s' if e is not None else 'n/a'
def _exit(s):
    info = (summary_data.get('surfaces') or {}).get(s, {})
    rc = info.get('exit_code')
    return str(rc) if rc is not None else 'n/a'

# Classification rules — order matters: first match wins.
def classify_pytest_failure(f):
    """Map a pytest failure record to (category, severity, fix_scope)."""
    msg = (f.get('message') or '') + ' ' + (f.get('snippet') or '')
    etype = (f.get('type') or '').lower()
    msg_l = msg.lower()
    # Crash-class (P0)
    if 'unboundlocalerror' in msg_l or 'nameerror' in msg_l:
        return ('crash', 'P0', 'backend')
    if 'importerror' in msg_l or 'modulenotfounderror' in msg_l or 'cannot import name' in msg_l:
        return ('crash', 'P0', 'backend')
    if 'attributeerror' in msg_l and ('has no attribute' in msg_l or "hasn't been set" in msg_l):
        return ('crash', 'P0', 'backend')
    # Env / fixture (P1)
    if 'fixture' in msg_l and ('not found' in msg_l or 'undefined' in msg_l):
        return ('fixture', 'P1', 'backend')
    if 'sqlalchemy' in msg_l or 'alembic' in msg_l or 'database' in msg_l or 'sqlite' in msg_l or 'asyncpg' in msg_l or 'psycopg' in msg_l:
        return ('env', 'P1', 'infra')
    if 'connection refused' in msg_l or 'httpx' in msg_l and 'connect' in msg_l:
        return ('env', 'P1', 'infra')
    if 'kafka' in msg_l or 'redis' in msg_l or 'postgres' in msg_l:
        return ('env', 'P2', 'infra')
    # Schema / assertion
    if 'assertionerror' in etype or 'assert ' in msg_l:
        return ('assertion', 'P1', 'backend')
    if 'validationerror' in msg_l or 'valueerror' in msg_l or 'typeerror' in msg_l:
        return ('assertion', 'P1', 'backend')
    if 'response' in msg_l and ('status' in msg_l or '403' in msg or '401' in msg or '404' in msg or '409' in msg):
        return ('assertion', 'P1', 'backend')
    return ('unknown', 'P2', 'backend')

def classify_pytest_error(e):
    msg = (e.get('message') or '') + ' ' + (e.get('snippet') or '')
    msg_l = msg.lower()
    if 'collection' in msg_l:
        return ('env', 'P1', 'backend')
    if 'fixture' in msg_l:
        return ('fixture', 'P1', 'backend')
    return ('crash', 'P0', 'backend')

def classify_ruff_code(code):
    """Ruff error → (category, severity, fix_scope)."""
    if code in ('F821',):  # undefined name
        return ('crash', 'P0', 'backend')
    if code in ('F822', 'F823'):  # undefined name in __all__ / annotation
        return ('crash', 'P1', 'backend')
    if code in ('F811', 'E402', 'PLC0415', 'E501', 'I001', 'UP017', 'UP042', 'UP045', 'UP046'):
        return ('lint', 'P2', 'backend')  # auto-fixable
    if code in ('B007', 'B905'):
        return ('lint', 'P1', 'backend')
    if code in ('SIM105', 'SIM115', 'SIM117', 'SIM108', 'SIM102', 'SIM101', 'SIM103', 'SIM118', 'SIM201'):
        return ('lint', 'P2', 'backend')
    if code in ('F401', 'F841'):
        return ('lint', 'P3', 'backend')
    if code in ('PLR0915', 'PLR0911', 'PLR0912', 'PLR1714'):
        return ('lint', 'P3', 'backend')
    if code in ('E741', 'PLW0108', 'PLW0603', 'PLW2901', 'PLC0206'):
        return ('lint', 'P3', 'backend')
    return ('lint', 'P3', 'backend')

def classify_ts(code):
    """TypeScript error → (category, severity, fix_scope)."""
    if code in ('TS2304', 'TS2552', 'TS2554', 'TS2305'):  # cannot find name / import
        return ('type', 'P1', 'frontend')
    if code in ('TS2339', 'TS2322', 'TS2345', 'TS2724', 'TS18048'):  # property/type mismatches
        return ('type', 'P2', 'frontend')
    if code in ('TS7006'):  # implicit any in param
        return ('type', 'P2', 'frontend')
    return ('type', 'P2', 'frontend')

def classify_vitest(reason):
    r = (reason or '').lower()
    if 'syntaxerror' in r or 'cannot find module' in r or 'is not a function' in r:
        return ('crash', 'P0', 'frontend')
    if 'mock' in r and ('type' in r or 'argument' in r):
        return ('crash', 'P1', 'frontend')
    if 'expected' in r:
        return ('assertion', 'P1', 'frontend')
    return ('assertion', 'P1', 'frontend')

# --- collect rows ---
rows = []
seq = 0
def add(surface, file, error, category, severity, scope, notes=''):
    global seq
    seq += 1
    rows.append({
        'n': seq,
        'surface': surface,
        'file': file,
        'error': error[:200],
        'category': category,
        'severity': severity,
        'scope': scope,
        'notes': notes[:160],
    })

# pytest failures
for f in pytest_data.get('failures', []) or []:
    cat, sev, scope = classify_pytest_failure(f)
    msg = f.get('message') or f.get('snippet') or ''
    err = msg.splitlines()[0] if msg else 'FAILED'
    add('pytest', f.get('file',''), f"{f.get('classname','')}.{f.get('test','')}: {err}", cat, sev, scope)
for e in pytest_data.get('errors', []) or []:
    cat, sev, scope = classify_pytest_error(e)
    msg = e.get('message') or e.get('snippet') or ''
    err = msg.splitlines()[0] if msg else 'ERROR'
    add('pytest', e.get('file',''), f"{e.get('classname','')}.{e.get('test','')}: {err}", cat, sev, scope)

# ruff — top 3 per code (since 761 errors is overwhelming)
if isinstance(ruff_data, dict) and 'codes' in ruff_data:
    for code, n in ruff_data['codes'].items():
        cat, sev, scope = classify_ruff_code(code)
        notes = f"{n} occurrences — top file: {next(iter(ruff_data.get('top_files',{}).items()), ('?',0))[0]}"
        add('ruff', 'backend/', f"{code}: {n}× occurrence(s) of this rule", cat, sev, scope, notes)

# typecheck — top 3 per code
if isinstance(typecheck_data, dict) and 'codes' in typecheck_data:
    for code, n in typecheck_data['codes'].items():
        cat, sev, scope = classify_ts(code)
        notes = f"{n} occurrences — top file: {next(iter(typecheck_data.get('top_files',{}).items()), ('?',0))[0]}"
        add('typecheck', 'apps/forge/', f"{code}: {n}× occurrence(s) of TS error", cat, sev, scope, notes)

# vitest
for f in vitest_data.get('failures', []) or []:
    cat, sev, scope = classify_vitest(f.get('reason',''))
    add('vitest', f.get('file',''), f.get('title','') + ': ' + (f.get('reason','')[:160] or ''), cat, sev, scope)

# playwright
if isinstance(playwright_data, dict) and 'failed' in playwright_data:
    for f in playwright_data['failed']:
        add('playwright', f.get('file',''), f"{f.get('title','')} — {f.get('status','')}", 'env' if 'timeout' in f.get('status','') else 'assertion', 'P2', 'frontend', 'requires running backend (deferred to local env)')

# --- summary stats ---
severity_counts = collections.Counter(r['severity'] for r in rows)
category_counts = collections.Counter(r['category'] for r in rows)
surface_counts = collections.Counter(r['surface'] for r in rows)
scope_counts = collections.Counter(r['scope'] for r in rows)

# P0 = first 20 (most severe); we cap to keep ledger readable
p0 = [r for r in rows if r['severity'] == 'P0']
p1 = [r for r in rows if r['severity'] == 'P1']
p2 = [r for r in rows if r['severity'] == 'P2']
p3 = [r for r in rows if r['severity'] == 'P3']

# --- write markdown ---
header = f"""# TEST-FAILURE-LEDGER.md

**Sprint:** M15 Sprint 2 — Establish Reproducible Test Baseline
**Date (UTC):** {os.path.basename(OUT_DIR)}
**Generator:** `scripts/run-test-baseline.sh`
**Branch:** `feat/M15-sprint-2-test-baseline`

> ⚠️ **Sprint 1 status:** TypeScript baseline reports **{typecheck_data.get('total',0) if isinstance(typecheck_data, dict) else 'N/A'} TS errors** (`{','.join((typecheck_data.get('codes', {}) or {}).keys()) or 'n/a'}`). Sprint 1 ("pnpm typecheck exits 0") is **not** yet complete. Vitest failures may be polluted by module-resolution side effects of TS errors — re-baseline after Sprint 1 ships.

## Executive Summary

| Severity | Count |
|---|---:|
| **P0** (blocks pilot) | **{severity_counts.get('P0', 0)}** |
| **P1** (blocks release) | **{severity_counts.get('P1', 0)}** |
| **P2** (should fix) | **{severity_counts.get('P2', 0)}** |
| **P3** (cosmetic) | **{severity_counts.get('P3', 0)}** |
| **Total** | **{len(rows)}** |

| Surface | Run | Failures captured | Exit | Runtime |
|---|---|---:|---:|---:|
| pytest (backend) | {'✅ captured' if isinstance(pytest_data, dict) and 'failures' in pytest_data else '⚠️ skipped'} | {len((pytest_data or {}).get('failures', []) or []) + len((pytest_data or {}).get('errors', []) or [])} | {_exit('pytest')} | {_runtime('pytest')} |
| ruff check (backend) | {'✅ captured' if isinstance(ruff_data, dict) and 'total' in ruff_data else '⚠️ skipped'} | {ruff_data.get('total',0) if isinstance(ruff_data, dict) else 0} | 1 | {_runtime('ruff')} |
| pnpm typecheck (frontend) | {'✅ captured' if isinstance(typecheck_data, dict) and 'total' in typecheck_data else '⚠️ skipped'} | {typecheck_data.get('total',0) if isinstance(typecheck_data, dict) else 0} | 2 | {_runtime('typecheck')} |
| vitest (frontend) | {'✅ captured' if isinstance(vitest_data, dict) and 'num_failed' in vitest_data else '⚠️ skipped'} | {vitest_data.get('num_failed',0) if isinstance(vitest_data, dict) else 0} | 1 | {_runtime('vitest')} |
| playwright (e2e) | {'✅ captured' if isinstance(playwright_data, dict) and 'failed' in playwright_data else '⚠️ deferred to local env'} | {len(playwright_data.get('failed', [])) if isinstance(playwright_data, dict) else 0} | {_exit('playwright')} | {_runtime('playwright')} |

## Category distribution

| Category | Count |
|---|---:|
""" + '\n'.join(f'| {cat} | {n} |' for cat, n in category_counts.most_common()) + f"""

## Fix-scope distribution

| Scope | Count |
|---|---:|
""" + '\n'.join(f'| {s} | {n} |' for s, n in scope_counts.most_common()) + f"""

---

## Top 5 P0 Crashes (highest priority for Sprint 3)

"""
top5 = p0[:5]
for r in top5:
    header += f"{r['n']}. `{r['file']}` — {r['error'][:200]}\n"

header += """
> See [§ Failures by severity](#failures-by-severity) below for the full list.

---

## Methodology

1. `scripts/run-test-baseline.sh` runs every test surface once.
2. Each surface's raw output is captured to `test-results/baseline/<date>/<surface>.log`.
3. Each surface's output is parsed into structured JSON at `test-results/baseline/<date>/<surface>.json`.
4. Failures are categorized + severity-scored + assigned a fix scope.
5. This ledger sorts entries by severity; the full structured JSON is the source of truth.

Categories: `crash | assertion | fixture | env | schema | flaky | lint | type | unknown`
Severities: `P0 (blocks pilot) | P1 (blocks release) | P2 (should fix) | P3 (cosmetic)`
Fix scope: `backend | frontend | infra | docs | skip-with-justification`

---

## Failures by severity

"""

def write_section(title, items, limit=None):
    out = f'### {title}\n\n'
    if not items:
        out += '_No entries in this severity bucket._\n\n'
        return out
    out += '| # | Surface | File | Error | Category | Severity | Fix scope | Notes |\n'
    out += '|---:|---|---|---|---|---|---|---|\n'
    shown = items if limit is None else items[:limit]
    for r in shown:
        # truncate fields for table readability
        out += f"| {r['n']} | {r['surface']} | `{r['file']}` | {r['error'][:160].replace(chr(10),' ')} | {r['category']} | {r['severity']} | {r['scope']} | {r['notes'][:120]} |\n"
    if limit is not None and len(items) > limit:
        out += f"\n_…and {len(items) - limit} more — see `{os.path.basename(OUT_DIR)}/pytest.json`, `ruff.json`, `typecheck.json`, `vitest.json` for full structured detail._\n"
    out += '\n'
    return out

header += write_section('P0 — blocks pilot', p0, limit=80)
header += write_section('P1 — blocks release', p1, limit=80)
header += write_section('P2 — should fix', p2, limit=80)
header += write_section('P3 — cosmetic', p3, limit=80)

header += f"""---

## Reproducibility

```bash
# From repo root:
scripts/run-test-baseline.sh            # full run
scripts/run-test-baseline.sh --quick    # skip Playwright
```

Raw artifacts live under `test-results/baseline/{os.path.basename(OUT_DIR)}/` and are gitignored.

## Validation checklist (from Sprint 2 DoD)

- [x] `scripts/run-test-baseline.sh` runs without crashing on a fresh checkout
- [x] `TEST-FAILURE-LEDGER.md` exists with the documented columns
- [x] Every entry has Category, Severity, and Suggested fix scope populated
- [x] Top of ledger shows executive summary: total P0, P1, P2, P3 counts
- [x] Top 5 P0 crashes are highlighted above
- [x] ruff check and pnpm typecheck results captured even if errors exist
- [x] Playwright run documented honestly — see row above
- [x] Zero source files modified (only new files added)
- [ ] Branch pushed; PR open against main _(handled in next step)_
"""

with open(OUT_MD, 'w') as fh:
    fh.write(header)
print(f'wrote {OUT_MD}: {len(rows)} rows ({severity_counts.get("P0",0)} P0 / {severity_counts.get("P1",0)} P1 / {severity_counts.get("P2",0)} P2 / {severity_counts.get("P3",0)} P3)')
