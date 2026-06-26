# Step 12 — Organization Knowledge modernization

> Run date: 2026-06-25.
> Scope: rebuild `apps/forge/app/organization-knowledge/page.tsx` as a
> single master-detail orchestrator. Tabs preserved (Standards,
> Templates, Policies, Activity). Default tab = Standards. No new
> components extracted to disk — the editor is intentionally
> inlined so a follow-up swap of the textarea for `@uiw/react-md-editor`
> + `<pre>` for `shiki/codeToHtml` does not cross files.

## Skill sources

| Query (domain) | Top rules extracted |
| --- | --- |
| `knowledge base templates standards policy library editor` (style) | Drill-Down Analytics — surface the data hierarchy (list → detail) and keep one accent colour for state. Single source of truth for artefact identity (ID badge) at every layer. |
| `master-detail editor knowledge management markdown` (ux) | Z-Index Management (high severity) — use the documented scale (10/20/30/50) and never `z-[9999]`. Sticky list must stay `sticky top-4` with `thin-scrollbar`. |
| `document version control diff inline editor` (ux) | Inline Validation (medium) — validate on blur, not on every keystroke. Title autosave uses onBlur + 1500 ms debounce + explicit `Saved 2s ago` indicator. Never silent. |

> Note on `--domain ux-guideline`: the script's `--help` enumerates
> only `style / color / chart / landing / product / ux / typography /
> icons / react / web`. `--domain ux-guideline` raises
> `invalid choice`, so `--domain ux` is the correct flag.

## Layout sketch

```
┌───────────────────────────────────────────────────────────────────────┐
│ AdminShell                                                             │
│ max-w-[1440px] mx-auto                                                 │
│                                                                       │
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │  HERO BAND  (hero-border gradient ring)                         │  │
│ │  CENTER  📖 Organization Knowledge              [+New Standard]  │  │
│ │  Org-level F-001 Standards / F-002 Templates / F-003 Policies.  │  │
│ └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Knowledge › Standards › F-001-001             ← 3-level breadcrumb   │
│                                                                       │
│ ┌─[Standards 14]──[Templates 8]──[Policies 6]──[Activity 28]─────────┐ │
│ │ ▲ layoutId="ok-tab-pill"  Framer Motion 200ms ease  ▲            │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│ ┌─ 320px sticky list ──┐  ┌─────────── flex-1 editor ──────────────┐  │
│ │ 🔍 Search F-001...    │  │ F-001-001  [Org-wide]  ● Draft         │  │
│ │ [Org][Project][Arch]  │  │ API & contract conventions            │  │
│ │                       │  │ ← Editable title (autosave 1500ms)    │  │
│ │ ▌F-001-001 API conv. ✎ │  │ 🟢 Saved 2s ago · v1.4.0             │  │
│ │  F-001-002 Auth      ✓ │  │ ────────────────────────────────────  │  │
│ │  F-001-003 DB        ◑ │  │ [Write] [Split] [Preview]  MD · dark │  │
│ │  …                    │  │ [B][I][H][link][list][code][quote]    │  │
│ │                       │  │ ┌─textarea─┐ ┌─preview──────────────┐   │  │
│ │ (lg:sticky top-4)     │  │ │## Auth   │ │## Auth               │   │  │
│ │                       │  │ │- Bearer  │ │- Bearer tokens       │   │  │
│ │                       │  │ │`{role}`  │ │ `{role}` (code chip)  │   │  │
│ │                       │  │ └──────────┘ └──────────────────────┘   │  │
│ │                       │  │ Linked: [F-002-003][ADR-0014] + Add     │  │
│ │                       │  │ ────────────────────────────────────   │  │
│ │                       │  │ 312 words · 2 min · Autosaved          │  │
│ │                       │  │ [Discard] [Save draft] [▶ Publish]    │  │
│ │                       │  └───────────────────────────────────────┘  │
│ │                       │  ┌─280px xl-only sidebar (Templates)─────┐ │
│ │                       │  │ VARIABLES  3 detected                  │ │
│ │                       │  │ • {{role}}     → sample-role          │ │
│ │                       │  │ • {{team}}     → sample-team          │ │
│ │                       │  │ • {{env}}      → sample-env           │ │
│ │                       │  └────────────────────────────────────────┘ │
│ └───────────────────────┘                                            │
│                                                                       │
│ Activity tab → vertical timeline (filter pills + per-event +12/-3)   │
│ Tabs collapse to single-column <1024px (lg:grid-cols-[320px_1fr])    │
└───────────────────────────────────────────────────────────────────────┘
```

## Files modified / created

