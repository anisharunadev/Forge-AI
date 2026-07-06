#!/usr/bin/env bash
# scripts/run-test-baseline.sh — M15 Sprint 2 reproducible test failure ledger.
#
# Runs every test surface the project owns (backend pytest + ruff + pnpm
# typecheck + vitest + playwright), emits raw output + a JSON parse for each
# surface, and prints a one-line summary per surface so CI can grep exit
# codes and durations without re-running anything.
#
# Usage:
#   scripts/run-test-baseline.sh           # full run; writes test-results/baseline/<date>/
#   scripts/run-test-baseline.sh --quick   # skip Playwright (chromium-less sandboxes)
#
# Output layout:
#   test-results/baseline/<UTC-date>/
#     pytest.log             raw pytest output
#     pytest.json            parsed failures
#     ruff.log
#     ruff.json
#     typecheck.log
#     typecheck.json
#     vitest.log
#     vitest.json
#     playwright.log         (best-effort; absent if --quick or no chromium)
#     playwright.json
#     summary.json           surface runtimes + exit codes + counts
#
# The script is observation-only: it MUST NOT modify any source file under
# apps/, backend/, packages/, or scripts/ outside of test-results/.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

QUICK=0
for arg in "$@"; do
    case "$arg" in
        --quick) QUICK=1 ;;
    esac
done

DATE_UTC="$(date -u +%Y-%m-%d)"
OUT_DIR="$REPO_ROOT/test-results/baseline/$DATE_UTC"
mkdir -p "$OUT_DIR"

log() { printf '[baseline %s] %s\n' "$(date -u +%H:%M:%S)" "$*" ; }

# Surface runner: log path, json path, label, optional flag.
surface_start() {
    local label="$1" out_log="$2" out_json="$3"
    log "START  $label → $out_log"
    SURFACE_START_TS="$(date +%s)"
}

surface_end() {
    local label="$1" out_log="$2" out_json="$3" rc="$4"
    local now elapsed
    now="$(date +%s)"
    elapsed=$(( now - SURFACE_START_TS ))
    log "END    $label rc=$rc elapsed=${elapsed}s"
    printf '%s\n%s\n' "$rc" "$elapsed" > "$OUT_DIR/${label}.exit"
    SURFACE_LAST_RC="$rc"
    SURFACE_LAST_ELAPSED="$elapsed"
}

run_pytest() {
    local out_log="$OUT_DIR/pytest.log" out_json="$OUT_DIR/pytest.json"
    surface_start pytest "$out_log" "$out_json"
    if ! command -v pytest >/dev/null 2>&1; then
        log "WARN   pytest not installed; skipping"
        echo '{"skipped":"pytest not installed"}' > "$out_json"
        surface_end pytest "$out_log" "$out_json" 127
        return 0
    fi
    # Use the backend/.venv python if available so system deps (e.g.
    # prometheus_client) are on path; fall back to PATH pytest.
    local py_bin="pytest"
    if [[ -x "$REPO_ROOT/backend/.venv/bin/python" ]]; then
        py_bin="$REPO_ROOT/backend/.venv/bin/python -m pytest"
    fi
    # Run from backend/ so pyproject.toml pytest config picks up.
    (
        cd "$REPO_ROOT/backend"
        $py_bin -ra --tb=line --no-header -q \
            --junitxml="$OUT_DIR/pytest.junit.xml" \
            2>&1
    ) | tee "$out_log" >/dev/null
    local rc=${PIPESTATUS[0]}
    # Parse failures: "FAILED <path>::<test> - <reason>" lines and "::test FAILED" pattern.
    python3 - "$out_log" "$out_json" <<'PYEOF'
import json, re, sys
log_path, out_json = sys.argv[1], sys.argv[2]
failures = []
collection_errors = 0
errors = 0
short_summary = {}
try:
    text = open(log_path, encoding='utf-8', errors='replace').read()
except FileNotFoundError:
    print(json.dumps({"failures": [], "errors": 0, "collection_errors": 0}))
    sys.exit(0)
# Match pytest's "FAILED <file>::<name> - <reason>" style + the inverse "file::name FAILED" style.
pattern = re.compile(r'^(FAILED\s+)?([\w./\-]+\.py)(?:::([\w.\-]+))?\s*([^\n]*)', re.MULTILINE)
for m in pattern.finditer(text):
    path, name, tail = m.group(2), m.group(3), m.group(4)
    if 'FAILED' in (m.group(1) or '') or 'FAILED' in tail or 'ERROR' in tail:
        failures.append({"file": path, "test": name or "", "reason": tail.strip()[:300]})
# Better: use junit xml if it exists
import os
junit = os.environ.get('OUT_DIR','') + '/pytest.junit.xml'
xml = os.path.join(os.path.dirname(out_json), 'pytest.junit.xml')
if os.path.exists(xml):
    import xml.etree.ElementTree as ET
    tree = ET.parse(xml)
    root = tree.getroot()
    for tc in root.iter('testcase'):
        for fail in tc.findall('failure'):
            failures.append({
                "file": tc.get('classname','').replace('.','/') + '.py',
                "test": tc.get('name',''),
                "reason": (fail.get('message') or fail.text or '')[:500],
                "type": fail.get('type','')
            })
        for err in tc.findall('error'):
            errors += 1
    collection_errors = len(root.findall('.//testsuite[@errors]')) or errors
# De-duplicate by file::test
seen = set()
uniq = []
for f in failures:
    k = (f['file'], f['test'])
    if k in seen:
        continue
    seen.add(k)
    uniq.append(f)
print(json.dumps({"failures": uniq[:200], "total_failures": len(uniq), "errors": errors, "collection_errors": collection_errors}, indent=2))
PYEOF
    surface_end pytest "$out_log" "$out_json" "$rc"
}

