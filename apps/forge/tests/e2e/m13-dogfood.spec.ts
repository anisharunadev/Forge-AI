/**
 * M13 — Dogfood Validation Playwright spec.
 *
 * Walks the pilot user through all 9 M3-M11 centers on the `acme-corp`
 * seed tenant. Captures per-step timing + a screenshot at the end of
 * each step. Total budget: <30 minutes (parent spec §3.2.1).
 *
 * Replaces + extends the legacy `full_smoke.spec.ts` (Phase 8 SC-8.1
 * happy-path). The legacy spec is kept around for the CI gate but is
 * no longer the canonical dogfood script.
 *
 * Usage:
 *   cd apps/forge && pnpm playwright test m13-dogfood.spec.ts --reporter=line
 *
 * Output:
 *   test-results/m13-dogfood/<NN>-<center>-<step>.png     — screenshots
 *   test-results/m13-dogfood/timings.json                 — step timings
 *   M13-DOGFOOD-REPORT.md                                  — manual sign-off doc
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

// ---------------------------------------------------------------------------
// 9-center dogfood matrix
// ---------------------------------------------------------------------------

interface CenterSpec {
  /** 1-based index for ordering + filename prefix. */
  n: number;
  /** Center slug used in the URL. */
  slug: string;
  /** Display label (matches parent spec §3.2.x). */
  label: string;
  /** Parent spec section reference. */
  specRef: string;
  /** testid on the first-paint anchor (asserts the page mounted). */
  firstPaintTestId: string;
  /** Optional deep-link click sequence (mimics a pilot user's first action). */
  deepLinkClicks?: ReadonlyArray<{ testid: string; description: string }>;
  /** Screenshot label suffix. */
  screenshotLabel: string;
  /** Parent-spec AC bullet(s) — surfaced in the report. */
  parentAcBullets: ReadonlyArray<string>;
}

const CENTERS: ReadonlyArray<CenterSpec> = [
  {
    n: 1,
    slug: 'onboarding',
    label: 'Onboarding Wizard',
    specRef: '§3.2.1',
    firstPaintTestId: 'onboarding-tenant-name',
    deepLinkClicks: [
      { testid: 'onboarding-tour-next', description: 'advance tour' },
    ],
    screenshotLabel: '01-onboarding-wizard',
    parentAcBullets: [
      'Single wizard at /project-onboarding; 10 UI components + 6 backend steps',
      'Tenant + project + connector + LLM provider end-to-end via real backend',
      'Day-One Bootstrap emits a BootstrapReport typed artifact',
      'Resumable across sessions; ends with a tour',
      'Completes in <30 minutes for an internal pilot user',
    ],
  },
  {
    n: 2,
    slug: 'connector-center',
    label: 'Connector Center',
    specRef: '§3.2.2',
    firstPaintTestId: 'connectors-page',
    deepLinkClicks: [
      { testid: 'connector-row', description: 'open first connector detail' },
    ],
    screenshotLabel: '02-connector-center',
    parentAcBullets: [
      '7 tabs (Overview, Connected, Marketplace, Credentials, Activity, Health, Webhooks) on real backend',
      'Step 55 zones 4-9 closed: install, disconnect, test, rotate, reveal, sync',
      'Activity polls /api/v1/connectors/activity every 10s',
      'Mock CONNECTORS array kept only as offline fallback with explicit banner',
    ],
  },
  {
    n: 3,
    slug: 'ideation',
    label: 'Ideation',
    specRef: '§3.2.3',
    firstPaintTestId: 'ideation-center-page',
    deepLinkClicks: [
      { testid: 'idea-card', description: 'open first idea' },
      { testid: 'prd-draft-button', description: 'trigger PRD draft' },
    ],
    screenshotLabel: '03-ideation',
    parentAcBullets: [
      '9 tabs render real data; no MOCK_FALLBACK paths',
      'Idea ingest from sources calls real puller services',
      'Idea scoring + impact comparison + roadmap on real endpoints',
      'PRD generator emits typed PRD artifact, lands on KG as node',
      'Push to Jira hits real connector with idempotency',
    ],
  },
  {
    n: 4,
    slug: 'architecture',
    label: 'Architecture',
    specRef: '§3.2.4',
    firstPaintTestId: 'architecture-page',
    deepLinkClicks: [
      { testid: 'adr-card', description: 'open first ADR' },
    ],
    screenshotLabel: '04-architecture',
    parentAcBullets: [
      '9 tabs render real data; ADR generation emits typed ADR artifact',
      'API Contract generator emits typed API Contract artifact',
      'Risk Register tracks per-ADR risks; Security Report covers deployment risks',
      'Architecture gate enforced — BLOCKED_APPROVAL if no recorded decision',
    ],
  },
  {
    n: 5,
    slug: 'runs',
    label: 'Runs',
    specRef: '§3.2.5',
    firstPaintTestId: 'runs-page',
    screenshotLabel: '05-runs',
    parentAcBullets: [
      'Live + replay run center; Kanban with status triggers',
      'RunBudgetBadge shows ceiling / spent / remaining before run start',
      'Cost cap (run_budget_cap_usd) enforced; CostCapExceeded raised if exceeded',
      'Approval timeout fires; "Stale approval" badge shown',
    ],
  },
  {
    n: 6,
    slug: 'audit',
    label: 'Audit',
    specRef: '§3.2.6',
    firstPaintTestId: 'audit-page',
    screenshotLabel: '06-audit',
    parentAcBullets: [
      'Audit Timeline shows {agent, model, prompt, tool, cost, artifact, timestamp, result} per event',
      'Virtualized rendering handles >1000 events smoothly',
      'Filterable by tenant, project, actor, artifact type, date range',
      'WORM append-only chain verifiable; daily hash chain exposed',
    ],
  },
  {
    n: 7,
    slug: 'knowledge-center',
    label: 'Knowledge Center (KG)',
    specRef: '§3.2.7',
    firstPaintTestId: 'knowledge-center-page',
    deepLinkClicks: [
      { testid: 'kg-typed-graph', description: 'open the typed graph view' },
    ],
    screenshotLabel: '07-knowledge-center',
    parentAcBullets: [
      'React Flow viz with 5 typed nodes',
      'Status-colored by tone (kgStateTone passthrough)',
      'Bidirectional backlinks via useBacklinks hook',
      'Vector + graph search returns real nodes',
    ],
  },
  {
    n: 8,
    slug: 'copilot',
    label: 'Co-pilot',
    specRef: '§3.2.8',
    firstPaintTestId: 'copilot-panel',
    deepLinkClicks: [
      { testid: 'copilot-suggested-prompt', description: 'click first suggested prompt' },
    ],
    screenshotLabel: '08-copilot',
    parentAcBullets: [
      'Streaming chat (typing_indicator column)',
      'Rate limit (ForgeApiError with rate-limit code → toast)',
      'Guardrail denial (ForgeApiError with guardrail_denied → toast)',
      'Lesson citations (LessonCitationChip)',
    ],
  },
  {
    n: 9,
    slug: 'agent-center',
    label: 'Agent Center',
    specRef: '§3.2.9',
    firstPaintTestId: 'agent-center-page',
    deepLinkClicks: [
      { testid: 'agent-card', description: 'open first agent card' },
    ],
    screenshotLabel: '09-agent-center',
    parentAcBullets: [
      'Agent selector lists all 4 CLI agent families (Claude Code / Codex / Gemini CLI / Custom)',
      'Multi-agent session tabs (SessionTabs supports concurrent)',
      'Replay via terminal/exporter.py HTML+JSON frames',
      'No direct node-pty import in apps/forge (browser bundle stays pure JS)',
    ],
  },
];

