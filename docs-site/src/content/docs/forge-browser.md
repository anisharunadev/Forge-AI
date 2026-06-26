---
title: "forge-browser — Forge Browser"
description: "AI browser automation for visual testing, UI review, accessibility audits, and deployment verification."
---

# `@forge-ai/forge-browser` — Forge Browser

`forge-browser` is the **visual automation layer** of the Forge AI Agent OS.
The moment an AI agent can open a browser, take screenshots, and review UI
changes automatically, the Verify phase becomes truly automated.

## Capabilities

| Function | Returns |
|---|---|
| `openBrowser(ctx, options)` | `BrowserSession` |
| `captureScreenshot(ctx, url)` | `Screenshot` |
| `compareScreenshots(ctx, baseline, candidate)` | `VisualDiff` |
| `runVisualTest(ctx, options)` | `VisualDiff` |
| `reviewUI(ctx, url)` | `UiReviewReport` (multi-viewport) |
| `runJourney(ctx, steps)` | `JourneyResult` |
| `verifyDeploy(ctx, options)` | `DeployVerifyResult` |
| `auditAccessibility(ctx, options)` | `A11yAudit` (WCAG A / AA / AAA) |

Every entry point carries `tenant_id` and `project_id` — **Forge Rule 2**.

## Where it lives in the app

- **Verify phase** — visual regression tests on PRs
- **`forge-audit-uat`** — visual UAT mode
- **Stories (PR linked)** — "Run QA Agent" button
- **Deploy workflow** — Canary Agent visual diff (pre vs post)
- **Architecture Center** — visual review of generated diagrams

## Optional by design

`forge-browser` is optional and **independent** of `forge-pi`. Either can be
installed or omitted independently. When missing, every consumer falls back
to manual review.

## See also

- [3-Package Spec-Driven Stack](/forge/architecture/three-package-stack/)
- [`packages/forge-browser`](/forge/packages/forge-browser/) — source package