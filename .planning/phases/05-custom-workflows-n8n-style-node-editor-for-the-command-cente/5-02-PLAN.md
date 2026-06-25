---
plan: 5-02
phase: 5
wave: 2
depends_on: ["5-01"]
files_modified:
  - apps/forge/app/custom-workflows/page.tsx
  - apps/forge/app/custom-workflows/new/page.tsx
  - apps/forge/app/custom-workflows/[id]/page.tsx
  - apps/forge/app/custom-workflows/[id]/runs/page.tsx
  - apps/forge/components/custom-workflows/WorkflowEditor.tsx
  - apps/forge/components/custom-workflows/NodePalette.tsx
  - apps/forge/components/custom-workflows/PropertiesPanel.tsx
  - apps/forge/components/custom-workflows/RunStatusBar.tsx
  - apps/forge/components/custom-workflows/RunHistoryDrawer.tsx
  - apps/forge/components/custom-workflows/nodes/TriggerNode.tsx
  - apps/forge/components/custom-workflows/nodes/CommandNode.tsx
  - apps/forge/components/custom-workflows/nodes/ApprovalNode.tsx
  - apps/forge/components/custom-workflows/nodes/ScriptNode.tsx
  - apps/forge/components/custom-workflows/nodes/index.ts
  - apps/forge/lib/api/workflows.ts
  - apps/forge/lib/hooks/useWorkflows.ts
  - apps/forge/lib/hooks/useWorkflowRun.ts
  - apps/forge/lib/types/workflow.ts
  - apps/forge/components/forge-commands/CategoryNav.tsx
  - apps/forge/components/forge-commands/CommandRunDialog.tsx
  - apps/forge/tests/custom-workflows/editor.test.tsx
  - apps/forge/tests/custom-workflows/api.test.ts
  - apps/forge/tests/e2e/custom-workflow-roundtrip.test.tsx
autonomous: true
requirements: [F-018, Rule-2, Rule-3, Rule-4, Rule-6]
---

<objective>
Ship the frontend: an n8n-style workflow editor under `/custom-workflows` where users compose Trigger / Command / Approval / Script nodes, connect them on a canvas, edit per-node properties, save, and re-run. Pairs with the Phase C backend (executor + sandbox + `/commands/{name}/run` + approvals-resume).

Purpose: Surface the Phase B persistence and Phase C executor to a non-technical user. Without this, the editor's typed `WorkflowDefinition` JSONB has no producer.

Output:
- 4 new routes: `/custom-workflows`, `/custom-workflows/new`, `/custom-workflows/[id]`, `/custom-workflows/[id]/runs`.
- 5 new components: `WorkflowEditor`, `NodePalette`, `PropertiesPanel`, `RunStatusBar`, `RunHistoryDrawer`.
- 4 new typed node components: `TriggerNode`, `CommandNode`, `ApprovalNode`, `ScriptNode` (deliberately a separate registry from the existing `components/graph/forgeNodeTypes`).
- 3 new lib modules: `lib/api/workflows.ts` (typed client wrappers), `lib/hooks/useWorkflows.ts` + `useWorkflowRun.ts` (TanStack Query + SSE), `lib/types/workflow.ts` (mirrors Pydantic schemas).
- 2 small command-center integrations: `Custom Workflows` link in `CategoryNav`; "Save as workflow" button in `CommandRunDialog`.
- 3 test files: editor unit, API client unit, Playwright round-trip.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@/home/arunachalam.v@claude/plans/jaunty-leaping-hamming.md
@apps/forge/package.json
@apps/forge/lib/api.ts
@apps/forge/lib/forge-commands.ts
@apps/forge/lib/design-system/status.ts
@apps/forge/lib/utils.ts
@apps/forge/lib/hooks/
@apps/forge/components/shell/PageContainer.tsx
@apps/forge/components/shell/Sidebar.tsx
@apps/forge/components/ui/ (sheet, dialog, select, input, textarea, switch, label, separator, tooltip, tabs, toast, toaster)
@apps/forge/components/forge-commands/CategoryNav.tsx
@apps/forge/components/forge-commands/CommandRunDialog.tsx
@backend/app/schemas/workflow.py
</context>