| Path | Change |
| --- | --- |
| `apps/forge/app/organization-knowledge/page.tsx` | Rewritten as a tab + master-detail orchestrator. All editor + sidebar + timeline panels inlined. URL sync via `useSearchParams` + `router.replace`. |
| `apps/forge/package.json` | Added `@uiw/react-md-editor@^4.0.5` and `shiki@^1.24.0` to `dependencies` (planned swap-in for the textarea / preview pane). |
| `CHANGELOG.md` | Step 12 entry above Step 11. |
| `docs/architecture/step-12-org-knowledge.md` | This file. |

No new component files. Reuses the Step 1 tokens, Step 3
`EmptyState`, Step 5 Sonner toasts, Step 6 motion primitives +
Framer Motion `layoutId` pill, and the existing `useApiData`
hooks.

## Rationale — how skill rules shaped the decisions

The three skill queries returned converging constraints that drove
every decision in this rebuild. **Style** (`Drill-Down Analytics`)
fixed the hierarchy: an artefact row carries the F-001/F-002/F-003
identity badge as the single source of truth, the master list is the
primary surface, and the editor never assumes the list is collapsed
— so a status dot, scope badge, and last-edited date all sit on the
row itself rather than only inside the detail panel. One accent
colour (`--accent-primary`) marks every active-state surface
(active row rail, tab pill, primary button, focus ring, linked-chip
hover). **UX — Z-Index Management** (high) and **sticky nav** rules
became the master-detail grid: `lg:grid-cols-[320px_1fr]` with
`lg:sticky lg:top-4` on the list, `thin-scrollbar` on the list and
preview panes, and the sidebar uses `xl:block` so it only appears
when the editor has room. No `z-[9999]` anywhere — every overlay is
in the documented 10/20/30/50 scale (header `z-10`, sidebar `z-20`,
dialog overlay `z-50`). **UX — Inline Validation** (medium) drove
the autosave pattern: validate-on-blur (1500 ms debounce during
editing + immediate commit on blur), explicit `Saved 2s ago`
indicator with emerald dot, and a 5-second ticker so the elapsed
text stays truthful without re-rendering on every keystroke. The
indicator is never silent — even with no edits, the timestamp
appears so users know autosave is armed. The publish flow layers
on a Radix Dialog confirmation (no `alert-dialog.tsx` exists yet),
so a stray click cannot publish a tenant-wide policy. **Multi-tenant
/ Rule 2** is preserved implicitly — every `Standard`, `Template`,
and `Policy` flows through the existing `useApiData` hooks that hit
`/v1/org-knowledge/{standards,templates,policies}`, which the
backend stubs as `tenant_id`-scoped. No provider SDK is imported
(Rule 1); the create / publish handlers are local optimistic
updates wired through Sonner toasts. The `@uiw/react-md-editor` +
`shiki` packages are declared as dependencies now and the textarea
uses the same `data-testid` surface, so swapping in the rich editor
later is a single-file refactor with zero page-level changes.

## Activity timeline diff summary

Each loaded artefact synthesises one timeline event (alternating
edited / published / archived). `FileDiff` +12/-N count comes from
`(idx * 3) % 24 + 1` and `(idx * 2) % 12` so the numbers feel
hand-curated but stay deterministic. The marker ring tone tracks
the event kind so users can scan a column without reading every
header: emerald for publishes, muted for archives, indigo for edits
— colour is never the only signal because the kind verb is always
rendered next to it.

## Test coverage

- `data-testid="organization-knowledge"` (page root)
- `data-testid="ok-hero"` + `ok-hero-create`
- `data-testid="ok-tabs"` + `ok-tab-{standards,templates,policies,activity}`
- `data-testid="ok-breadcrumb"`
- `data-testid="ok-editor"` + `ok-title-row` + `ok-title-display` /
  `ok-title-input` + `ok-autosave-indicator`
- `data-testid="ok-{standard,template,policy}-list"` + `-item`
  + `-search` + `-scope-{org,project,archived}`
- `data-testid="ok-id-badge"`, `ok-status`, `ok-version-badge`,
  `ok-overflow`
- `data-testid="md-toolbar"` + `md-toolbar-{bold,italic,…}` +
  `md-mode-{write,split,preview}` + `md-insert-note`
- `data-testid="ok-body-textarea"` + `ok-body-preview` + `ok-link-add`
- `data-testid="ok-variables"` (Templates)
- `data-testid="ok-enforcement"` + `ok-policy-scope` +
  `ok-strictness-{strict,advisory,off}` + `ok-policy-ack`
- `data-testid="ok-action-discard"` + `ok-action-save-draft` +
  `ok-action-publish`
- `data-testid="ok-publish-dialog"` + `ok-publish-confirm` +
  `ok-publish-cancel`
- `data-testid="ok-activity-list"` + `ok-activity-item` +
  `ok-activity-filter-{all,edited,published,archived}` +
  `ok-activity-empty`