run_ruff() {
    local out_log="$OUT_DIR/ruff.log" out_json="$OUT_DIR/ruff.json"
    surface_start ruff "$out_log" "$out_json"
    if ! command -v ruff >/dev/null 2>&1; then
        log "WARN   ruff not installed; skipping"
        echo '{"skipped":"ruff not installed"}' > "$out_json"
        surface_end ruff "$out_log" "$out_json" 127
        return 0
    fi
    (
        cd "$REPO_ROOT/backend"
        ruff check --output-format=json . 2>&1
    ) > "$out_log" 2>&1
    local rc=$?
    # ruff's JSON output is array of {code, message, filename, location.row, ...}
    python3 - "$out_log" "$out_json" <<'PYEOF'
import json, sys, collections
log_path, out_json = sys.argv[1], sys.argv[2]
try:
    raw = open(log_path, encoding='utf-8', errors='replace').read()
except FileNotFoundError:
    print(json.dumps({"codes": {}, "total": 0, "files": []}))
    sys.exit(0)
# Strip leading non-JSON output (if any).
start = raw.find('[')
if start < 0:
    print(json.dumps({"codes": {}, "total": 0, "files": []}))
    sys.exit(0)
try:
    data = json.loads(raw[start:])
except json.JSONDecodeError:
    print(json.dumps({"codes": {}, "total": 0, "files": [], "parse_error": True}))
    sys.exit(0)
codes = collections.Counter()
files = collections.Counter()
for it in data:
    codes[it.get('code','?')] += 1
    files[it.get('filename','?')] += 1
print(json.dumps({
    "codes": dict(codes.most_common(40)),
    "top_files": dict(files.most_common(20)),
    "total": len(data),
    "unique_files": len(files),
}, indent=2))
PYEOF
    surface_end ruff "$out_log" "$out_json" "$rc"
}

