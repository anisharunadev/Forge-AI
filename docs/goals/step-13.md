> **Status:** completed
/goal

Modernize the Settings page in Forge AI Agent OS. Tokens, shell, empty states, and Steps 7–12 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "admin settings form tabs vertical horizontal layout" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "settings page tab navigation member management provider key" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "secret sensitive data input reveal copy environment variable" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/settings/page.tsx. Keep route. Keep the 10-tab structure: General · Members · Agents · Providers · Env Vars · Integrations · Workflow · Audit · AI Gateway · Seeds. Rebuild every tab.

SHELL — REPLACE TOP TABS WITH LEFT SIDEBAR (sits inside the content area, 240px sticky):
- Why: 10 tabs don't fit as text tabs. Move to a vertical sidebar inside the content column
- Header "PROJECT SETTINGS" --text-xs uppercase tracking-widest --fg-tertiary + h2 "Settings" --text-xl font-700 + body "Configure your project, invite team members, manage agents and LLM providers, and review settings changes in the audit log." --text-sm --fg-secondary
- Vertical nav list: each row = lucide icon (16px in semantic color per section) + section name --text-sm font-500 + count badge (members count, providers count, env vars count, etc). Sections in order: General, Members (N), Agents (N), Providers (N), Env Vars (N), Integrations (N), Workflow, Audit, AI Gateway, Seeds
- Active row: bg rgba(99,102,241,0.10) + --accent-primary text + 2px left rail. Framer Motion layoutId slide
- Footer of sidebar: small status block — "Last change: 12m ago by Arun" --text-xs --fg-tertiary with avatar

RIGHT PANEL (flex-1, --bg-surface, --radius-lg, p-32px):

GENERAL TAB (default):
- Sections stacked: Project identity (name, slug, description, logo upload), Defaults (region, timezone, currency), Notifications (toggles for each event category), Danger zone (archive / delete project — bordered card with rose accent)
- Each section: h3 --text-md font-600 + body --text-xs --fg-tertiary + form fields below. Form fields: shadcn Input with floating label, helper text below. Save button bottom-right of each section (sticky per-section save pattern — only enables when that section is dirty)

MEMBERS TAB:
- Top: "Invite member" primary button + role filter pills (All / Owners / Admins / Editors / Viewers)
- Member rows table: avatar + name + email + role badge (color-coded) + status dot (Active / Pending / Suspended) + last active --text-xs --fg-tertiary + 3-dot menu (Change role / Resend invite / Remove)
- Empty state: Step 3 EmptyState, illustration = UserPlus, title "No team members yet", description "Invite your first teammate to start collaborating.", primary "Invite member"

AGENTS TAB:
- List of agents assigned to this project (subset of Agent Center). Each row = agent name + status dot + runs count + last active + role/permissions chip + "Manage" link
- Empty state: Step 3 EmptyState variant pointing to Agent Center

PROVIDERS TAB — sensitive data, design carefully:
- Top: "Add provider" primary button (opens Dialog)
- Provider cards (not table): each card = provider name + logo + status dot + last sync + "Connected as: arun@acme.com" + 3-dot menu (Reauthorize / Disconnect)
- Inline API key field: shows masked dots by default, with eye icon to reveal, copy icon to copy, "Rotate key" button. NEVER show the key in plain text without the reveal click. Use shadcn Input with type="password" by default

ENV VARS TAB:
- Table: Key (mono) | Value (mono, masked) | Scope (Project / Build / Runtime) | Last edited | 3-dot menu
- Top: "Add variable" primary button + filter by scope + search
- Empty state: Step 3 EmptyState, illustration = KeyRound, title "No environment variables yet", description "Add secrets and config values for this project. Values are encrypted at rest.", primary "Add variable"

INTEGRATIONS TAB:
- Connector cards (reuse Step 10's connector card component, smaller variant): icon + name + status + "Configure" button. Filter by category

WORKFLOW TAB:
- List of automation rules: trigger event + conditions + actions. Each row expandable to show rule details
- Top: "New rule" primary button

AUDIT TAB (link to /audit):
- Embed the last 10 audit events inline (compact timeline) + "View full audit log →" link

AI GATEWAY TAB:
- Provider routing table: Provider | Model | Weight | Status | Cost/tok
- Top: routing visualization (mini Sankey-style diagram showing request distribution across providers)

SEEDS TAB:
- List of seed prompts/templates: name + description + usage count + "Run" button
- Top: "New seed" primary button

ERROR STATE (when project fails to load — current screenshot):
- Use a dedicated ErrorState component (create src/components/error-state.tsx)
- bg --bg-surface, --radius-lg, p-32px
- 80×80 square --bg-elevated --radius-xl with lucide AlertOctagon 32px in --accent-rose, animate-pulse
- Title "We couldn't load this project's settings" --text-md font-600
- Body "The backend endpoint for project info lands with sub-plan A; this tab will populate once it ships." --text-sm --fg-secondary
- Actions: "Try again" primary + "Back to dashboard" ghost
- Wrap in role="alert" aria-live="assertive"

CONSTRAINTS: every form field uses floating labels (not placeholder-only); required fields show * in --accent-rose; section-level dirty state with sticky save; password fields never logged; all icons from lucide; keyboard navigable; prefers-reduced-motion respected.

Deliverable: files modified, new error-state.tsx, layout sketch, 1-paragraph rationale citing skill rules.
