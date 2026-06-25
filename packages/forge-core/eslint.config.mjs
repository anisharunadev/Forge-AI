import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import pluginN from 'eslint-plugin-n';
import noOnlyTests from 'eslint-plugin-no-only-tests';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Local plugin with custom AST rules
import noSourceGrep from './eslint-rules/no-source-grep.cjs';
import noMagicSleepInTests from './eslint-rules/no-magic-sleep-in-tests.cjs';
import noElapsedAssertion from './eslint-rules/no-elapsed-assertion.cjs';
import noRawRmsyncInTests from './eslint-rules/no-raw-rmsync-in-tests.cjs';
import noTautologicalAssert from './eslint-rules/no-tautological-assert.cjs';
import noAdhocMarkdownParsing from './eslint-rules/no-adhoc-markdown-parsing.cjs';

const localPlugin = {
  rules: {
    'no-source-grep': noSourceGrep,
    'no-magic-sleep-in-tests': noMagicSleepInTests,
    'no-elapsed-assertion': noElapsedAssertion,
    'no-raw-rmsync-in-tests': noRawRmsyncInTests,
    'no-tautological-assert': noTautologicalAssert,
    'no-adhoc-markdown-parsing': noAdhocMarkdownParsing,
  },
};

export default tseslint.config(
  // ── Global ignores ─────────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '.worktrees/**',
      '.claude/**',
      'coverage/**',
      '**/*.generated.cjs',
      // ADR-457: tsc-generated runtime artifact — lint the src/*.cts source, not the emitted .cjs.
      'forge-core/bin/lib/semver-compare.cjs',
      'forge-core/bin/lib/capability-loader.cjs',
      'forge-core/bin/lib/capability-source.cjs',
      'forge-core/bin/lib/capability-ledger.cjs',
      'forge-core/bin/lib/capability-trust.cjs',
      'forge-core/bin/lib/capability-lifecycle.cjs',
      'forge-core/bin/lib/capability-consent.cjs',
      'forge-core/bin/lib/capability-lock.cjs',
      'forge-core/bin/lib/resolution.cjs',
      'forge-core/bin/lib/plan-drift-guard.cjs',
      'forge-core/bin/lib/cli-exit.cjs',
      'forge-core/bin/lib/edge-probe.cjs',
      'forge-core/bin/lib/probe-core.cjs',
      'forge-core/bin/lib/prohibition-enforcement.cjs',
      'forge-core/bin/lib/code-review-flags.cjs',
      'forge-core/bin/lib/context-utilization.cjs',
      'forge-core/bin/lib/artifacts.cjs',
      'forge-core/bin/lib/command-arg-projection.cjs',
      'forge-core/bin/lib/clock.cjs',
      'forge-core/bin/lib/ui-safety-gate.cjs',
      'forge-core/bin/lib/review-reviewer-selection.cjs',
      'forge-core/bin/lib/clusters.cjs',
      'forge-core/bin/lib/installer-migrations/001-legacy-orphan-files.cjs',
      'forge-core/bin/lib/observability/redaction.cjs',
      'forge-core/bin/lib/installer-migration-report.cjs',
      'forge-core/bin/lib/prompt-budget.cjs',
      'forge-core/bin/lib/secrets.cjs',
      'forge-core/bin/lib/phase-lifecycle.cjs',
      'forge-core/bin/lib/workstream-name-policy.cjs',
      'forge-core/bin/lib/decisions.cjs',
      'forge-core/bin/lib/validate.cjs',
      'forge-core/bin/lib/schema-detect.cjs',
      'forge-core/bin/lib/runtime-name-policy.cjs',
      'forge-core/bin/lib/runtime-slash.cjs',
      'forge-core/bin/lib/observability/event.cjs',
      'forge-core/bin/lib/workstream-inventory-builder.cjs',
      'forge-core/bin/lib/plan-scan.cjs',
      'forge-core/bin/lib/fallow-runner.cjs',
      'forge-core/bin/lib/project-root.cjs',
      'forge-core/bin/lib/installer-migration-authoring.cjs',
      'forge-core/bin/lib/update-context.cjs',
      'forge-core/bin/lib/installer-migrations/000-first-time-baseline.cjs',
      'forge-core/bin/lib/runtime-homes.cjs',
      'forge-core/bin/lib/model-catalog.cjs',
      'forge-core/bin/lib/configuration.cjs',
      'forge-core/bin/lib/state-document.cjs',
      'forge-core/bin/lib/shell-command-projection.cjs',
      'forge-core/bin/lib/security.cjs',
      'forge-core/bin/lib/command-aliases.cjs',
      'forge-core/bin/lib/config-schema.cjs',
      'forge-core/bin/lib/model-profiles.cjs',
      'forge-core/bin/lib/model-resolver.cjs',
      'forge-core/bin/lib/loop-resolver.cjs',
      'forge-core/bin/lib/capability-state.cjs',
      'forge-core/bin/lib/capability-activation.cjs',
      'forge-core/bin/lib/federated-config.cjs',
      'forge-core/bin/lib/installer-migrations/002-codex-legacy-hooks-json.cjs',
      'forge-core/bin/lib/installer-migrations/003-rename-get-shit-done-to-forge-core.cjs',
      'forge-core/bin/lib/installer-migrations/004-prune-stale-pristine-snapshots.cjs',
      'forge-core/bin/lib/observability/logger.cjs',
      'forge-core/bin/lib/active-workstream-store.cjs',
      'forge-core/bin/lib/adr-parser.cjs',
      'forge-core/bin/lib/graphify.cjs',
      'forge-core/bin/lib/graphify-command-router.cjs',
      'forge-core/bin/lib/audit-command-router.cjs',
      'forge-core/bin/lib/intel-command-router.cjs',
      'forge-core/bin/lib/install-profiles.cjs',
      'forge-core/bin/lib/intel.cjs',
      'forge-core/bin/lib/installer-migrations.cjs',
      'forge-core/bin/lib/worktree-safety.cjs',
      'forge-core/bin/lib/worktree-base-ref.cjs',
      'forge-core/bin/lib/planning-workspace.cjs',
      'forge-core/bin/lib/command-roster.cjs',
      'forge-core/bin/lib/runtime-artifact-conversion.cjs',
      'forge-core/bin/lib/runtime-artifact-install-plan.cjs',
      'forge-core/bin/lib/runtime-artifact-layout.cjs',
      'forge-core/bin/lib/runtime-config-adapter-registry.cjs',
      'forge-core/bin/lib/runtime-hooks-surface.cjs',
      'forge-core/bin/lib/command-routing-hub.cjs',
      'forge-core/bin/lib/core-utils.cjs',
      'forge-core/bin/lib/io.cjs',
      'forge-core/bin/lib/phase-id.cjs',
      'forge-core/bin/lib/config-loader.cjs',
      'forge-core/bin/lib/phase-locator.cjs',
      'forge-core/bin/lib/roadmap-parser.cjs',
      'forge-core/bin/lib/drift.cjs',
      'forge-core/bin/lib/cjs-command-router-adapter.cjs',
      'forge-core/bin/lib/phase-command-router.cjs',
      'forge-core/bin/lib/surface.cjs',
      'forge-core/bin/lib/roadmap-upgrade.cjs',
      'forge-core/bin/lib/config-types.cjs',
      'forge-core/bin/lib/phases-command-router.cjs',
      'forge-core/bin/lib/verify-command-router.cjs',
      'forge-core/bin/lib/verification.cjs',
      'forge-core/bin/lib/verification-command-router.cjs',
      'forge-core/bin/lib/init-command-router.cjs',
      'forge-core/bin/lib/agent-command-router.cjs',
      'forge-core/bin/lib/agent-install-check.cjs',
      'forge-core/bin/lib/task-command-router.cjs',
      'forge-core/bin/lib/validate-command-router.cjs',
      'forge-core/bin/lib/workstream-inventory.cjs',
      'forge-core/bin/lib/roadmap-command-router.cjs',
      'forge-core/bin/lib/state-command-router.cjs',
      'forge-core/bin/lib/gap-checker.cjs',
      'forge-core/bin/lib/config.cjs',
      'forge-core/bin/lib/profile-output.cjs',
      'forge-core/bin/lib/commands.cjs',
      'forge-core/bin/lib/state.cjs',
      'forge-core/bin/lib/milestone.cjs',
      'forge-core/bin/lib/phase.cjs',
      'forge-core/bin/lib/verify.cjs',
      'forge-core/bin/lib/init.cjs',
      'forge-core/bin/lib/docs.cjs',
      'forge-core/bin/lib/check-command-router.cjs',
      'forge-core/bin/lib/frontmatter.cjs',
      'forge-core/bin/lib/learnings.cjs',
      'forge-core/bin/lib/gsd2-import.cjs',
      'forge-core/bin/lib/profile-pipeline.cjs',
      'forge-core/bin/lib/template.cjs',
      'forge-core/bin/lib/uat.cjs',
      'forge-core/bin/lib/coverage.cjs',
      'forge-core/bin/lib/uat-predicate.cjs',
      'forge-core/bin/lib/workstream.cjs',
      'forge-core/bin/lib/roadmap.cjs',
      'forge-core/bin/lib/audit.cjs',
      'forge-core/bin/lib/research-store.cjs',
      'forge-core/bin/lib/research-provider.cjs',
      'forge-core/bin/lib/package-legitimacy.cjs',
      // ADR-457: tsc-generated runtime artifact — lint the src/git-base-branch.cts source.
      'forge-core/bin/lib/git-base-branch.cjs',
      // ADR-1213: tsc-generated runtime artifact — lint the src/capability-writer.cts source.
      'forge-core/bin/lib/capability-writer.cjs',
      // issue #1355: tsc-generated runtime artifact — lint the src/teams-status.cts source.
      'forge-core/bin/lib/teams-status.cjs',
      // ADR-1372: tsc-generated runtime artifact — lint the src/markdown-sectionizer.cts source.
      'forge-core/bin/lib/markdown-sectionizer.cjs',
    ],
  },

  // ── src/**/*.cts — TypeScript runtime sources (ADR-457 build-at-publish) ─────
  // First-class type-aware linting on the migrated source. The TS compiler
  // (`npm run build:lib`, strict + noEmitOnError) is the primary type gate;
  // these rules add lint-level coverage. warn-first per the harness convention.
  {
    files: ['src/**/*.cts'],
    plugins: {
      local: localPlugin,
    },
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.build.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // ADR-1372 T7: enforce use of the markdown-sectionizer seam; grandfather
      // pre-migration sites with // allow-adhoc-markdown: <reason>
      'local/no-adhoc-markdown-parsing': 'error',
    },
  },

  // ── forge-core/bin/**/*.cjs + scripts/**/*.cjs ───────────────────────────
  // CommonJS Node files: js.recommended + eslint-plugin-n + local plugin rules
  {
    files: ['forge-core/bin/**/*.cjs', 'scripts/**/*.cjs'],
    plugins: {
      n: pluginN,
      local: localPlugin,
    },
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Generic quality rules
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Downgraded from recommended error → warn (pre-existing violations; follow-up to fix)
      'no-useless-escape': 'warn',
      'no-unsafe-finally': 'warn',
      // eslint-plugin-n rules
      'n/no-process-exit': 'error',
      'n/no-path-concat': 'error',
      // Local rules — warn for now; flip to error after cleanup phases
      'local/no-source-grep': 'warn',
    },
  },

  // ── tests/**/*.test.cjs ─────────────────────────────────────────────────────
  {
    files: ['tests/**/*.test.cjs'],
    plugins: {
      'no-only-tests': noOnlyTests,
      local: localPlugin,
    },
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-only-tests/no-only-tests': 'error',
      // Timing anti-patterns — ratcheted to error after cleanup (all violations fixed)
      'local/no-magic-sleep-in-tests': 'error',
      'local/no-elapsed-assertion': 'warn',
      // Ban raw fs.rmSync in tests — use helpers.cleanup() for Windows-EBUSY retry budget
      'local/no-raw-rmsync-in-tests': 'error',
      // Ban tautological assertions (always-truthy arg or identical-literal equality)
      'local/no-tautological-assert': 'error',
      // Ban source-grep pattern in tests — use require() + behavior assertions instead
      'local/no-source-grep': 'error',
      // Ban raw setTimeout sync + elapsed/duration-style assertions via no-restricted-syntax
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AwaitExpression > NewExpression[callee.name="Promise"] ArrowFunctionExpression CallExpression[callee.name="setTimeout"]',
          message: 'Raw setTimeout used for synchronization in tests. Use proper async patterns instead.',
        },
        {
          selector: 'CallExpression[callee.object.name="Atomics"][callee.property.name="wait"]',
          message: 'Atomics.wait() used as a sleep in tests. Use a proper async wait pattern instead.',
        },
      ],
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Downgraded from recommended error → warn (pre-existing violations; follow-up to fix)
      'no-useless-escape': 'warn',
      'no-regex-spaces': 'warn',
      'no-control-regex': 'error',
      'no-irregular-whitespace': 'warn',
    },
  },

  // ── #1279 lint-rule fail-first fixture ──────────────────────────────────────
  // `tests/_ff_lint_violation.cjs` is a PLAIN `.cjs` (NOT `*.test.cjs`) on purpose: it is a KNOWN
  // `local/no-source-grep` violation that `defaultProveFailFirst` lints to machine-prove the rule
  // has teeth, and it must stay OFF the `node --test` runner glob (executing it ENOENTs on the
  // intentional `lib/foo.cjs` path). It still needs the `local` plugin registered so its inline
  // `/* eslint-disable local/no-source-grep */` resolves (otherwise `eslint .` errors "rule not
  // found") and the violation lands in `suppressedMessages` (which the prover reads), keeping the
  // project's own `eslint .` green. (#1279)
  {
    files: ['tests/_ff_lint_violation.cjs'],
    plugins: { local: localPlugin },
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'local/no-source-grep': 'error' },
  },
);
