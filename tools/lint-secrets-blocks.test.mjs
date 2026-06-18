// tools/lint-secrets-blocks.test.mjs
// Self-test for lint-secrets-blocks.mjs (FORA-128.d).
// We run the lint against a known-good and a known-bad fixture
// directory under `tools/lint-secrets-blocks/fixtures/`. The
// expected behaviour:
//   - good/  → exit 0
//   - bad/   → exit 1, with violations in known files
//
// We invoke the lint as a child process so we exercise the real
// CLI surface (--roots, error formatting, exit codes).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { strict as assert } from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lintPath = resolve(__dirname, "lint-secrets-blocks.mjs");
const fixturesRoot = resolve(__dirname, "lint-secrets-blocks", "fixtures");

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    process.stdout.write(`  FAIL ${name}\n    ${err.stack ?? err.message}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write("# lint-secrets-blocks: known-good fixtures pass\n");
run("good/ exits 0 with no violations", () => {
  const r = spawnSync(process.execPath, [lintPath, "--roots", resolve(fixturesRoot, "good")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  assert.ok(/no raw-value secrets blocks/.test(r.stdout), `expected pass line in stdout, got: ${r.stdout}`);
});

process.stdout.write("# lint-secrets-blocks: known-bad fixtures fail with violations\n");
run("bad/ exits 1 and reports each violation by file:line:column", () => {
  const r = spawnSync(process.execPath, [lintPath, "--roots", resolve(fixturesRoot, "bad")], {
    encoding: "utf8",
  });
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  // We expect violations in:
  //   bad/raw-value-yaml.md
  //   bad/raw-value-fenced-yaml.md
  //   bad/raw-value-fenced-json.md
  // and NOT in bad/secret-ref-only.md
  assert.ok(/raw-value-yaml\.md:/.test(r.stderr), `expected violation in raw-value-yaml.md, got: ${r.stderr}`);
  assert.ok(/raw-value-fenced-yaml\.md:/.test(r.stderr), `expected violation in raw-value-fenced-yaml.md, got: ${r.stderr}`);
  assert.ok(/raw-value-fenced-json\.md:/.test(r.stderr), `expected violation in raw-value-fenced-json.md, got: ${r.stderr}`);
  // The known-good reference is allowed.
  assert.ok(!/secret-ref-only\.md:/.test(r.stderr), `secret-ref-only.md should not be flagged, got: ${r.stderr}`);
});

process.stdout.write("# lint-secrets-blocks: error message names ADR-0003 §7.1\n");
run("violation message links to ADR-0003 §7.1", () => {
  const r = spawnSync(process.execPath, [lintPath, "--roots", resolve(fixturesRoot, "bad")], {
    encoding: "utf8",
  });
  assert.ok(/ADR-0003 §7\.1/.test(r.stderr), `expected ADR-0003 §7.1 in error message, got: ${r.stderr}`);
});

process.stdout.write("# lint-secrets-blocks: CLI surface\n");
run("--help exits 0 with usage", () => {
  const r = spawnSync(process.execPath, [lintPath, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(/Usage:/.test(r.stdout));
});

run("unknown arg exits 2", () => {
  const r = spawnSync(process.execPath, [lintPath, "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

run("missing root is not a violation (opt-in)", () => {
  const r = spawnSync(process.execPath, [
    lintPath,
    "--roots",
    resolve(fixturesRoot, "does-not-exist"),
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
} else {
  process.stdout.write("\nall lint-secrets-blocks checks green\n");
}
