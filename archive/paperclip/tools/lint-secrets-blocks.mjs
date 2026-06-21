#!/usr/bin/env node
/**
 * lint-secrets-blocks.mjs — CI lint for FORA-128.d (ADR-0003 §7.1).
 *
 * Fails the build if an agent prompt (or any documentation that
 * guides an agent's behaviour) declares a `secrets:` block with a
 * raw value. The platform's invariant is: an agent references a
 * `secret_ref` (e.g. `tenants/{tid}/secrets/{name}@{version}`) and
 * the broker materialises the value at the last hop. A `secrets:`
 * block in an agent prompt that carries a raw value is a regression
 * — it would put the value into the agent's prompt context, which
 * is exactly what the redacted-envelope contract forbids.
 *
 * Detection rule (deliberately conservative — a violation here
 * gates a merge, so false positives are preferred over misses):
 *   1. Scan `.md` and `.yaml` files under the configured roots
 *      (default: `agents/`, `tenants/`, `docs/runbooks/`).
 *   2. For each file, walk the lines. Track whether we are inside
 *      a fenced code block.
 *   3. Inside a fenced block, if a line starts with `secrets:`
 *      (yaml key) or is labelled `secrets` (the fenced `info`
 *      string after ```), treat the block as a "secrets block".
 *   4. Within a secrets block, any non-empty value that is NOT
 *      a `secret_ref:` reference (matching
 *      `tenants/{tid}/secrets/{name}@{version}`) is a violation.
 *
 * Allowed patterns:
 *   ```yaml
 *   secrets:
 *     - secret_ref: tenants/tnt_acme/secrets/gh_pat@latest
 *   ```
 *   ```yaml
 *   secrets:
 *     gh_pat: { secret_ref: tenants/tnt_acme/secrets/gh_pat }
 *   ```
 *
 * Violations (rejected):
 *   ```yaml
 *   secrets:
 *     gh_pat: ghp_ABC123...raw...
 *   ```
 *   ```yaml
 *   secrets:
 *     - name: gh_pat
 *       value: ghp_ABC123...raw...
 *   ```
 *
 * Usage:
 *   node tools/lint-secrets-blocks.mjs \
 *       --roots agents,tenants,docs/runbooks
 *
 * Exit codes:
 *   0   no violations
 *   1   at least one raw-value secrets block found
 *   2   bad CLI args
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const SECRET_REF_REGEX = /^tenants\/[A-Za-z0-9][A-Za-z0-9_-]*\/secrets\/[A-Za-z0-9][A-Za-z0-9_./-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
/** Keys we look for inside a `secrets:` block. The value next to
 *  one of these is a candidate raw value (the broker's contract is
 *  that there should be NO raw values; every secret must be
 *  referenced via `secret_ref`). */
const RAW_VALUE_KEYS = [
  "value",
  "raw",
  "raw_value",
  "password",
  "passphrase",
  "token",
  "key",
  "secret",
  "api_key",
  "access_key",
  "secret_key",
];
const SECRETS_KEY = "secrets";
const SECRET_REF_KEY = "secret_ref";
const DEFAULT_ROOTS = ["agents", "tenants", "docs/runbooks"];
const SCAN_EXTS = new Set([".md", ".markdown", ".yaml", ".yml"]);

function parseArgs(argv) {
  const out = { roots: DEFAULT_ROOTS };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--roots") {
      out.roots = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: lint-secrets-blocks.mjs [--roots <comma-separated-paths>]\n" +
          `  default roots: ${DEFAULT_ROOTS.join(", ")}`,
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* walk(p);
    } else if (e.isFile() && SCAN_EXTS.has(extname(e.name))) {
      yield p;
    }
  }
}

/** Inspect a single file's content. Returns an array of
 *  `{ file, line, column, message }` violations. */