<must_haves>
truths:
  - "`/custom-workflows` lists saved workflows (tenant-scoped via existing `Principal`); empty state with a 'New workflow' button renders when none exist"
  - "Drag from `NodePalette` onto the canvas adds a typed node; `onConnect` adds an edge; deleting the trigger node is rejected by the editor guard"
  - "`PropertiesPanel` shows a per-type form (Command → command name Select bound to `FORGE_COMMANDS`; Script → language + source textarea; Approval → label + approver role + timeout)"
  - "Save button POSTs the `WorkflowDefinition` to the API; the new id is the redirect target; dirty indicator + last-run badge in `RunStatusBar`"
  - "`RunHistoryDrawer` lists runs for the current workflow; each row shows status pill + step timeline; opens from a 'View runs' link in the status bar"
  - "`pnpm --filter forge-dashboard test -- custom-workflows` passes (Vitest + Testing Library)"
  - "`pnpm --filter forge-dashboard test:e2e -- custom-workflow-roundtrip` passes (Playwright: editor → drop trigger + command + approval → connect → save → run → see `waiting_approval` → resume → see `succeeded`)"
  - "Zero direct `reactflow@11` imports remain (`grep -RIn \"from 'reactflow'\" apps/forge/` returns nothing); only `@xyflow/react` is used"
  - "Reuse: `toneClasses`, `agentStateToTone`, `agentStateGlyph` from `lib/design-system/status.ts`; `cn` from `lib/utils.ts`; `forgeFetch` from `lib/api.ts`; shadcn primitives from `components/ui/`"

artifacts:
  - path: apps/forge/components/custom-workflows/WorkflowEditor.tsx
    contains: ["ReactFlowProvider", "useNodesState", "useEdgesState", "onConnect", "addEdge"]
  - path: apps/forge/components/custom-workflows/nodes/index.ts
    contains: ["workflowNodeTypes", "TriggerNode", "CommandNode", "ApprovalNode", "ScriptNode"]
  - path: apps/forge/lib/api/workflows.ts
    contains: ["listWorkflows", "createWorkflow", "getWorkflow", "updateWorkflow", "deleteWorkflow", "startRun", "getRun", "cancelRun", "resumeRun"]
  - path: apps/forge/lib/hooks/useWorkflowRun.ts
    contains: ["useQuery", "useMutation", "EventSource", "/events"]
  - path: apps/forge/tests/custom-workflows/editor.test.tsx
    contains: ["render", "fireEvent", "drop", "connect"]
  - path: apps/forge/tests/e2e/custom-workflow-roundtrip.test.tsx
    contains: ["playwright", "trigger", "command", "approval", "succeeded"]
</must_haves>

<verification>
1. `cd apps/forge && pnpm typecheck` clean.
2. `cd apps/forge && pnpm test -- custom-workflows` — all unit tests pass.
3. `cd apps/forge && grep -RIn "from 'reactflow'" .` returns nothing (only `@xyflow/react` allowed).
4. `cd apps/forge && pnpm test:e2e -- custom-workflow-roundtrip` — Playwright test passes against a dev backend.
5. Manual: open `/custom-workflows/new` in a browser, drag a Trigger + Command + Approval from the palette, connect them, pick `forge-dev-refactor` for the Command, Save → redirected to `/custom-workflows/{id}` → Run → status bar shows `running` then `waiting_approval` → decide in `/audit` → flips to `succeeded` → re-run creates a second row in the drawer.
</verification>

<notes>
- The detailed sub-plan is in `/home/arunachalam.v@claude/plans/jaunty-leaping-hamming.md` under "Phase D". Cross-reference; do not duplicate.
- The new node registry is `workflowNodeTypes`, deliberately separate from the existing `forgeNodeTypes` in `components/graph/index.ts`. This keeps the Phase 0.5-06 typed registry untouched.
- React Flow v12 hooks to use: `useNodesState`, `useEdgesState`, `useReactFlow`, `addEdge`, `applyNodeChanges`, `Connection`, `MarkerType`. v11 hooks are not available.
- SSE: use the same `EventSource` pattern from `lib/useRealtime.ts` (which already powers the audit timeline).
- Project Intelligence layer: per Rule 5, custom workflows are Project Intelligence — they stay isolated per `(tenant_id, project_id)`. The list view should scope to the current project from the existing `useProjectContext` (already in `lib/hooks/`).
- Do not use `sonner` (project doesn't have it). Use the Radix `useToast` from `components/ui/toast`.
</notes>
