# Changelog

All notable changes to `@forge-ai/forge-browser` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-27 — Initial release under Forge AI

### Added
- Initial release as `@forge-ai/forge-browser` — Forge Browser.
- `visualTest()` — pixel-diff visual regression test runner.
- `uiReview()` — AI-driven UI review with screenshot diffing and notes.
- `deployVerify()` — post-deploy smoke check (canary screenshot + asset reachability).
- `journey()` — multi-step user-journey recorder.
- `a11yAudit()` — automated WCAG 2.2 AA accessibility audit.
- Skill manifest (`forge-browser.catalog.json`) consumed by the Forge Command Center.
- Six skills (`forge-browser-visual-test`, `forge-browser-ui-review`, `forge-browser-screenshot`, `forge-browser-deploy-verify`, `forge-browser-journey`, `forge-browser-a11y-audit`) and two agent definitions (`qa-agent`, `canary-agent`).
- All operations are tenant-scoped — each artifact carries `tenant_id` and `project_id` (Forge Rule 2).

### Changed
- Package renamed from the v1.x upstream `forge-browser` to the Forge AI `@forge-ai/forge-browser` scope.
- Re-scoped to the Forge Agent OS — visual testing is now part of the Verify, UAT, and Deploy flows.
