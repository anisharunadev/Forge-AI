/goal

Add 10 missing tabs to the Settings (Admin) page in Forge AI Agent OS. Current 10 tabs cover the basics — need to add Profile, Notifications, API Tokens, Webhooks, Connected Apps, SSO, Branding, Billing, Feature Flags, Keyboard Shortcuts. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "settings page navigation sidebar tabs configuration account" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "profile account security 2FA password session management" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "API tokens personal access tokens OAuth webhooks" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "SSO SAML white-label branding custom domain enterprise" --domain ux-guideline -f markdown

Adopt every rule. Then build:

==========================================================
ZONE 1 — EXTEND SIDEBAR NAV (add 10 new tabs)
==========================================================

The current sidebar has 10 tabs. Reorganize into 3 groups with section headers:

GROUP 1: ACCOUNT (new section)
- Profile (NEW) — your own account
- Sessions (NEW) — active sessions, security log
- Notifications (NEW) — email/Slack/Co-pilot preferences
- API Tokens (NEW) — personal access tokens

GROUP 2: WORKSPACE (existing tabs, keep as is)
- General
- Members
- Agents
- Providers
- Env Vars
- Integrations
- Workflow
- Audit

GROUP 3: ENTERPRISE (new section)
- AI Gateway
- Seeds
- Webhooks (NEW) — inbound/outbound
- Connected Apps (NEW) — OAuth apps
- SSO (NEW) — SAML/SSO config
- Branding (NEW) — white-label
- Billing (NEW) — subscription/usage
- Feature Flags (NEW) — beta toggles
- Keyboard Shortcuts (NEW) — config

LAYOUT: scrollable sidebar, 56px collapsed rail by default, expand to 320px on hover/click. Section headers in --text-xs uppercase tracking-widest with --fg-tertiary.

==========================================================
ZONE 2 — PROFILE TAB (NEW)
==========================================================

LAYOUT (--bg-elevated, p-32px, max-w-720px):

SECTION 1: PROFILE INFO
- Avatar (48×48, click to upload new) + Name + Email
- Display name (editable)
- Email (with verification status — "Verified" emerald badge)
- Bio (textarea, 200 char max)
- Timezone (Combobox)
- Locale (Combobox: en-US, en-GB, de-DE, etc.)
- Theme preference: Dark (default) / Sync with system
- Accent color (color picker, default --accent-primary indigo)
- "Save changes" button (sticky bottom)

SECTION 2: SECURITY
- Password: "Change password" button (opens Dialog with current/new/confirm fields)
- Two-Factor Authentication: toggle + setup wizard
  - "Enable 2FA" → opens QR code scanner Dialog (TOTP)
  - Recovery codes list (10 codes, downloadable)
- "View security log" link → shows recent security events (logins, password changes, 2FA events)

SECTION 3: CONNECTED ACCOUNTS
- List of OAuth accounts linked: Google, GitHub, GitLab, Microsoft
- "Connect [provider]" button per unlinked
- "Disconnect" per linked (with confirmation)
- Shows: provider icon + email + "Connected 2m ago"

==========================================================
ZONE 3 — SESSIONS TAB (NEW)
==========================================================

LAYOUT:

ACTIVE SESSIONS list (--bg-elevated, --radius-lg, p-24px):
- Current session: highlighted with emerald "This device" badge
  - Browser, OS, IP, location, last active
  - "Sign out" button (only for non-current)
- Other sessions: each row = device icon + browser + OS + location + IP + "last active Xm ago" + "Sign out" X button
- "Sign out all other sessions" primary button (with confirmation Dialog: "This will sign out N sessions. You'll need to log in again on those devices")

DEVICE MANAGEMENT (collapsible section):
- "Manage trusted devices" link
- Trusted devices list with "Revoke trust" buttons

==========================================================
ZONE 4 — NOTIFICATIONS TAB (NEW)
==========================================================

LAYOUT (split: channels left, events right):

LEFT: CHANNELS (--bg-elevated, --radius-lg, p-24px):
- Email: "arun@acme.com" + "Verified" badge + change link
- Slack: "Not connected" + "Connect Slack" button
- Microsoft Teams: "Not connected" + "Connect Teams" button  
- Discord: "Not connected" + "Connect Discord" button
- Webhook: "Add webhook URL" button
- In-app: always on (bell icon)
- Co-pilot: always on (panel pings for important events)

RIGHT: EVENTS (--bg-elevated, --radius-lg, p-24px):
- Categories: Runs, Approvals, Violations, Deployments, Weekly digest
- For each event: toggles per channel (Email, Slack, In-app, Co-pilot)
- Examples:
  - "Run completed" → Email + In-app
  - "Run failed" → All channels
  - "Approval needed" → Email + Slack + In-app
  - "Policy violation" → All channels
  - "Deployment succeeded" → Slack + In-app
  - "Weekly digest" → Email (Sunday 9am)
