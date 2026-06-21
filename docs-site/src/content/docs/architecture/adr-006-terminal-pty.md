---
title: ADR-006 — Terminal Center with native PTY
description: Agents run in a native PTY streamed to the browser via xterm.js. Every byte is audited.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that the Terminal Center uses **xterm.js + native PTY** to stream agent CLIs (Claude Code, Codex, Gemini, and other dev tools) into the browser. Every byte is audited.

## Context

Several `forge-*` workflows (development, testing, hotfix, migration) need to invoke a real CLI tool that runs locally: an agent CLI for code generation, a test runner for validation, a migration tool for schema changes. The question is: how do we run that CLI in a way that's auditable, isolated, and streamable to the browser?

The forces at play:

- The browser-based Command Center is the primary UI; users should not have to SSH into a separate box.
- The CLI may produce sensitive output (secrets in traceback, PII in test data). Every byte must be audited.
- The CLI must run with workspace isolation — never on the host filesystem.
- A native PTY preserves terminal semantics (colors, control sequences) that pure HTTP streaming breaks.

## Decision drivers

- NFR-039: Audit every byte streamed to the browser
- DL-024: White-label the CLI invocation
- F-019: Forge Command Map
- Workspace isolation per session

## Considered options

- xterm.js + native PTY — **chosen**
- HTML-based pseudo-terminal
- HTTP-based streaming with a custom protocol
- Client-side execution (browser-side agent)

## Decision outcome

Chosen option: **xterm.js + native PTY**.

| Layer | Tech |
|---|---|
| Frontend | xterm.js + xterm-addon-fit |
| Transport | WebSocket |
| Backend | FastAPI WebSocket handler |
| Process | `pty.openpty()` → child process |
| Workspace | Per-session temporary directory |

The orchestrator spawns a child process with `pty.openpty()`, attaches the PTY master to a WebSocket, and renders it in the browser via xterm.js.

## Workspace isolation

Each terminal session gets its own temporary directory:

```text
/tmp/forge/<tenant>/<project>/<session-id>/
```

The PTY's cwd is this directory. The child process cannot `cd` outside (the chroot or container enforces it). Network access is restricted to the project's whitelisted endpoints.

## Audit

Every byte read from the PTY master is appended to the audit ledger with:

```text
audit_row:
  forge_command: forge-dev-implement
  session_id:    sess-001
  direction:     stdout | stderr
  byte_offset:   12345
  byte_count:    1024
  content_hash:  sha256(bytes)
  ts:            2026-06-21T14:32:11Z
```

The full byte stream can be reconstructed from the audit log for forensic review.

## Process lifecycle

```text
+-----------------------------+
| Orchestrator spawns session |
+-----------------------------+
            |
            v
+-----------------------------+
| Create workspace dir        |
| Mount project repo (RO)     |
| Open PTY                    |
| Spawn child process         |
| Open WebSocket              |
+-----------------------------+
            |
            v
+-----------------------------+
| Stream bytes (PTY -> WS)   |
| Audit each chunk            |
+-----------------------------+
            |
            v
+-----------------------------+
| User ends session           |
| Close PTY                   |
| Archive workspace           |
| Tear down WS                |
+-----------------------------+
```

## White-labeling

The user's UI shows `forge-dev-implement`. The actual CLI invocation may be `claude-code`, `codex`, or another tool — the wrapper invokes it with a forged prompt. The PTY shows only the user-facing labels; the underlying CLI is in the audit log's internal column.

## Consequences

**Positive:**

- Browser-based UI; no separate SSH.
- Native terminal semantics preserved.
- Every byte audited.
- Workspace isolation enforced at the OS level.
- White-label consistent with the rest of the platform.

**Negative:**

- The PTY is a single point of resource pressure; needs to be sized per session.
- Byte-level audit is high-volume; retention policy matters.

**Neutral:**

- xterm.js is the de facto standard; no alternative considered seriously.

## Alternatives considered

### HTML-based pseudo-terminal

Pros: Simpler.

Cons: Loses terminal semantics; colors and progress bars break; less authentic for developers.

### HTTP-based streaming

Pros: Simpler transport.

Cons: Same semantics loss; no native flow control.

### Client-side execution

Pros: Zero server cost.

Cons: Cannot enforce workspace isolation; cannot audit; violates NFR-039.

## Related

- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
- [Architecture overview](/architecture/overview/)
- [Components](/architecture/components/)
