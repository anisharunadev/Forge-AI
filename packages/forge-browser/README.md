# `@forge-ai/forge-browser`

> **Forge Browser** — the visual automation layer of the Forge AI Agent OS.

> _Based on the open-gsd spec-driven methodology, branded and extended for the Forge AI platform._

---

## What it does

`@forge-ai/forge-browser` gives every Forge agent the ability to open a real
browser, navigate a deployed app, capture screenshots, diff them against a
baseline, audit accessibility (WCAG 2.2 AA), and run a multi-step user
journey as part of UAT. The moment an AI agent can review UI changes
automatically, the Verify phase becomes truly automated.

It powers four critical Forge surfaces:

- **Verify phase** — visual regression tests on every PR
- **Deploy workflow** — post-deploy canary screenshots vs. pre-deploy baseline
- **Audit / UAT** — agent-driven user-journey recording + accessibility audits
- **Architecture Center** — design-quality responsive checks on preview deploys

Every entry point is async and returns typed artifacts carrying `tenant_id`
and `project_id` (Forge Rule 2 — Multi-Tenancy by Default).

The package is **optional by design**: when not installed, every consumer
falls back to manual review. `forge-browser` is independent of `forge-pi` —
each can be installed and used separately.

---

## Skills included

| Skill | One-liner |
|---|---|
| `forge-browser-visual-test` | Pixel-diff visual regression test against an existing baseline. |
| `forge-browser-ui-review` | AI-driven UI review — flags responsive / accessibility / layout regressions. |
| `forge-browser-screenshot` | Capture a full-page screenshot at a viewport for diffing or archival. |
| `forge-browser-deploy-verify` | Post-deploy smoke check — screenshot + asset reachability. |
| `forge-browser-journey` | Multi-step user-journey recorder — clicks through flows, screenshots each step. |
| `forge-browser-a11y-audit` | Automated WCAG 2.2 AA accessibility audit, returns typed `A11yReport`. |

---

## Agents included

| Agent | Description |
|---|---|
| `qa-agent` | AI QA — opens preview, navigates changed screens, takes screenshots, compares to baseline. Output: visual diff report + accessibility check. |
| `canary-agent` | AI canary watcher — opens the production URL post-deploy, screenshots, compares to pre-deploy, alerts on visual regressions. |

---

## Commands included

| Command | Surface |
|---|---|
| `forge:browser-visual-test` | Slash-style entry point to `forge-browser-visual-test`. |
| `forge:browser-ui-review` | Slash-style entry point to `forge-browser-ui-review`. |
| `forge:browser-screenshot` | Slash-style entry point to `forge-browser-screenshot`. |
| `forge:browser-deploy-verify` | Slash-style entry point to `forge-browser-deploy-verify`. |
| `forge:browser-journey` | Slash-style entry point to `forge-browser-journey`. |
| `forge:browser-a11y-audit` | Slash-style entry point to `forge-browser-a11y-audit`. |

---

## Usage

```ts
import {
  openBrowser,
  captureScreenshot,
  compareScreenshots,
  auditAccessibility,
  runJourney,
} from '@forge-ai/forge-browser';
import type { TenantContext, Screenshot } from '@forge-ai/forge-browser';

const ctx: TenantContext = { tenantId: 'acme', projectId: 'forge' };

// 1. Open a browser (Playwright under the hood)
const browser = await openBrowser({ ctx, headless: true });

// 2. Capture a baseline screenshot
const baseline: Screenshot = await captureScreenshot({
  ctx,
  browser,
  url: 'https://preview.forge.dev/dashboard',
  viewport: { width: 1440, height: 900 },
});

// 3. Capture an "after" screenshot
const after: Screenshot = await captureScreenshot({
  ctx,
  browser,
  url: 'https://preview.forge.dev/dashboard?build=new',
  viewport: { width: 1440, height: 900 },
});

// 4. Pixel-diff them
const diff = await compareScreenshots({ ctx, baseline, after });

// 5. Run an accessibility audit
const a11y = await auditAccessibility({ ctx, browser, url: 'https://preview.forge.dev/dashboard' });

// 6. Record a user journey end-to-end
const journey = await runJourney({
  ctx,
  browser,
  steps: [
    { action: 'goto', url: 'https://preview.forge.dev/login' },
    { action: 'fill', selector: '[name=email]', value: 'pm@acme.dev' },
    { action: 'fill', selector: '[name=password]', value: '***' },
    { action: 'click', selector: 'button[type=submit]' },
    { action: 'screenshot', name: 'after-login' },
  ],
});
```

Each step is auditable — screenshots, diffs, and audit reports are stored
under the audit timeline and replayable from `apps/forge/audit`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       Forge UI (apps/forge)              │
│   Verify · Deploy · UAT · Code Review · Architecture      │
└──────────┬──────────────────┬────────────────────────────┘
           │                  │
           ▼                  ▼
┌─────────────────┐   ┌─────────────────────┐
│  forge-pi       │   │   forge-browser     │
│  (intelligence) │   │   (visual verify)   │
└────────┬────────┘   └──────────┬──────────┘
         │                       │
         └─────────┬─────────────┘
                   ▼
        ┌─────────────────────────┐
        │   forge-core            │
        │   (spec + skills)       │
        └─────────────────────────┘
```

`forge-browser` depends on `@forge-ai/forge-core` for shared types
(`TenantContext`, `Artifact`, etc.). It is independent of
`@forge-ai/forge-pi` — install either, both, or neither.

---

## Skill manifest

`forge-browser.catalog.json` is the source-of-truth manifest consumed by the
Forge Command Center (`apps/forge/lib/forge-commands-catalog.ts`) to render
the "Browser automation" category in the skill picker.

Each entry carries `package: "forge-browser"` metadata so the UI can group
skills by origin package, and the matching icon (`lucide Globe`) + color
(cyan) is applied automatically.

---

## License

UNLICENSED — Forge AI internal package.
