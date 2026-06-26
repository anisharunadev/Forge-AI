---
draft: false
title: Terminal
description: Browser-native PTY — run Claude Code, Codex, or any CLI tool in a tab. Every byte is audited.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

The **Terminal** center is a browser-native PTY. Run Claude Code, Codex, any CLI
tool — every byte in and out is captured, audited, and replayable. Per
[ADR-006](/architecture/adr-006-terminal-pty/).

<Callout type="info" title="Per Rule 6 + Rule 7">
  All agent activity must be auditable and observable. The terminal is no exception —
  every keystroke is recorded.
</Callout>

## Features

<FeatureGrid cols={3}>
  <FeatureCard icon="terminal" color="indigo" title="Native PTY"
    description="Real PTY, not a fake shell. ANSI escape codes render correctly." />
  <FeatureCard icon="history" color="cyan" title="Full replay"
    description="Every session is replayable byte-for-byte. Forward, backward, jump to timestamp." />
  <FeatureCard icon="shieldcheck" color="rose" title="Audited"
    description="Every command, every output, every byte — written to the audit ledger." />
  <FeatureCard icon="zap" color="amber" title="Multi-tab"
    description="Open multiple terminals in tabs. Each tab is its own session." />
  <FeatureCard icon="users" color="violet" title="Shareable"
    description="Pair-program with another user. They see your terminal live." />
  <FeatureCard icon="gitbranch" color="emerald" title="Forge-aware"
    description="Run forge-* commands directly. Output is parsed and structured." />
</FeatureGrid>

## Running a CLI tool

```bash
# In the terminal
claude-code --model claude-sonnet-4-6 --project acme/platform-mono
```

The terminal detects the tool, surfaces the model and project as context, and
auto-logs the session.

<Callout type="warning" title="Spend cap warning">
  Long-running CLI tools can exhaust your daily spend cap. The terminal shows a
  live cost ticker.
</Callout>

## Where to next

- [ADR-006 — Terminal PTY](/architecture/adr-006-terminal-pty/) — design rationale.
- [Concepts → Auditability](/concepts/auditability/) — what's captured.
- [Concepts → Observability](/concepts/observability/) — traces, metrics, logs.
