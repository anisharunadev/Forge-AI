# Step 75 — Tenant Switcher Dedupe (Sidebar-only)

> **Status:** ✅ SHIPPED 2026-07-03
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration:** ~10 minutes (4 surgical edits)
> **Goal:** Remove the duplicate tenant switcher from the header; promote the sidebar location to the single canonical switcher; ship real backend data through the sidebar

## /goal

Before the fix (verified this session from the screenshot at `/forge-ai`):

- **Header** (right cluster, `Topbar.tsx:160`) rendered `<TenantSwitcher />` — the **real** one, calls `GET /auth/me/tenants`, TanStack Query + Radix Popover. Step 52 Zone 6 had built it.
- **Sidebar** (top of `Sidebar.tsx:364`) rendered `<WorkspaceSwitcher>` — a **local hardcoded fixture** with 3 phantom tenants (`acme-corp`, `beta-ind`, `cosmic`). NO API call. NO backend wiring. Step 63 was supposed to fix this but the dedupe was incomplete.

Two switches visible simultaneously. Violates Rule 12 (cross-cutting concerns — same feature should have ONE canonical implementation). Also contradicted Step 63 ("the sidebar dup must be removed").

**Decision:** keep the **sidebar** as the canonical location (matches the user's mental model: workspace = sidebar context). Remove the **header** switcher. Replace the sidebar's local `<WorkspaceSwitcher>` (hardcoded fixture) with the real `<TenantSwitcher>` from `@/components/tenant-switcher`.

## Constraints

- **No backend changes.** The TanStack Query and the `/auth/me/tenants` route are already in place.
- **No visual change** to what the user sees in the sidebar — same dark theme, same gradient avatar, same dropdown menu. Only the data source changes (real API → real tenants).
- **No new tokens.** Reuse `--accent-primary`, `--accent-violet`, `--fg-primary`, `--fg-tertiary`, `--border-subtle`, `--bg-elevated`, `--bg-inset`, `--shadow-glow-primary`. Don't add new theme variables.
- **No schema migration.** Not applicable.
- **Dark theme only** — `<TenantSwitcher />` is already dark-themed.

## Files to read FIRST

1. `apps/forge/components/tenant-switcher.tsx` — the canonical component (TanStack Query + Radix Popover)
2. `apps/forge/components/shell/Topbar.tsx` — header where `<TenantSwitcher />` lives (lines 20, 160)
3. `apps/forge/components/shell/Sidebar.tsx` — sidebar with hardcoded `<WorkspaceSwitcher>` (lines 1-15 imports, 162-269 dead block, 364 usage)
4. `apps/forge/components/user-menu.tsx` — adjacent header component, untouched

## ZONE 1 — Remove `<TenantSwitcher />` from Topbar.tsx (2 edits in 1 file)

### Edit 1.1 — Drop the import

```diff
-import { TenantSwitcher } from '@/components/tenant-switcher';
 import { UserMenu } from '@/components/user-menu';
```

### Edit 1.2 — Drop the JSX

```diff
       {/* Right cluster */}
       <div className="flex items-center gap-1">
-        {/* Tenant switcher (step-52 Zone 6) — shows the active workspace
-            and lets the user bounce to another one. */}
-        <TenantSwitcher />
-
         {/* Theme toggle */}
         <ThemeInlineToggle ... />
```

The header still has: theme toggle, notifications bell (→ `/audit`), user menu. Workspace switching is **not** one of those concerns; it lives in the sidebar.

## ZONE 2 — Wire `<TenantSwitcher />` into Sidebar.tsx (3 edits in 1 file)

### Edit 2.1 — Add the import

```diff
 import { useShell } from './ShellProvider';
 import {
   GROUP_LABELS,
   ICONS,
   groupedNav,
   isNavMatch,
   type NavItem,
 } from './nav-config';
+import { TenantSwitcher } from '@/components/tenant-switcher';
```

### Edit 2.2 — Replace the call site

```diff
-        {/* Workspace switcher (top) */}
+        {/* Workspace switcher (top) — single source of truth (was: local
+            hardcoded WorkspaceSwitcher; replaced with the real
+            TenantSwitcher from `@/components/tenant-switcher` so we
+            have ONE canonical switcher across the shell). */}
         <div className={cn('flex shrink-0 items-center', sidebarCollapsed ? 'justify-center px-2 pt-4' : 'px-3 pt-4')}>
-          <WorkspaceSwitcher collapsed={sidebarCollapsed} />
+          <TenantSwitcher />
         </div>
```

`<TenantSwitcher>` accepts no props (it reads from `useShell()` / `useAuth()`). The `collapsed` prop was a sidebar-only concern. The real `<TenantSwitcher>` displays both collapsed + expanded via its internal Radix layout.

### Edit 2.3 — Delete the dead `<WorkspaceSwitcher>` block (lines 162-269, ~108 lines)

```diff
-/**
- * Workspace switcher (tenant picker) shown at the top of the sidebar.
- *
- * In collapsed mode, only the avatar tile is rendered (40x40 hit area).
- * In expanded mode, the avatar + tenant name + chevron + `⌘\` hint
- * are visible, opening a dropdown of available tenants.
- */
-interface WorkspaceSwitcherProps {
-  readonly collapsed: boolean;
-}
-
-function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
-  ... (entire function)
-}
-
 /**
  * Tenant health status pill pinned to the bottom of the sidebar.
```

Drop:
- The doc comment (5 lines)
- `interface WorkspaceSwitcherProps` (3 lines)
- The function body: `function WorkspaceSwitcher({ collapsed }) { ... }` (~95 lines including the `if (collapsed) { ... }` branch and the main `return (<DropdownMenu>...)`)

Keep: `TenantStatusFooter` and everything below it.

### Edit 2.4 — Drop the unused `Check` import

After deleting the `<WorkspaceSwitcher>` block, `Check` (from lucide-react) is no longer referenced. Drop it from the import block:

```diff
 import {
-  Check,
   ChevronDown, ChevronsLeft,
   ChevronsRight,
   Settings as SettingsIcon,
   type LucideIcon
 } from 'lucide-react';
```

## ZONE 3 — Verify

### Visual check

Reload `/forge-ai` (or any page). Confirm:

- **Header** has: theme toggle, bell, user avatar. **No** tenant dropdown.
- **Sidebar** top: tenant switcher (real, with gradient avatar + name + chevron). Clicking it opens the real dropdown populated from `GET /auth/me/tenants`.

### Type check

```bash
cd /workspace/codebase/forge-ai
npx tsc --noEmit -p apps/forge/tsconfig.json 2>&1 | grep -E "Sidebar\.tsx|Topbar\.tsx" | head -20
```

Expected: **0 errors** in `Sidebar.tsx` or `Topbar.tsx`. (Other tsc errors from unrelated files are out of scope — leave them alone.)

### Lint

```bash
cd /workspace/codebase/forge-ai
npx eslint apps/forge/components/shell/Sidebar.tsx apps/forge/components/shell/Topbar.tsx 2>&1 | head
```

Expected: 0 new errors.

### Behavior check

1. Open `/forge-ai`
2. Confirm only one tenant switcher (sidebar top)
3. Click it → dropdown opens, lists tenants from the API
4. Switch tenant → page reloads / cookie updates per `<TenantSwitcher>`'s existing flow
5. Header shows: theme toggle + bell + user menu. **No** tenant switcher.

## CONSTRAINTS (recap)

- **No backend changes.**
- **No visual change** in the sidebar — same avatar, same menu, same dark theme.
- **No new tokens.**
- **Dark theme only.**
- **The 10-line `useState`/`useEffect` for `isMac` in the deleted block is gone** — don't port it. The real `<TenantSwitcher>` handles keyboard shortcuts internally if it needs them.

## DELIVERABLE (recap)

### Modified

- [x] `apps/forge/components/shell/Topbar.tsx` — removed `TenantSwitcher` import + JSX
- [x] `apps/forge/components/shell/Sidebar.tsx` — added `TenantSwitcher` import, replaced `<WorkspaceSwitcher>` with `<TenantSwitcher />`, deleted the dead local function + interface (108 lines), dropped unused `Check` import

### Created

- (none)

### Verify

- [x] `npx tsc --noEmit` — 0 errors in `Sidebar.tsx` / `Topbar.tsx`
- [x] Visual: header has no tenant switcher; sidebar has the real one
- [x] Behavior: dropdown opens, lists real tenants from `/auth/me/tenants`

## "What we deliberately did NOT do"

- **Did not rename `<TenantSwitcher>` to `<WorkspaceSwitcher>`.** The component name is the canonical one; the sidebar usage just adopts it.
- **Did not migrate the `Ctrl+\\` keyboard shortcut** from the deleted block. If the real `<TenantSwitcher>` doesn't bind it, that's a follow-up.
- **Did not change the user-menu** in the header.
- **Did not change the page route or wiring** — only the chrome.
- **Did not add a regression test.** The component is essentially a control surface change; visual verification is the spec.

---

**Total scope:** ~10 minutes for 1 engineer. 4 edits across 2 files, ~110 lines net deletion.

This is the **simplest step in the pipeline**. Two CSS-class-identical surfaces, one of which was clearly the canonical implementation, deduped by deletion + import. No backend, no schema, no tokens.

---

## SHIPPED — Log of edits made

| # | File | Edit | Result |
|---|---|---|---|
| 1 | `Topbar.tsx` | Drop `import { TenantSwitcher } ...` line | Header no longer imports the switcher |
| 2 | `Topbar.tsx` | Drop `<TenantSwitcher />` JSX + comment | Header right cluster loses the switcher; theme/bell/user-menu remain |
| 3 | `Sidebar.tsx` | Add `import { TenantSwitcher } from '@/components/tenant-switcher';` | Sidebar imports the canonical switcher |
| 4 | `Sidebar.tsx` | Replace `<WorkspaceSwitcher collapsed={sidebarCollapsed} />` with `<TenantSwitcher />` | Sidebar renders the real switcher |
| 5 | `Sidebar.tsx` | Delete dead `<WorkspaceSwitcher>` function + interface + doc comment (~108 lines) | No dead code |
| 6 | `Sidebar.tsx` | Drop unused `Check` from lucide-react import | No unused imports |

After ship:
- Header: `theme | bell | user-menu` (no tenant switcher)
- Sidebar: `real TenantSwitcher | nav | status footer | collapse toggle`

Single canonical switcher. Real backend data. No fixture.