# M8 back-merge audit note

The M8 milestone material landed on `origin/main` via direct merge at `d0b05bc1`.
This back-merge PR exists so the audit trail lands in GitHub's PR history
alongside M1..M7 audit PRs.

## What was merged

- 11 substantive M8 commits on the work branch (`feat/M8-knowledge-center`)
- 1 ruff-cleanup T-A6 commit (`e42b6b79`) reducing pre-existing lint baseline by 2
- 0 net regressions

## See `M8-INTEGRATION-REPORT.md` on the branch for the full per-AC verdict audit.

The integration report was authored by the project owner after Track A
(backend) and Track B (frontend) each shipped their deliverables (both
ended in VERDICT: PASS), and after Track C was owner-pickup'd for the
Playwright 13-kg-typed-graph.spec.ts.
