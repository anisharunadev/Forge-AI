/goal

Modernize the Governance Center page in Forge AI Agent OS. Tokens, shell, empty states, and Step 7 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "approval workflow dashboard admin policy management" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "approval queue inbox RBAC admin dashboard" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "KPI tile status card admin dashboard dark" --domain chart -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/governance/page.tsx. Keep route. Rebuild.

LAYOUT (single column, max-width 1280px centered, p-32px):

HERO BAND (full width, 180px tall, animated gradient border like Step 4's hero):
- Eyebrow "CENTER #8" --text-xs --fg-tertiary uppercase tracking-widest
- h1 "Governance Center" --text-3xl font-700 --fg-primary
- Body "Engineering Lead view of every Approval Request, Board Confirmation, active Policy, and RBAC role for tenant acme-corp. Accept/Decline is gated to the Board token per Paperclip interaction schema." --text-sm --fg-secondary
- Top-right: "Board token" status pill — emerald dot + "Healthy" + settings cog icon. If unhealthy: amber dot + "Token missing" + "Reconnect" button

STATUS BANNER (full width, below hero, --bg-surface, --radius-lg, p-16px flex):
- Left: shield icon in --accent-primary
- Middle: title "Board token present" --text-sm font-500 + body "Board token present for this session — Accept actions are enabled for request_confirmation interactions." --text-xs --fg-secondary
- Right: "Disconnect" ghost button

KPI TILE ROW (4 tiles, 140px tall, gap-4):
- Pending Approvals (amber dot), Board Confirmations this week (cyan), Active Policies (violet), RBAC Roles (indigo)
- Each: --text-3xl font-700 number + --text-sm --fg-tertiary label + 40px sparkline (Recharts) + delta --text-xs semantic color

SECTION 1: PENDING APPROVALS (mt-8)
- Header row: h2 "Pending Approvals" --text-md font-600 + "N pending" count badge (amber if >0) + sort dropdown on the right
- Approval cards (when populated): bg --bg-surface, --radius-md, p-16px, border --border-subtle. Layout: avatar + submitter name + role + requested-at --text-xs --fg-tertiary. Center: request title --text-sm font-500 + snippet --text-xs --fg-secondary. Right: "Approve" (emerald) + "Decline" (rose outline) + "Open" ghost buttons
- Empty state: use Step 3 EmptyState variant — illustration = ShieldCheck, title "No pending approvals", description "The Board is caught up.", no primary action (this is good news)

SECTION 2: BOARD CONFIRMATION HISTORY
- Same header pattern. Rows are timeline entries: timestamp + action + actor + diff summary + chevron to expand. Use shadcn Collapsible for the diff expansion
- Empty state: illustration = History, title "No Board confirmations yet", description "History will populate as the Board accepts or declines prompts."

SECTION 3: POLICIES
- Table (shadcn Table): Name | Scope (tenant / project / global) | Enforcement (strict / advisory / off) | Last edited | Status dot | Actions menu
- Top-right: "New policy" primary button + filter input

SECTION 4: RBAC ROLES (compact)
- List of role chips (Owner, Admin, Editor, Viewer, Custom). Click expands to show member list with avatars

CONSTRAINTS: every action button has loading state + disabled state + success/error toast; "Approve" requires confirmation modal (shadcn AlertDialog) showing the action impact; all KPI sparklines use sample data with clean prop interfaces; prefers-reduced-motion respected.

Deliverable: files modified, layout sketch, 1-paragraph rationale citing skill rules.