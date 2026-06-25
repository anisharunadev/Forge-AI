// allow-test-rule: source-text-is-the-product
// The post-planning-gaps gap-analysis invocation is deployed workflow text the
// runtime executes; the contract is that it routes through the forge_run launcher,
// not a hardcoded $HOME path (#621).

/**
 * Regression test for #621: plan-phase gap-analysis must route through forge_run
 *
 * Prior to the fix, line 1631 of plan-phase.md hardcoded:
 *   node "$HOME/.claude/forge-core/bin/forge-tools.cjs" gap-analysis ...
 * twice on the same line, breaking non-default install layouts.
 *
 * After the fix, both invocations route through forge_run (the launcher defined
 * at line ~34 of the same file that resolves forge-tools.cjs against
 * RUNTIME_DIR / git-toplevel / PATH / $HOME in order).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  'forge-core',
  'workflows',
  'plan-phase.md'
);

// ─── Fixture ──────────────────────────────────────────────────────────────────

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

// ─── #621 regression: gap-analysis routes through forge_run ────────────────────

describe('plan-phase workflow: post-planning-gaps gap-analysis uses forge_run launcher (#621)', () => {
  test('gap-analysis dispatches via forge_run loop render-hooks plan:post (ADR-857 capability gate)', () => {
    assert.ok(
      workflow.includes('forge_run loop render-hooks plan:post'),
      'workflow must dispatch gap-analysis via forge_run loop render-hooks plan:post, not a hardcoded node path or direct forge_run gap-analysis call'
    );
  });

  test('inner phase_req_ids query also routes through forge_run', () => {
    assert.ok(
      workflow.includes('forge_run query init.plan-phase'),
      'workflow must invoke the inner phase_req_ids query via forge_run launcher'
    );
  });

  test('no hardcoded node "$HOME/.claude/forge-core/bin/forge-tools.cjs" invocations remain (#621)', () => {
    const hardcodedCount = (
      workflow.match(/node "\$HOME\/\.claude\/forge-core\/bin\/forge-tools\.cjs"/g) || []
    ).length;
    assert.strictEqual(
      hardcodedCount,
      0,
      [
        '#621 regression: workflow must not contain any hardcoded',
        'node "$HOME/.claude/forge-core/bin/forge-tools.cjs" invocations;',
        `found ${hardcodedCount}`,
      ].join(' ')
    );
  });

  test('post-planning-gaps block still gates on workflow.post_planning_gaps and preserves required args', () => {
    const hasGate = workflow.includes('workflow.post_planning_gaps');
    const hasPhaseDir = workflow.includes('forge_run check ${hook.check.query} "${PHASE_DIR}" "${PHASE_REQ_IDS}"');
    const hasPickArg = workflow.includes('--pick phase_req_ids');
    assert.ok(
      hasGate,
      'workflow must still gate the gap-analysis step on workflow.post_planning_gaps config key'
    );
    assert.ok(
      hasPhaseDir,
      'gap-analysis check dispatch must pass "${PHASE_DIR}" (and "${PHASE_REQ_IDS}") positionally to forge_run check'
    );
    assert.ok(
      hasPickArg,
      'inner query must still pass --pick phase_req_ids to extract phase requirement IDs'
    );
  });
});