// ---------------------------------------------------------------------------
// Output paths
// ---------------------------------------------------------------------------

const RESULTS_DIR = 'test-results/m13-dogfood';
const TIMINGS_PATH = join(RESULTS_DIR, 'timings.json');

interface StepTiming {
  center: string;
  slug: string;
  specRef: string;
  startMs: number;
  endMs: number;
  durationS: number;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  screenshot: string;
}

const allTimings: StepTiming[] = [];

// ---------------------------------------------------------------------------
// 9-center serial walk
// ---------------------------------------------------------------------------

test.describe.serial('M13 — 9-center dogfood walk', () => {
  // 30-min budget per parent spec §3.2.1.
  test.setTimeout(1_800_000);

  test.beforeAll(() => {
    mkdirSync(RESULTS_DIR, { recursive: true });
  });

  test.afterAll(() => {
    // Persist step timings to disk for the M13 dogfood report.
    writeFileSync(TIMINGS_PATH, JSON.stringify(allTimings, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[M13] Wrote ${allTimings.length} timings to ${TIMINGS_PATH}`);
  });

  for (const center of CENTERS) {
    test(`step ${String(center.n).padStart(2, '0')}: ${center.label} (${center.slug})`, async ({
      page,
    }) => {
      const startMs = Date.now();
      const stepName = `${String(center.n).padStart(2, '0')}-${center.screenshotLabel}`;
      const screenshotPath = join(RESULTS_DIR, `${stepName}.png`);
      const timing: StepTiming = {
        center: center.label,
        slug: center.slug,
        specRef: center.specRef,
        startMs,
        endMs: 0,
        durationS: 0,
        status: 'failed',
        screenshot: screenshotPath,
      };

      try {
        // 1. Navigate to the center.
        await navigateTo(page, `/${center.slug}`);

        // 2. Assert the first-paint testid is visible (page mounted).
        await expect(
          page.getByTestId(center.firstPaintTestId).first(),
        ).toBeVisible({ timeout: 30_000 });

        // 3. Optional deep-link click sequence (mimics pilot first action).
        for (const click of center.deepLinkClicks ?? []) {
          const el = page.getByTestId(click.testid).first();
          if (await el.isVisible().catch(() => false)) {
            await el.click({ timeout: 5_000 });
            // Brief settle so the screenshot captures the post-click state.
            await page.waitForTimeout(500);
          }
        }

        // 4. Capture screenshot.
        await page.screenshot({ path: screenshotPath, fullPage: true });

        timing.status = 'passed';
      } catch (err) {
        timing.error = err instanceof Error ? err.message : String(err);
        // Capture a failure screenshot for triage.
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {
          /* swallow screenshot error */
        });
      } finally {
        timing.endMs = Date.now();
        timing.durationS = Math.round((timing.endMs - timing.startMs) / 1000);
        allTimings.push(timing);
      }

      expect(timing.status, timing.error).toBe('passed');
    });
  }
});

// ---------------------------------------------------------------------------
// Meta guards
// ---------------------------------------------------------------------------

test.describe('M13 dogfood meta', () => {
  test('all 9 centers are covered', () => {
    // Guard against silently dropping a center from the iteration list.
    expect(CENTERS.length).toBe(9);
  });

  test('all centers have unique slugs', () => {
    const slugs = CENTERS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('all centers have a valid firstPaintTestId', () => {
    for (const c of CENTERS) {
      expect(c.firstPaintTestId).toMatch(/^[a-z0-9-]+$/);
      expect(c.firstPaintTestId.length).toBeGreaterThan(0);
    }
  });

  test('all centers reference a parent spec section', () => {
    for (const c of CENTERS) {
      expect(c.specRef).toMatch(/^§3\.2\.\d+$/);
    }
  });
});