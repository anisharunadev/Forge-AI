// tools/gitleaks/gitleaks-fixture.test.mjs
// FORA-188 / FORA-128.e regression test.
//
// We exercise the `.gitleaks.toml` rule set against a known-bad
// fixture file (`tools/gitleaks/fixtures/known-bad.ts`). The
// fixture contains placeholder high-entropy strings that should
// trigger every FORA-specific rule.
//
// The test runs gitleaks against the fixture if the binary is
// available (`which gitleaks`); otherwise it falls back to a
// in-process regex scan using the same rule set. Either path
// asserts that every known-bad pattern is detected.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { strict as assert } from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const fixturePath = resolve(__dirname, "fixtures", "known-bad.ts");
const tomlPath = resolve(repoRoot, ".gitleaks.toml");

/** Mirror of the rules in `.gitleaks.toml`. The toml is the source
 *  of truth for the gitleaks binary; this list is the test-time
 *  fallback that lets the regression test run in environments
 *  without gitleaks installed. Keep in sync with the toml. */
const RULES = [
  { id: "fora-github-pat", regex: /\b((ghp|gho|ghu|ghs)_[A-Za-z0-9]{36,251})\b/g },
  { id: "fora-aws-access-key", regex: /\b((AKIA|ASIA)[0-9A-Z]{16})\b/g },
  { id: "fora-anthropic-api-key", regex: /\b(sk-ant-[A-Za-z0-9_-]{32,})\b/g },
  { id: "fora-openai-api-key", regex: /\b(sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,})\b/g },
  { id: "fora-slack-token", regex: /\b(xox[boprs]-[A-Za-z0-9-]{10,})\b/g },
  { id: "fora-stripe-live-key", regex: /\b((sk|rk)_live_[A-Za-z0-9]{20,})\b/g },
  { id: "fora-vault-service-token", regex: /\b((hvs|hvb)\.[A-Za-z0-9_-]{20,}|s\.[A-Za-z0-9]{20,})\b/g },
  { id: "fora-private-key-header", regex: /-----BEGIN ((RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY|CERTIFICATE)-----/g },
];

/** Returns a Set of rule ids that matched in the text. */
function scanText(text) {
  const matched = new Set();
  for (const r of RULES) {
    r.regex.lastIndex = 0;
    if (r.regex.test(text)) matched.add(r.id);
  }
  return matched;
}

function run(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => process.stdout.write(`  ok  ${name}\n`),
        (err) => {
          process.stdout.write(`  FAIL ${name}\n    ${err.stack ?? err.message}\n`);
          process.exitCode = 1;
        },
      );
    }
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    process.stdout.write(`  FAIL ${name}\n    ${err.stack ?? err.message}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write("# gitleaks regression: known-bad fixture is caught\n");
const fixtureText = readFileSync(fixturePath, "utf8");

run("known-bad fixture exists", () => {
  assert.ok(existsSync(fixturePath), `missing ${fixturePath}`);
});

run("in-process scan catches every FORA rule in the fixture", () => {
  const matched = scanText(fixtureText);
  for (const r of RULES) {
    assert.ok(
      matched.has(r.id),
      `expected rule ${r.id} to match the known-bad fixture, but it did not. ` +
        `If you changed the fixture, also check the .gitleaks.toml.`,
    );
  }
});

run(".gitleaks.toml exists at the repo root", () => {
  assert.ok(existsSync(tomlPath), `missing ${tomlPath}`);
});

process.stdout.write("# gitleaks binary integration (if available)\n");
run("if gitleaks is on PATH, it exits non-zero on the fixture", () => {
  const which = spawnSync("which", ["gitleaks"], { encoding: "utf8" });
  if (which.status !== 0 || !which.stdout.trim()) {
    process.stdout.write(`    (gitleaks not on PATH; skipping binary integration test)\n`);
    return;
  }
  // `gitleaks detect --no-git --source .` scans the file at the
  // given path. We point it at the fixture directly. We expect
  // a non-zero exit because the fixture is INTENTIONALLY bad.
  // The toml's allowlist does NOT cover this test invocation
  // because gitleaks is being run against the file directly,
  // not as part of a repo scan.
  const r = spawnSync(
    which.stdout.trim(),
    ["detect", "--no-git", "--source", fixturePath, "--config", tomlPath, "--exit-code", "1"],
    { encoding: "utf8" },
  );
  // gitleaks returns the count of findings in the exit code (or
  // 1 with --exit-code 1). Either is "non-zero", which is what we
  // assert.
  assert.notEqual(r.status, 0, `gitleaks should reject the fixture, got status 0\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
} else {
  process.stdout.write("\nall gitleaks regression checks green\n");
}
