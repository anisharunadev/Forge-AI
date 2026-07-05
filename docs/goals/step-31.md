> **Status:** completed
/goal

Modernize the Connector Center in Forge AI Agent OS — currently has 4 tabs (Connected / Marketplace / Health / Activity) all with sparse empty states. User wants two things: (1) modernize each tab, and (2) make connectors USABLE anywhere in the app — not siloed here. A user in Ideation should be able to pull from Zendesk; a user in Workflows should be able to trigger Slack. Connectors must be cross-cutting. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "integration marketplace connector gallery install browse" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "API credentials vault secrets OAuth token management" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "sync health status monitoring timeline activity log retry" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "cross-cutting capability contextual action picker embed" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/connector-center/page.tsx. Keep route. Total rebuild + ADD cross-cutting connector provider so any page in the app can invoke a connector.

==========================================================
ZONE 1 — HEADER + GLOBAL TOOLS
==========================================================

HERO BAND (animated gradient border):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Connector Center" --text-3xl font-700 with lucide Plug icon in --accent-cyan
- Body "Manage integrations with external systems, browse the marketplace, and review connector health."
- Top-right cluster:
  - **Health overview pill** (composite): "12 connected · 1 failing · 47 syncs today" with status dot
  - **"+ Add Connector"** primary button — opens connection wizard
  - **3-dot menu**: API documentation / Request new connector / Help

==========================================================
ZONE 2 — TAB BAR (expanded to 7)
==========================================================

TAB BAR (segmented control):
1. **Overview** (NEW — default) — connector hub dashboard
2. **Connected** (12) — installed + configurable
3. **Marketplace** (47) — browse + install
4. **Health** — live monitoring
5. **Activity** — sync history + audit
6. **Credentials** (NEW) — API keys + OAuth vault
7. **Webhooks** (NEW) — inbound + outbound

Count badges. Health tab has live status dot (emerald pulse when all healthy, amber/rose otherwise).

==========================================================
ZONE 3 — OVERVIEW TAB (new default)
==========================================================

CONNECTOR HUB DASHBOARD:

KPI STRIP (5 tiles, 120px tall):
1. **Connected** (cyan, Plug icon) — count + delta this week + sparkline
2. **Synced today** (emerald, RefreshCw) — total sync events + sparkline
3. **Failing** (rose, AlertTriangle) — count + which connectors + sparkline
4. **API calls** (indigo, Zap) — calls today + rate limit usage + sparkline
5. **Estimated cost** (amber, DollarSign) — $ this month + delta + sparkline

ROW 1 (3 tiles, 320px tall):

TILE A (flex-2): "RECENT SYNC ACTIVITY" — live stream
- Header: h3 "Recent sync activity" + "Streaming" badge + pause toggle + "Activity tab →"
- Virtualized live list (last 20): timestamp + connector icon + connector name + sync event type (Pull/Push/Webhook) + entity + status dot + duration
- New entries slide in from top with subtle emerald pulse
- Click → opens run detail

TILE B (flex-1): "TOP CONNECTORS BY USAGE"
- Header: h3 "Most-used" + "View all →"
- Recharts horizontal BarChart: top 6 connectors by sync count this week
- Hover: tooltip with breakdown

TILE C (flex-1): "CONNECTOR HEALTH"
- Header: h3 "Health" + "View health →"
- Donut chart: Healthy (emerald) / Syncing (cyan) / Stale (amber) / Failed (rose) / Quarantined (muted)
- Center: total connector count
- Hover segment: tooltip with names

ROW 2 (2 tiles, 280px tall):

TILE D (flex-1): "USED IN WORKFLOWS"
- Header: h3 "Connector usage across the app" + "Details →"
- Bar chart: connectors × usage count (used in workflows, ideation sources, destinations, agent contexts)
- Stacked: workflow (cyan) + ideation (amber) + destination (emerald) + agent context (violet)

