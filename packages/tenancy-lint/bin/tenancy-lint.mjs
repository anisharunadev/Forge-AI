#!/usr/bin/env node
// @fora/tenancy-lint CLI.
//
// Usage: tenancy-lint [root]
//
// Exits 0 on clean, 1 on any error finding, 0 on warnings only. This matches
// the contract of the existing CI Tier 1 lint step (warnings surface in PR
// review; errors block the build).

import { lintRepo, formatSummary } from '../dist/index.js';

const root = process.argv[2] ?? process.cwd();
const summary = lintRepo({ root });

if (summary.findings.length > 0) {
  process.stdout.write(formatSummary(summary) + '\n');
}

if (summary.errors > 0) {
  process.exit(1);
}
process.exit(0);
