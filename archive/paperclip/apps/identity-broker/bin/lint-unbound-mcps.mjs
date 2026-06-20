#!/usr/bin/env node
/**
 * lint-unbound-mcps.mjs — CI lint for FORA-125 / 0.7.3.
 *
 * Fails the build if a top-level MCP in `config/agent-iam/roles.yaml` is
 * not bound to at least one role. The platform default is "unbound", so
 * adding a new MCP server without a role binding is a bug — the broker
 * will reject every ToolCall for that MCP and the platform silently
 * grows an unusable surface.
 *
 * Usage:
 *   node apps/identity-broker/bin/lint-unbound-mcps.mjs \
 *       --roles config/agent-iam/roles.yaml
 *
 * Exit codes:
 *   0   no violations
 *   1   unbound MCPs found, or roles.yaml failed to parse
 *
 * Mirrors the brokerage check in apps/identity-broker/src/iam.ts
 * (loadRoleRegistry), but reads the YAML directly so this script can run
 * in CI without compiling TypeScript.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

function parseArgs(argv) {
  const out = { roles: 'config/agent-iam/roles.yaml' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--roles') out.roles = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: lint-unbound-mcps.mjs [--roles <path>]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const path = resolve(args.roles);
  const raw = readFileSync(path, 'utf-8');
  const doc = parseYaml(raw);
  if (!doc || typeof doc !== 'object') {
    console.error(`lint-unbound-mcps: failed to parse ${path}`);
    process.exit(1);
  }
  if (doc.version !== 1) {
    console.error(`lint-unbound-mcps: unsupported version ${doc.version} in ${path} (expected 1)`);
    process.exit(1);
  }
  const mcps = Array.isArray(doc.mcps) ? doc.mcps : [];
  const roles = doc.roles && typeof doc.roles === 'object' ? doc.roles : {};
  const bound = new Set();
  for (const r of Object.values(roles)) {
    if (r && Array.isArray(r.mcps)) {
      for (const m of r.mcps) bound.add(m);
    }
  }
  const unbound = mcps.filter((m) => !bound.has(m));
  const unknownBound = [...bound].filter((m) => !mcps.includes(m));
  if (unbound.length === 0 && unknownBound.length === 0) {
    console.log(
      `lint-unbound-mcps: ${mcps.length} MCPs, ${Object.keys(roles).length} roles — all bound.`,
    );
    process.exit(0);
  }
  if (unbound.length > 0) {
    console.error(`lint-unbound-mcps: unbound MCPs (no role binding):`);
    for (const m of unbound) console.error(`  - ${m}`);
  }
  if (unknownBound.length > 0) {
    console.error(`lint-unbound-mcps: roles bind MCPs not in the top-level mcps list:`);
    for (const m of unknownBound) console.error(`  - ${m}`);
  }
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`lint-unbound-mcps: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