TILE E (flex-1): "CREDENTIALS HEALTH"
- Header: h3 "Credentials" + "Manage →"
- List of credential statuses:
  - Last rotated (per credential) with age
  - Expiring soon (amber) / Expired (rose)
  - OAuth tokens near expiry
  - "Rotate all expiring" primary button when applicable

ROW 3 (full width, 240px tall):

TILE F: "RECOMMENDED CONNECTORS" (AI suggestions)
- Header: h3 "Recommended for you" + Sparkles icon + "Based on your usage"
- 3-4 connector cards: lucide icon + name + description + "Why?" tooltip + "Install" button
- AI analyzes codebase, workflows, and team activity to suggest

ROW 4 (full width, 200px tall):

TILE G: "CONNECTOR GRAPH PREVIEW" (mini visualization)
- Header: h3 "Connection graph" + "Open full view →"
- Mini force-directed graph: connector nodes connected to the Forge services that use them
- Click → expands to full graph view (new tab Connections)

==========================================================
ZONE 4 — CONNECTED TAB (enhanced)
==========================================================

GRID OF CONNECTED INTEGRATIONS (3 cols ≥1440px, 2 cols ≥1024px):

Each card: bg --bg-surface, --radius-lg, p-20px, hover lift
- HEADER: 48×48 connector icon (semantic color) + connector name --text-md font-600 + scope badge (Org-wide / Project-scoped) + status dot (Healthy emerald / Syncing cyan pulse / Stale amber / Failed rose / Paused muted / Quarantined rose+pulse)
- ACCOUNT info: "Connected as: arun@acme.com" (or workspace name)
- USAGE STATS:
  - "Synced X records today" + delta sparkline
  - "Used in N workflows" + "Used in N destinations" (small chips)
  - Last sync timestamp
- LAST SYNC ERROR (if any): rose tinted alert box + error message + "View error" + "Retry sync" buttons
- BOTTOM row: "Configure" outline button + "Pause/Resume" toggle + 3-dot menu (Disconnect / View activity / Rotate credentials)
- Hover: shows tooltip with full stats

CATEGORY FILTER BAR (above grid):
- Search input + filter chips: Category (Source control / Project mgmt / Comms / Cloud / Quality / Data / Design / Monitoring) | Status (All / Healthy / Syncing / Stale / Failed / Paused) | Scope | Owner

CONFIGURE DRAWER (when "Configure" clicked, right slide-in 640px):
- HEADER: connector name + icon + "Connected since X" + status badge
- TABS:
  1. **Settings** — configuration form specific to connector type (e.g., for GitHub: org name, repos to sync, sync frequency, event filters)
  2. **Sync** — schedule (real-time / every X min / cron), conflict resolution, retry policy
  3. **Credentials** — see Zone 8 (vault reference)
  4. **Usage** — where this connector is used (workflows, destinations, agents, ideation sources)
  5. **Activity** — recent sync history for this connector
  6. **Permissions** — what Forge can do via this connector (scopes list)
- Footer: "Save changes" primary button + "Test connection" outline

==========================================================
ZONE 5 — MARKETPLACE TAB (already good, polish)
==========================================================

Keep current marketplace pattern (3-col grid of connector cards with install button), ENHANCE:

- Add "Featured" carousel at top (curated picks)
- Add "New this month" section
- Add "Trending in your industry" (AI-personalized)
- Connector detail page (click card) — full screen with:
  - Hero: icon + name + tagline + Install + screenshots
  - Tabs: Overview / Setup / Permissions / Pricing / Reviews
  - Setup guide: step-by-step with screenshots
  - Reviews: user ratings + comments
  - "Used by N workspaces" social proof
- "Submit a connector" link for org to add custom internal connectors

==========================================================
ZONE 6 — HEALTH TAB
==========================================================

HEALTH DASHBOARD:

KPI STRIP (4 tiles, 100px tall):
- Healthy connectors (emerald)
- Syncing now (cyan, pulse)
- Stale (amber, >24h no sync)
- Failed (rose)