- "Test notifications" button → sends test message to all enabled channels
- "Quiet hours" toggle: don't notify between 10pm-8am (configurable)

==========================================================
ZONE 5 — API TOKENS TAB (NEW)
==========================================================

LAYOUT (--bg-elevated, p-32px):

HEADER: h2 "API tokens" + "Create token" primary button
Body: "Personal access tokens authenticate scripts and CI/CD pipelines to the Forge API. Treat them like passwords."

ACTIVE TOKENS list (virtualized):
- Each token row:
  - Token name (editable) + scope (read-only / read-write / admin)
  - Token prefix: "forge_pat_abc123..." (truncated, with copy button)
  - Created date + last used date + expires date
  - Used by: list of recent requests (e.g., "12 requests today")
  - Actions: 3-dot menu (Rename / Edit scope / Regenerate / Revoke)
  - "Revoke" requires confirmation Dialog

CREATE TOKEN Dialog (--bg-elevated, max-w-560px):
- Name (required)
- Scope: Read / Read-Write / Admin (RadioGroup with description of each)
- Expiration: 30 days / 90 days / 1 year / Never (RadioGroup)
- Scopes (multi-select): which APIs this token can access (forge-core, forge-pi, forge-browser, etc.)
- "Generate" → reveals token ONCE in a yellow callout: "Save this token now. You won't see it again."
- Copy button + "Done" button

