# M11 — Audit Note

**Milestone:** M11 — Agent Terminal Center
**Branch:** `feat/M11-agent-terminal`
**Merge commit:** `146aae93` on `main`
**Integration report:** [`M11-INTEGRATION-REPORT.md`](./M11-INTEGRATION-REPORT.md)

This is a **back-merge audit-trail PR**. The full milestone already merged to `main` at `146aae93`. This PR is opened so the work appears in the GitHub PR history for traceability.

## What this milestone shipped

- **24 NEW backend pytest cases** in `backend/tests/test_terminal_multi_agent.py` locking the multi-agent surface (AgentType enum, `_AGENT_BINARY` dispatch, `detect_agent` heuristics, `TerminalSession` isolation by `agent_type`, `AgentLaunchError` paths).
- **3 NEW Playwright cases** in `apps/forge/tests/e2e/15-agent-terminal.spec.ts` locking the live UI (AgentSelector exposes 4 CLI agent families; SessionTabs supports concurrent multi-agent sessions; Agent Center card grid backs the terminal selector).
- **Integration report** at `M11-INTEGRATION-REPORT.md` (172 lines): 5/5 gaps closed, 5/5 ACs pass, test count ledger, M12 follow-ups.

## AC verdict

| AC | Verdict |
|---|---|
| AC1.1 No `node-pty` import in `apps/forge` | ✅ |
| AC2.* WS auth + tenant scoping | ✅ |
| AC3.* Replay endpoint | ✅ |
| AC4.1 Multi-agent session isolation | ✅ |
| AC4.2 Cost attribution per `(session_id, agent_type)` | ✅ |
| AC4.3 `AgentLaunchError` on missing workspace | ✅ |
| AC5.1 NEW pytest ≥4 cases | ✅ (24) |
| AC5.2 NEW Playwright ≥3 cases | ✅ (3) |
| AC5.3 Both run under existing configs | ✅ |

**5/5 gaps closed. 5/5 ACs pass.**

## Net new tests this milestone

- backend pytest: **+24 cases**
- Playwright: **+3 cases**
- **Total: +27 net new tests**

## Out-of-scope (M12 Production Hardening)

- Migrate `TerminalSessionManager` from in-memory to Redis-backed
- Replace `packages/forge-terminal-server` sidecar with real `apps/orchestrator/`
- Tenant-scoped cost caps per `agent_type`
- WebSocket reconnection with state resync

See parent spec §5 M12.