run_typecheck() {
    local out_log="$OUT_DIR/typecheck.log" out_json="$OUT_DIR/typecheck.json"
    surface_start typecheck "$out_log" "$out_json"
    local tsc_bin="$REPO_ROOT/apps/forge/node_modules/.bin/tsc"
    if [[ ! -x "$tsc_bin" ]]; then
        log "WARN   tsc not present; skipping"
        echo '{"skipped":"tsc not installed"}' > "$out_json"
        surface_end typecheck "$out_log" "$out_json" 127
        return 0
    fi
    (
        cd "$REPO_ROOT/apps/forge"
        "$tsc_bin" --noEmit
    ) > "$out_log" 2>&1
    local rc=$?
    python3 - "$out_log" "$out_json" <<'PYEOF'
import json, re, sys, collections
log_path, out_json = sys.argv[1], sys.argv[2]
try:
    text = open(log_path, encoding='utf-8', errors='replace').read()
except FileNotFoundError:
    print(json.dumps({"errors": [], "total": 0}))
    sys.exit(0)
# TS error format: path/to/file.ts(line,col): error TSxxxx: message
pat = re.compile(r'^([^\s(].*?\.[mc]?[jt]sx?)\((\d+),\d+\):\s+error\s+(TS\d+):\s*(.*)$', re.MULTILINE)
errors = []
codes = collections.Counter()
files = collections.Counter()
for m in pat.finditer(text):
    f, line, code, msg = m.group(1), m.group(2), m.group(3), m.group(4)
    errors.append({"file": f, "line": int(line), "code": code, "message": msg.strip()[:300]})
    codes[code] += 1
    files[f] += 1
print(json.dumps({
    "errors": errors[:200],
    "codes": dict(codes.most_common(20)),
    "top_files": dict(files.most_common(20)),
    "total": len(errors),
    "unique_files": len(files),
}, indent=2))
PYEOF
    surface_end typecheck "$out_log" "$out_json" "$rc"
}

run_vitest() {
    local out_log="$OUT_DIR/vitest.log" out_json="$OUT_DIR/vitest.json"
    surface_start vitest "$out_log" "$out_json"
    if [[ ! -d "$REPO_ROOT/apps/forge/tests" ]]; then
        log "WARN   apps/forge/tests missing; skipping"
        echo '{"skipped":"apps/forge/tests missing"}' > "$out_json"
        surface_end vitest "$out_log" "$out_json" 127
        return 0
    fi
    (
        cd "$REPO_ROOT/apps/forge"
        pnpm exec vitest run --reporter=json --passWithNoTests 2>&1
    ) > "$out_log" 2>&1
    local rc=$?
    # vitest --reporter=json writes a single JSON document on the last line (or near it).
    python3 - "$out_log" "$out_json" <<'PYEOF'
import json, re, sys
log_path, out_json = sys.argv[1], sys.argv[2]
try:
    raw = open(log_path, encoding='utf-8', errors='replace').read()
except FileNotFoundError:
    print(json.dumps({"tests": [], "total_failed": 0}))
    sys.exit(0)
# Try strict JSON, then fallback to regex over FAIL  / × markers.
data = None
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    pass
if data is not None and isinstance(data, dict):
    num_failed = data.get('numFailedTests', 0)
    failed = []
    # vitest --reporter=json emits testResults as a list of {name, assertionResults}
    for path_obj in (data.get('testResults') or []):
        path = path_obj.get('name','') if isinstance(path_obj, dict) else str(path_obj)
        path_rel = path.split('/forge-ai/')[-1] if '/forge-ai/' in path else path
        for tr in (path_obj.get('assertionResults', []) if isinstance(path_obj, dict) else []):
            if tr.get('status') in ('failed', 'rejected'):
                msgs = tr.get('failureMessages') or []
                failed.append({
                    "file": path_rel,
                    "test": tr.get('fullName') or tr.get('title',''),
                    "reason": (msgs[0] if msgs else '')[:400],
                })
    print(json.dumps({
        "num_total": data.get('numTotalTests', 0),
        "num_passed": data.get('numPassedTests', 0),
        "num_failed": num_failed,
        "num_pending": data.get('numPendingTests', 0),
        "failures": failed[:200],
    }, indent=2))
    sys.exit(0)
# Fallback: regex over vitest verbose output.
fail_lines = re.findall(r'(?:✗|×|FAIL)\s+(.+?)(?:\s+\d+\s*m?s)?$', raw, re.MULTILINE)
print(json.dumps({"num_failed": len(fail_lines), "failures": [{"test": f.strip()} for f in fail_lines[:200]], "raw_fallback": True}, indent=2))
PYEOF
    surface_end vitest "$out_log" "$out_json" "$rc"
}

