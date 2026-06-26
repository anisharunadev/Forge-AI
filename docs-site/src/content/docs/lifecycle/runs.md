---
draft: false
title: Runs
description: Live and historical GSD runs — phase status, timing, approvers, and linked artifacts.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import FeatureCard from '../../../components/FeatureCard.astro';
import FeatureGrid from '../../../components/FeatureGrid.astro';

A **Run** is one execution of a GSD pipeline or a workflow. The Runs center is the
live + historical view: status per phase, timing, approvers, linked artifacts, and
the full event log.

<Callout type="info" title="Per Rule 6">
  Every run is recorded in the audit ledger with full lineage — input, output,
  approvers, cost, and timing.
</Callout>

## Run lifecycle

<FeatureGrid cols={3}>
  <FeatureCard icon="rocket" color="indigo" title="Queued"
    description="Run accepted, waiting for capacity or upstream gate." />
  <FeatureCard icon="zap" color="cyan" title="Active"
    description="Currently in a phase. Phase name + elapsed time shown." />
  <FeatureCard icon="shieldcheck" color="rose" title="HITL paused"
    description="Paused at an approval gate. Approver shown." />
  <FeatureCard icon="checkcircle" color="emerald" title="Succeeded"
    description="All phases passed. Artifacts linked. Deploy may be in flight." />
  <FeatureCard icon="alerttri" color="amber" title="Failed"
    description="A phase failed. Re-run from the failed phase, not from scratch." />
  <FeatureCard icon="x" color="rose" title="Cancelled"
    description="Cancelled by user or by policy. Reason recorded." />
</FeatureGrid>

## Run detail view

Click any run to see:

- **Phase strip** — Spike → Plan → Execute → Verify → Validate → Audit → Deploy.
- **Per-phase timing** — bar chart of phase durations vs. median.
- **HITL approvals** — who approved what, when, with what comment.
- **Linked artifacts** — ADRs, contracts, risk registers produced.
- **Cost ticker** — LiteLLM spend so far on this run.
- **Live log** — streaming events for active runs.

## Re-running

Failed runs can be re-run from the failed phase, not from scratch:

<Callout type="tip" title="Idempotent re-runs">
  Re-running uses cached outputs from prior phases. No double-spending on
  LiteLLM, no duplicate artifact writes.
</Callout>

## Where to next

- [Lifecycle → Command Center](/lifecycle/command-center/) — start a new run.
- [Lifecycle → Audit](/lifecycle/audit/) — full event timeline.
- [Concepts → Typed Artifacts](/concepts/typed-artifacts/) — what runs produce.