FILTER BAR:
- Filter chips: All / Healthy / Syncing / Stale / Failed / Quarantined / Paused
- Date range (last check time)
- "Re-run health check" primary button (with last check timestamp)

HEALTH TABLE (virtualized):
- Columns: Connector | Status | Last sync | Last success | Last failure | Error rate (mini progress bar) | Latency p95 | Actions
- Click row → connector detail drawer
- Failed rows highlighted rose
- "Retry now" button on failed rows
- "Quarantine" action on persistently failing (auto-disable after 5 failures)

CHART: Failure rate over time (Recharts LineChart)
- Shows: success rate trend last 7d
- Annotates: incidents

==========================================================
ZONE 7 — ACTIVITY TAB
==========================================================

SYNC TIMELINE:

KPI STRIP (4 tiles):
- Total syncs today
- Records ingested
- API calls made
- Errors

FILTER BAR:
- Date range + Connector dropdown + Event type (All / Sync / Pull / Push / Webhook / Error) + Actor (User / System / Webhook)

ACTIVITY LIST (virtualized):
- Each entry: timestamp + connector icon + connector name + event description + entity count + status badge + duration
- Click → sync detail (records synced, payload preview, error if any)
- Bulk select for retry: "Retry selected" button when errors selected

EXPORT: download activity log as CSV / JSON

==========================================================
ZONE 8 — CREDENTIALS TAB (new — vault)
==========================================================

THE WOW FEATURE — centralized credentials vault:

LAYOUT (split: list + detail):

LEFT (40%): credential list
- Search + filter (By connector / By status / By scope)
- Each row: connector icon + credential name (e.g., "GitHub PAT · Forge Platform") + scope (Org / Project) + owner avatar + last rotated + age badge (color-coded: emerald <30d, amber 30-90d, rose >90d)
- Quick actions: Reveal (eye) + Copy (clipboard) + Rotate (refresh)

RIGHT (60%): credential detail
- HEADER: credential name + connector + scope + status badge (Active / Expiring / Expired)
- INFO: type (API key / OAuth token / Service account / Webhook secret) + last rotated + rotated by + last used + scopes/permissions
- ROTATION HISTORY: timeline of all rotations
- USAGE: where this credential is used (workflows, destinations, agents)
- ACTIONS:
  - "Rotate now" primary button (with confirmation dialog: shows impact — "5 workflows use this credential, will need re-auth")
  - "Reveal" temporarily shows the secret (auto-hides after 30s)
  - "Copy" with auto-clear clipboard after 60s
  - "Revoke" (rose, confirmation required)
  - "Set rotation reminder" (auto-rotate every N days)

SECURITY NOTES:
- Never log secrets
- Reveal action requires re-auth (password / 2FA)
- Auto-mask secrets in all UI by default (••••••••)
- Audit log entry for every reveal/copy/rotate/revoke action

EMPTY STATE: "No credentials yet. Connect your first integration to create a credential." + "Browse marketplace →"

==========================================================
ZONE 9 — WEBHOOKS TAB (new)
==========================================================

WEBHOOK MANAGER:

TWO SUB-TABS: Inbound | Outbound

INBOUND WEBHOOKS (Forge receives webhooks from external systems):
- List: name + source (GitHub, Stripe, etc.) + URL + last triggered + status
- "+ New webhook" → wizard: pick connector → pick event type → generated URL + secret → test trigger
- Each row: copy URL + test trigger button + view recent deliveries

OUTBOUND WEBHOOKS (Forge sends webhooks to external systems):
- List: name + target URL + events subscribed + last sent + status
- "+ New webhook" → form: target URL + events to subscribe + auth (none / basic / bearer / signature) + retry policy
- Each row: edit / pause / view deliveries / rotate secret

DELIVERY LOG (collapsible section):
- Per webhook: list of recent attempts with status, response code, latency
- Retry failed deliveries