run_playwright() {
    local out_log="$OUT_DIR/playwright.log" out_json="$OUT_DIR/playwright.json"
    if [[ "$QUICK" -eq 1 ]]; then
        log "SKIP   playwright (--quick)"
        echo '{"skipped":"--quick mode"}' > "$out_json"
        return 0
    fi
    surface_start playwright "$out_log" "$out_json"
    if ! command -v playwright >/dev/null 2>&1 && [[ ! -x "$REPO_ROOT/apps/forge/node_modules/.bin/playwright" ]]; then
        log "WARN   playwright not installed; skipping"
        echo '{"skipped":"playwright not installed"}' > "$out_json"
        surface_end playwright "$out_log" "$out_json" 127
        return 0
    fi
    if ! command -v chromium >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1 && [[ ! -d "$HOME/.cache/ms-playwright" ]]; then
        log "WARN   no chromium browser; skipping (deferred to user's local env)"
        echo '{"skipped":"chromium not available"}' > "$out_json"
        surface_end playwright "$out_log" "$out_json" 127
        return 0
    fi
    (
        cd "$REPO_ROOT/apps/forge"
        timeout 1200 pnpm exec playwright test --reporter=json 2>&1
    ) > "$out_log" 2>&1
    local rc=$?
    python3 - "$out_log" "$out_json" <<'PYEOF'
import json, sys
log_path, out_json = sys.argv[1], sys.argv[2]
try:
    raw = open(log_path, encoding='utf-8', errors='replace').read()
except FileNotFoundError:
    print(json.dumps({"skipped": "no log"}))
    sys.exit(0)
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    # playwright json reporter is line-delimited; collect all valid JSON objects.
    objs = []
    depth = 0
    start = -1
    for i, ch in enumerate(raw):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                chunk = raw[start:i+1]
                try:
                    objs.append(json.loads(chunk))
                except json.JSONDecodeError:
                    pass
                start = -1
    if objs:
        data = objs[-1]
    else:
        print(json.dumps({"skipped": "could not parse", "raw_size": len(raw)}))
        sys.exit(0)
fails = []
def _walk(s, file=None, _depth=0):
    if _depth > 10:
        return
    cur_file = s.get('file') or file
    for sp in (s.get('specs') or []):
        for t in (sp.get('tests') or []):
            status = t.get('status')
            if status in ('failed', 'unexpected', 'timedOut', 'interrupted'):
                fails.append({
                    "file": (cur_file or '').split('/forge-ai/')[-1],
                    "title": sp.get('title',''),
                    "status": status,
                })
    for sub in (s.get('suites') or []):
        _walk(sub, cur_file, _depth + 1)
_walk(data)
print(json.dumps({"failed": fails[:200], "num_failed": len(fails), "stats": data.get('stats')}, indent=2))
PYEOF
    surface_end playwright "$out_log" "$out_json" "$rc"
}

# --- main ---
log "OUT_DIR=$OUT_DIR"
run_pytest
run_ruff
run_typecheck
run_vitest
run_playwright

# Build summary.json
python3 - "$OUT_DIR" <<'PYEOF'
import json, os, sys, datetime
out_dir = sys.argv[1]
surfaces = ['pytest', 'ruff', 'typecheck', 'vitest', 'playwright']
summary = {"date_utc": os.path.basename(out_dir), "generated_at_utc": datetime.datetime.utcnow().isoformat() + "Z", "surfaces": {}}
for s in surfaces:
    exit_file = os.path.join(out_dir, f'{s}.exit')
    json_file = os.path.join(out_dir, f'{s}.json')
    rc = None; elapsed = None
    if os.path.exists(exit_file):
        with open(exit_file) as fh:
            parts = fh.read().split('\n')
            if parts and parts[0]:
                rc = int(parts[0])
            if len(parts) > 1 and parts[1]:
                elapsed = int(parts[1])
    payload = {}
    if os.path.exists(json_file):
        try:
            with open(json_file) as fh:
                payload = json.load(fh)
        except Exception:
            payload = {"parse_error": True}
    summary["surfaces"][s] = {"exit_code": rc, "elapsed_seconds": elapsed, "summary": payload}
with open(os.path.join(out_dir, 'summary.json'), 'w') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps({k: v['exit_code'] for k, v in summary['surfaces'].items()}, indent=2))
PYEOF

log "Done. Artifacts under $OUT_DIR"
