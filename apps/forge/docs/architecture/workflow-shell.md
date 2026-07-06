# Workflow shell — architecture

## Why

The audit (M14 audit report, §11 user journey gaps) repeatedly flagged the
legacy home page as the reason new users could not orient themselves: nine
centers, no thread, no obvious "what do I do first?".

M16 (Sprint 1 revised) collapses the nine centers into a single golden
workflow:

```
Idea → PRD → Architecture → Tasks → Approval → Develop → PR
```

Every page on Forge AI supports this workflow. The home page is the
workflow, not a grid.

## What it does

- `WorkflowProgressBar` — the spine. Renders all seven stages as chips with
  connecting lines. Lives at the top of `/workflow/*` and on the home page.
- `ContinueCard` — the primary CTA. Tells the user what the next step is
  and deep-links to the underlying center.
- `StartProjectCard` — secondary CTA. Surfaces "Start from Idea" for
  first-run users.
- `RecentActivityCard` — light activity feed so the user sees context.
- `WorkflowHome` — composes the four pieces above.

The seven stages are defined in `lib/workflow-shell/stages.ts` and the
progress derivation is a pure function in `lib/workflow-shell/progress.ts`.
This means the progress bar works even before the backend exposes a
`/workflow/progress` aggregate — the home page reads the same data the
underlying centers already query.

## Why a pure-function progress derivation

The progress bar is the spine of the new home page. If it has to wait for
a backend endpoint, the home page stays broken in every tenant that has
not yet received the new aggregate.

So `deriveProgress` accepts the booleans we already query from existing
centers (ideation, architecture, runs, connector) and returns a typed
`WorkflowProgress` object. This keeps the progress bar working with the
same data the centers already load — no new endpoint, no new failure
mode.

When the backend eventually exposes a `/workflow/progress` aggregate, the
hook `useWorkflowProgress` can be updated to prefer it. The component
contract does not change.

## How the seven stages deep-link

Each stage has a `centerPath` that points at the underlying center. The
deep-link preserves the existing center URLs — power users can still
reach `/ideation`, `/architecture`, `/runs` directly. The workflow route
just becomes the recommended path.

## Why we kept the legacy dashboard

The audit recommended we do not delete `/dashboard`. Power users (with
admin or operator personas) still navigate to it directly. The home page
just routes to `/workflow` instead.

When the workflow shell graduates from "shell" to "default surface for
everyone", `/dashboard` can be retired. Not before.

## When you should add a new stage

If a new stage is unavoidable:

1. Append to `WORKFLOW_STAGES` in `lib/workflow-shell/stages.ts`.
2. Update `STAGE_INPUTS` in `lib/workflow-shell/progress.ts` to recognize
   the new data source.
3. The progress bar lays out exactly seven chips; if you add an eighth,
   update the layout calculation in `WorkflowProgressBar`.
4. Add a vitest case in `tests/workflow-shell/progress.test.ts` covering
   the new state transitions.
5. Add a Playwright case in `tests/e2e/16-workflow-shell.spec.ts` for
   the new deep-link.

If you find yourself wanting to add two stages, that is a signal the
golden workflow is wrong. Go back to the product team before adding.