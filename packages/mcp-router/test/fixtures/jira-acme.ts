/**
 * `forge-ai/mcp-router` — acceptance harness fixture: `createJiraManifest('acme')`.
 *
 * Thin re-export of the FORA-449 manifest factory so the router acceptance
 * harness exercises the SAME ServerManifest that ships in `forge-ai/mcp-jira`
 * 0.3.6 (commit `da1b51ef`). Mirrors the symmetry of `packages/mcp-router/test/fixtures/scope-guard/*`
 * (FORA-448): one file per fixture, used by `test/acceptance.test.ts`.
 *
 * Why relative import (not `forge-ai/mcp-jira`):
 *   - `forge-ai/mcp-jira` declares `forge-ai/mcp-router` as a runtime dep (workspace).
 *     Adding the reverse workspace dep would be a package-graph cycle and would
 *     require a `pnpm install` for every consumer — too high a cost for a
 *     re-export.
 *   - The compiled `dist/manifest.js` exists on disk (built by the FORA-449
 *     commit). Importing it directly keeps the test self-contained without
 *     forcing the router package to know about its sibling at the dep level.
 *
 * Cross-link: `mcp-servers/jira/src/manifest.ts` (source) and the FORA-449
 * router-port smoke `mcp-servers/jira/test/router-smoke.test.ts`.
 *
 * FORA-450 (acceptance harness).
 */

export {
  createJiraManifest,
  JIRA_SERVER_NAME,
} from '../../../../mcp-servers/jira/dist/manifest.js';