function lintFile(filePath, repoRoot) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations = [];

  // State machine: are we inside a fenced code block, and is that
  // block a "secrets block"? `inSecretsBlock` is sticky across the
  // entire fenced block once we see `secrets:` (or the fence label
  // contains "secrets") so the lint catches values that appear
  // later in the same block.
  let inFence = false;
  let fenceLabel = ""; // the info string after ```
  let inSecretsBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)```(\s*)(.*)$/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLabel = fenceMatch[3] ?? "";
        inSecretsBlock = /\bsecrets\b/i.test(fenceLabel);
      } else {
        inFence = false;
        fenceLabel = "";
        inSecretsBlock = false;
      }
      continue;
    }
    if (!inFence) continue;

    // Promote to a secrets block if this line starts the YAML map.
    if (!inSecretsBlock && /^\s*secrets\s*:/.test(line)) {
      inSecretsBlock = true;
    }
    if (!inSecretsBlock) continue;

    if (!inSecretsBlock) continue;

    // Look for a raw-value key on this line. We tolerate YAML list
    // items (`- key: value`), nested mappings, and JSON-style
    // quoted keys (`"key": value`).
    const kvMatch = line.match(
      /^\s*(-\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.*?)\s*[,}]?\s*$/,
    );
    if (!kvMatch) continue;
    const indent = kvMatch[1] ?? "";
    const key = kvMatch[2];
    const rawValue = kvMatch[3];

    if (key === SECRET_REF_KEY) continue;
    // In a secrets block, ANY non-empty, non-`secret_ref` value
    // is a violation — the contract is that the only thing a
    // `secrets:` block can carry is `secret_ref` references. We
    // tolerate the `secrets:` parent key itself and the YAML
    // `name:` / `description:` documentation fields; those are
    // how an agent documents a referenced secret.
    if (key === SECRETS_KEY) continue;
    if (key === "name" || key === "description" || key === "id") continue;

    if (rawValue === "" || rawValue === "|" || rawValue === ">") {
      // Empty / multiline marker — not a violation by itself.
      continue;
    }
    // If the value is a `{ secret_ref: ... }` mapping, the inner
    // secret_ref is what counts; the wrapping `key:` is a name, not
    // a raw value. Heuristic: strip the leading brace and check.
    if (rawValue.startsWith("{")) {
      const innerRef = rawValue.match(/secret_ref\s*:\s*["']?([^"',}\s]+)/);
      if (innerRef && SECRET_REF_REGEX.test(innerRef[1])) continue;
      // Falls through to a violation: a value with `{` but no
      // recognisable secret_ref is a raw-value block.
    }
    if (SECRET_REF_REGEX.test(rawValue)) continue;

    // Defensive: a quoted reference like "tenants/.../..." is OK.
    const stripped = rawValue.replace(/^["']|["']$/g, "");
    if (SECRET_REF_REGEX.test(stripped)) continue;

    const rel = relative(repoRoot, filePath);
    violations.push({
      file: rel,
      line: i + 1,
      column: indent.length + key.length + 2,
      message:
        `secrets block contains a raw value (key='${key}'); use 'secret_ref: ` +
        `tenants/{tid}/secrets/{name}@{version}' instead. See ADR-0003 §7.1.`,
      key,
    });
  }
  return violations;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = resolve(".");
  const files = [];
  for (const r of args.roots) {
    const abs = resolve(repoRoot, r);
    try {
      const st = statSync(abs);
      if (st.isFile()) files.push(abs);
      else if (st.isDirectory()) for (const f of walk(abs)) files.push(f);
    } catch {
      // missing root is not a violation — the lint is opt-in.
    }
  }
  const allViolations = [];
  for (const f of files) {
    const v = lintFile(f, repoRoot);
    for (const x of v) allViolations.push(x);
  }
  if (allViolations.length === 0) {
    console.log(
      `lint-secrets-blocks: scanned ${files.length} files across ${args.roots.length} root(s) — no raw-value secrets blocks.`,
    );
    process.exit(0);
  }
  console.error(
    `lint-secrets-blocks: ${allViolations.length} raw-value secret block(s) found:`,
  );
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}:${v.column}  ${v.message}`);
  }
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(
    `lint-secrets-blocks: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  );
  process.exit(1);
}