BEST PRACTICES card:
- Use tokens per integration (don't share)
- Set expiration
- Use least-privilege scope
- Audit regularly (shows last used)

==========================================================
ZONE 6 — WEBHOOKS TAB (NEW)
==========================================================

LAYOUT (--bg-elevated, p-32px):

HEADER: h2 "Webhooks" + "Add webhook" primary button
Body: "Webhooks let external services receive events from Forge in real time."

WEBHOOKS list:
- Each webhook:
  - Name + URL (truncated, copy)
  - Status: Active (emerald pulse) / Paused (muted) / Failing (rose)
  - Events subscribed: chip list (e.g., "run.completed", "approval.requested", "deployment.succeeded")
  - Last triggered: timestamp + status
  - "Test" button (sends a test payload)
  - Actions: 3-dot menu (Edit / Pause / View deliveries / Rotate secret / Delete)

ADD WEBHOOK Dialog:
- Name
- URL (with validation)
- Events to subscribe (multi-select, grouped by category):
  - Runs: run.started, run.completed, run.failed
  - Approvals: approval.requested, approval.granted, approval.rejected
  - Deployments: deployment.started, deployment.succeeded, deployment.failed
  - Workspace: workspace.member_added, workspace.member_removed
  - Knowledge: artifact.created, artifact.updated
- Auth: None / Basic / Bearer / HMAC signature
- Retry policy: 3 retries with exponential backoff
- "Create" → webhook is created + secret shown once

DELIVERY LOG (collapsible per webhook):
- Last 50 deliveries with status, response code, latency
- Re-deliver failed

==========================================================
ZONE 7 — CONNECTED APPS TAB (NEW)
==========================================================

LAYOUT:

HEADER: h2 "Connected apps" + "Browse marketplace" outline button

LIST of OAuth apps you've authorized:
- Each row:
  - App icon + name + developer
  - Scopes granted (e.g., "Read projects · Write stories")
  - Authorized date + last used date
  - "Permissions" expand to show full scope list
  - "Revoke access" button (rose, with confirmation)

CATEGORIES (filter pills): All / Productivity / Dev tools / Communication / Data

EMPTY STATE: "No apps connected. Browse the marketplace to find apps that integrate with Forge." + "Browse marketplace" CTA

==========================================================
ZONE 8 — SSO TAB (NEW)
==========================================================

LAYOUT:

HEADER: h2 "Single Sign-On (SSO)" + "Configure SSO" button

CURRENT STATUS:
- "SSO is not configured" or "SSO is active via [provider]"
- If active: shows provider logo + "Connected" + "Manage" button

CONFIGURE SSO wizard:
- Step 1: Choose provider: SAML 2.0 / OIDC / Google Workspace / Okta / Azure AD / Custom
- Step 2: Identity provider setup (paste metadata XML or configure manually):
  - SSO URL, Entity ID, Certificate
  - Test connection
- Step 3: Attribute mapping:
  - Email → user.email
  - Name → user.name
  - Role → user.role
- Step 4: User provisioning: JIT (Just-In-Time) vs SCIM
- Step 5: Test with one user
- Step 6: Enable for all users (toggle)
- Step 7: Force SSO (disable password login)

IP ALLOWLIST (collapsible section):
- "Add IP range" (CIDR notation: 192.168.1.0/24)
- "Block unrecognized IPs" toggle

SESSION POLICIES:
- Session timeout: 1h / 8h / 24h / 7d
- Idle timeout: 15m / 1h / 4h / 1d
- "Sign out all sessions" button (admin only)

==========================================================
ZONE 9 — BRANDING TAB (NEW — for white-label)
==========================================================

LAYOUT (live preview on right, config on left):

LEFT: CONFIG (--bg-elevated, p-32px):
- Company name (text)
- Logo upload (drag-drop, 256×256 recommended)
- Favicon upload
- Primary color (color picker)
- Accent color (color picker)
- Login background image upload
- Custom domain: "forge.example.com" + DNS instructions
- Email "from" name + reply-to
- Terms of service URL
- Privacy policy URL
- Support email
- Custom CSS (textarea, advanced)

RIGHT: LIVE PREVIEW:
- "How your workspace looks to users" card
- Mock login page with their logo + colors
- Mock dashboard tile with their brand
- Mock email header with their branding

"Save" button (sticky bottom)

==========================================================
ZONE 10 — BILLING TAB (NEW)
==========================================================

LAYOUT:

CURRENT PLAN: "Forge Pro · $49/month · 8 of 10 seats" + "Manage plan" button

USAGE THIS MONTH (4 KPI tiles):
- Active agents: 8 / 10 (with progress bar)
- Runs: 2,847 (with sparkline)
- LLM tokens: 1.2M (with progress bar to quota)
- Storage: 4.2 GB (with progress bar)

INVOICES list (last 12 months):
- Date + amount + status + "Download PDF" link

PAYMENT METHOD:
- Card on file (last 4 digits) + "Update" link

USAGE HISTORY (Recharts area chart):
- 12 months of usage by category

"Manage subscription" + "Cancel subscription" (rose, requires confirmation)

==========================================================
ZONE 11 — FEATURE FLAGS TAB (NEW)
==========================================================

LAYOUT (--bg-elevated, p-32px):

HEADER: h2 "Feature flags" + "Request feature" link
Body: "Enable beta features or opt out of experimental functionality."

LIST of feature flags:
- Each: lucide icon + flag name + description + toggle
  - Examples:
    - "Beta: New Co-pilot voice mode" (toggle, default off)
    - "Beta: Workflow visual editor v2" (toggle, default off)
    - "Experimental: forge-pi code-aware suggestions" (toggle, default on)
    - "Telemetry: Anonymous usage stats" (toggle, default on)
    - "AI: Multi-modal Co-pilot (image upload)" (toggle, default on)
  - Some flags are ROLLOUT % (slider 0-100%): "New dashboard rollout: 25% of users"

LABELS (tags): "Beta" (cyan) / "Experimental" (amber) / "Deprecated" (rose)

==========================================================
ZONE 12 — KEYBOARD SHORTCUTS TAB (NEW)
==========================================================

LAYOUT (--bg-elevated, p-32px):

HEADER: h2 "Keyboard shortcuts" + "Reset to defaults" button

LIST of shortcuts (grouped by category):
- Global: ⌘K (Command palette), ⌘J (Co-pilot), ⌘/ (Show shortcuts)
- Navigation: ⌘1-9 (Switch center), ⌘[ ] (Back/Forward)
- Dashboard: g d (Go to Dashboard), g c (Go to Co-pilot)
- Terminal: ⌘T (New session), ⌘⇧T (Close), ⌘L (Clear), ⌘⇧P (Command palette)
- Story management: s n (New story), s e (Edit), s d (Done)
- (Lots more — these use vim-style "g" + letter combos, like GitHub)

Each row:
- Action description (left) + kbd combo (right, styled with <kbd>)
- Click combo to edit (if customizable) or "View only"
- Search input at top: "Search shortcuts..."

"Printable cheatsheet" button → opens Dialog with all shortcuts in a copyable format

==========================================================
CONSTRAINTS
==========================================================

- All 10 new tabs must work end-to-end (no stubs)
- Mock OAuth/SSO/2FA flows (real backend integration later)
- Settings persist in backend (mock localStorage for now)
- All forms have validation + error states
- "Save" pattern: per-section dirty state + sticky save button
- All sensitive data (passwords, API keys, tokens) is masked by default
- Reveal action requires confirmation (security best practice)
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only
- Don't break existing 10 tabs

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/settings/
- 10 new tabs functional with realistic mock data
- 3-section sidebar organization (Account / Workspace / Enterprise)
- Profile editor with avatar upload
- 2FA setup wizard with QR code
- API token generation + copy flow
- Webhook creation + delivery log
- SSO configuration wizard
- Branding live preview
- Billing usage charts
- Feature flags toggle list
- Keyboard shortcut viewer
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep existing 10 tabs, keep the URL pattern /admin, keep the master-detail layout
- Build order: Profile → Sessions → Notifications → API Tokens → Webhooks → Connected Apps → SSO → Branding → Billing → Feature Flags → Keyboard Shortcuts