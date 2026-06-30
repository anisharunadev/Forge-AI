# packages/forge-browser — Visual Automation

Powers **Rule 11** features: visual regression testing on PR diffs, post-deploy
smoke testing, UAT automation, WCAG accessibility audits, the QA Agent, and
the Canary Agent.

If a UI feature claims to take screenshots, compare pixels, or run a11y
checks, it MUST delegate to `forge-browser`. Never reimplement these in
`apps/forge`.

**Layout:** `agents/` · `capabilities/` · `commands/` ·
`forge-browser.catalog.json` (registry the UI reads).