==========================================================
ZONE 10 — CROSS-CUTTING CONNECTOR PROVIDER (the big new feature)
==========================================================

THIS IS THE HEADLINE FEATURE. Make connectors USABLE anywhere in the app.

CREATE: src/lib/connectors/ provider that wraps all connector logic + exposes hooks + components.

A. `<ConnectorPicker>` — context-aware connector selector
- Use in: Ideation sources, Workflow nodes, Co-pilot context, Agent definitions, anywhere
- UI: Combobox that shows connected connectors, filters by capability (pull issues, send message, query database, etc.)
- Returns: connector reference + ready-to-use handle

B. `<ConnectorActionButton>` — inline invoke
- Small button rendered next to any entity (idea, story, workflow) that offers connector-based actions
- Example: on an idea → "Send to Slack #product-feedback" / "Create Jira ticket" / "Open in Notion"
- Hover: list of available actions based on connected connectors
- Click: confirms action + executes via connector

C. `<ConnectorHealthIndicator>` — small status pill
- Renders emerald/amber/rose dot + tooltip with full status
- Embed anywhere a connector is referenced
- Updates in real-time

D. `<ConnectorCredentialsBadge>` — shows what creds are needed
- When an action requires a connector that isn't connected: "Connect Zendesk to use this"
- Inline "Connect now" button

E. USAGE IN KEY PLACES:
- **Ideation Sources tab** (Step 28): the source cards ARE connectors. Connector picker when adding a source
- **Workflow editor** (Step 22): when adding "HTTP Request" or "Slack" or "Email" nodes, pull from connected connectors
- **Co-pilot** (Step 19/24): "@" mention can reference connectors (e.g., "@zendesk recent tickets")
- **Agent definition** (Step 4): agents can be configured with connector permissions
- **Run detail** (Step 14): if a run used connectors, show what was called

F. CONTEXTUAL EMBEDS:
- On Idea card: "Source: Zendesk · 47 tickets clustered"
- On Workflow node: shows connector icon + account
- On Run detail: "Called: GitHub.listIssues · 247 records"
- On ADR: "Implements: API spec from OpenAPI connector"

==========================================================
ZONE 11 — CONNECTIONS GRAPH (new tab)
==========================================================

Force-directed graph of all integrations:
- Center: Forge platform node
- Spokes: each connected connector
- Sub-nodes: services/APIs the connector provides
- Edges: usage (which workflows, agents, destinations use which connector)
- Hover: details
- Click: navigates to connector or usage
- Color by health

==========================================================
ZONE 12 — KEYBOARD SHORTCUTS
==========================================================

- ⌘⇧C: Open Connector picker anywhere
- ⌘⇧K: New credential
- ⌘⇧W: New webhook
- ⌘/: Show shortcuts

==========================================================
CONSTRAINTS
==========================================================

- Fix current empty states — they need real content even with mock data
- Keep marketplace card design from Step 10
- All new components: <ConnectorPicker>, <ConnectorActionButton>, <ConnectorHealthIndicator>, <ConnectorCredentialsBadge> in src/components/connectors/
- Cross-cutting provider in src/lib/connectors/
- Real OAuth NOT required — mock connections with realistic status indicators
- Credentials masking: always show ••••• by default; reveal requires re-auth (UI only, not real 2FA for now)
- All sync events are mocked with realistic delays + occasional failures
- Dark mode only
- Lucide icons only
- All animations respect prefers-reduced-motion

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/connectors/
- Connector provider in src/lib/connectors/
- 15+ mock connectors with realistic data (name, icon, status, credentials, last sync, error rate)
- All 7 tabs functional
- Cross-cutting provider working: <ConnectorPicker> usable from Ideation, Workflow, Co-pilot
- Connections graph rendered
- Credentials vault with reveal/copy/rotate flows
- Webhook manager functional (form + list + delivery log)
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep marketplace card design from Step 10, keep existing connector data shape, don't break any existing integrations
