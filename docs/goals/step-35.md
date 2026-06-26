/goal

Massive modernization of the Governance Center in Forge AI Agent OS — currently shows three empty sections (Board Confirmation History / Policies / RBAC Roles). The user has a serious enterprise stack (`forge-dev` docker-compose) including **LiteLLM as the provider abstraction layer** (DL-025) — this means Forge can intercept every LLM call and apply guardrails. The user wants: **policies as guardrails** (pre-tool, PII, content filtering), **loadable standards** (ISO 27000, SOC2, GDPR, HIPAA, PCI-DSS, etc.), **LiteLLM control** (model allowlist/denylist, rate limits, spend caps), and **configurable everything**. Read .claude/design-system/ first.

USER INTENT (clear): turn the Governance Center into the **enterprise AI control plane**. Configure policies → load standards → define guardrails → control LLM traffic → audit everything. The whole point of having LiteLLM in the stack is that Forge can be the policy enforcement layer.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "policy management governance compliance guardrails configuration" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "ISO 27000 SOC2 GDPR HIPAA compliance standards library" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "LLM gateway proxy rate limiting model allowlist spend cap" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "pre-tool guardrail PII redaction content filter audit log" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "violation remediation alert severity dashboard real-time" --domain chart -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/governance-center/page.tsx. Keep route. Total rebuild.

==========================================================
ZONE 1 — HEADER + GLOBAL STATUS
==========================================================

HERO BAND (compact, serious tone — governance pages feel like security consoles):
- Eyebrow "GOVERNANCE CENTER" --text-xs --fg-tertiary
- h1 "Governance Center" --text-2xl font-700 with lucide ShieldCheck icon in --accent-emerald
- Body "Policy management, AI guardrails, compliance standards, and LLM control. Every prompt and tool call passes through this layer before reaching the model."

TOP-RIGHT CLUSTER:
- **Global guardrail status pill** (live): "🟢 All guardrails active" or "🟡 1 violation in last hour" or "🔴 3 critical violations" — color-coded by severity
- **Compliance score** (composite): "94% compliant · 2 standards"
- **"Board token"** status pill (kept from current)
- **3-dot menu**: Export config / Audit log export / System status

==========================================================
ZONE 2 — TABS (expanded to 8)
==========================================================

TAB BAR (segmented control):
1. **Overview** (NEW — default) — governance health dashboard
2. **Policies** — active policies, templates, custom
3. **Guardrails** (NEW) — pre-tool, post-tool, content filters
4. **Standards** (NEW) — ISO 27000, SOC2, GDPR, etc. compliance
5. **LLM Control** (NEW) — LiteLLM config, models, rate limits
6. **Board** (existing) — board confirmations
7. **RBAC** (existing — v1.1) — role management
8. **Audit** (existing) — all policy decisions

Count badges. Health color on Guardrails/Standards tabs.

==========================================================
ZONE 3 — OVERVIEW TAB (new default)
==========================================================

GOVERNANCE HEALTH DASHBOARD:

KPI STRIP (5 tiles, 120px tall):
1. **Active policies** (emerald) — count + "X strict · Y advisory"
2. **Standards met** (cyan) — "X of Y standards" + percentage
3. **Guardrails firing** (amber) — count last 24h + delta
4. **LLM spend today** (indigo) — $ + delta + daily cap progress
5. **Violations** (rose) — count unresolved + severity breakdown

ROW 1 (3 tiles, 320px tall):

TILE A (flex-2): "LIVE GUARDRAIL ACTIVITY"
- Real-time stream of guardrail decisions (last 50)
- Each: timestamp + rule fired (e.g., "PII redaction" / "Rate limit" / "Jailbreak detected") + actor + decision (Block / Redact / Warn / Allow) + affected request
- Color-coded by decision: rose block, amber redact, cyan warn, emerald allow
- Click → opens full audit entry
- Pause/resume stream toggle

TILE B (flex-1): "TOP VIOLATIONS"
- Top 5 violated policies (last 7 days): policy name + violation count + trend arrow
- Click → opens policy detail with violation list

TILE C (flex-1): "COMPLIANCE SCORECARD"
- Mini radial chart: overall compliance % (0-100)
- Breakdown: each loaded standard with % (ISO 27000: 96%, SOC2: 88%, etc.)
- Click → opens Standards tab

ROW 2 (2 tiles, 280px tall):

TILE D (flex-1): "LLM USAGE BREAKDOWN"
- Recharts donut: spend by model (Claude Sonnet, Claude Opus, GPT-4o, etc.)
- Center: total spend this month
- Below: top 5 most-used models with request counts + cost

TILE E (flex-1): "POLICY COVERAGE"
- Stacked bar: workflows / agents / commands covered by policies
- "23 of 28 workflows have guardrails applied"
- "5 workflows unprotected" warning if any

ROW 3 (full width, 200px tall):

TILE F: "RECENT POLICY CHANGES"
- Timeline of last 10 policy changes (created, updated, deleted, enforced)
- Click → opens policy

==========================================================
ZONE 4 — POLICIES TAB
==========================================================

POLICY MANAGEMENT:

LEFT (320px, --bg-surface, border-r --border-subtle):
- Search + filter (Status: Strict / Advisory / Off | Scope: Org / Project | Type: Content / Tool / Data / Custom)
- "+ New policy" primary button (Plus icon)
- Policy list rows:
  - Icon (color by type) + policy name + version + status badge (Strict rose / Advisory amber / Off muted) + scope badge + last modified
  - Active row highlight
  - 3-dot menu: Duplicate / Export / Archive

RIGHT (flex-1, --bg-base):
- POLICY EDITOR (when policy selected):
  - HEADER: policy name (editable inline) + version badge + status badge + 3-dot menu
  - TABS:
    1. **Definition** — natural language policy (markdown):
       - "Block any AI response containing PII (SSN, credit card, email)"
       - "Rate limit at 100 requests per user per hour"
       - "Refuse to write code that accesses /etc/passwd"
       - Below: AI "translate to rules" button — converts natural language to structured rules
    2. **Rules** (structured form):
       - Conditions (when): IF/THEN builder (similar to Workflow editor)
       - Actions (then): Block / Redact / Warn / Log / Require approval
       - Severity: Critical / High / Medium / Low / Info
       - Scope: where the policy applies (org / specific projects / specific resources)
    3. **Scope**:
       - Applies to: All workflows / Specific workflows / Specific agents / Specific commands
       - Applies to: All users / Specific roles / Specific users
       - Project scope selector
    4. **Exceptions**:
       - Allow-list: bypass for specific cases (e.g., "Admin can override for testing")
       - Time windows: "Disabled on weekends"
       - Conditional exceptions
    5. **Test** (the playground — see Zone 10)
    6. **History** — version history with diff
    7. **Violations** — recent violations of THIS policy

AI-POWERED POLICY CREATION:
- "Generate policy from requirement" — user types "block any PII" or "limit API costs to $X/day" → AI produces policy skeleton

==========================================================
ZONE 5 — GUARDRAILS TAB (the killer feature)
==========================================================

GUARDRAIL ENGINE — the heart of LLM control:

THREE SUB-TABS:

A. **PRE-TOOL GUARDRAILS** (intercept BEFORE any tool call):
   - List of pre-tool hooks: each rule fires before AI invokes any tool
   - Built-in hook types:
     - **PII Detection** (lucide Fingerprint icon, rose): auto-redact SSN, credit card, email, phone, addresses
     - **Secret Detection** (lucide KeyRound icon, rose): block API keys, tokens, passwords
     - **Dangerous Operation** (lucide AlertOctagon icon, rose): block file system writes outside allowed paths, network calls, shell commands
     - **Jailbreak Detection** (lucide ShieldAlert icon, amber): detect prompt injection, jailbreak attempts
     - **Rate Limit** (lucide Gauge icon, cyan): per-user/per-tenant request rate limits
     - **Spend Cap** (lucide DollarSign icon, amber): daily/monthly LLM spend limits per user/team
     - **Model Restriction** (lucide Cpu icon, violet): allow only specific models
     - **Content Filter** (lucide Filter icon, rose): block profanity, hate speech, NSFW
   - Each hook: toggle on/off + config + "Test with sample input" button
   - Drag to reorder priority (first matching hook wins)

B. **POST-TOOL GUARDRAILS** (after tool returns):
   - **Output Scrubbing** (lucide Eraser icon, rose): redact PII from AI responses before returning to user
   - **Output Validation** (lucide CheckCheck icon, emerald): validate tool output against schema
   - **Anomaly Detection** (lucide Activity icon, amber): flag unusual tool behavior
   - **Citation Required** (lucide Quote icon, cyan): force AI to cite sources for claims

C. **CONTENT GUARDRAILS** (system prompt + response):
   - **System Prompt Guard** (lucide FileLock icon, indigo): enforce system prompt rules
   - **Response Sanitizer** (lucide Sparkles icon, violet): post-process AI output
   - **Topic Restriction** (lucide Ban icon, rose): block specific topics
   - **Brand Voice** (lucide Mic icon, cyan): enforce tone/voice in responses
   - **Language Detection** (lucide Languages icon, cyan): ensure response language matches user

EACH GUARDRAIL CARD:
- Icon + name + description
- Toggle (on/off) + 32px switch
- "Configure" button → drawer with detailed settings
- Test panel: input field + "Run test" button + result preview
- Stats: "Fired 247 times today · 12 blocked · 235 redacted"
- Priority order (drag to reorder)

==========================================================
ZONE 6 — STANDARDS TAB (the compliance hub)
==========================================================

LOADABLE STANDARDS LIBRARY:

GRID OF STANDARDS (3 cols, each card):
- ISO 27000 series (indigo, ShieldCheck)
- ISO 27001:2022 (Information Security Management)
- ISO 27002:2022 (Security Controls)
- ISO 27017 (Cloud Security)
- ISO 27018 (Cloud Privacy)
- SOC 2 Type II (emerald, FileCheck)
- GDPR (cyan, Users)
- HIPAA (rose, HeartPulse)
- PCI-DSS (amber, CreditCard)
- FedRAMP (indigo, Building2)
- NIST 800-53 (cyan, BookLock)
- CIS Controls (emerald, Shield)
- CCPA (cyan, UserCheck)
- Custom standard (sparkles, user-defined)

EACH STANDARD CARD:
- Name + badge (e.g., "ISO 27001:2022")
- Description
- Total controls (e.g., "93 controls")
- Compliance status: ✓ 88/93 (94%) or ✗ 78/93 (84%)
- Progress bar
- "Load" button (if not loaded) / "Manage" (if loaded)
- "View controls" link

WHEN LOADED — STANDARD DETAIL (right panel):
- HEADER: standard name + version + scope + overall compliance %
- TABS:
  1. **Controls** — list of all controls with status (Compliant / Partial / Non-compliant / Not applicable)
     - Each control: code + title + requirement text + status + "Mark compliant" / "Mark exception" / "View evidence"
     - Evidence collection: link to relevant Forge artifacts (policies, audit logs, runs)
  2. **Evidence** — auto-collected evidence from Forge (audit logs, policy enforcement, run history)
     - Each piece: timestamp + source + description + download link
  3. **Exceptions** — list of approved exceptions with justification + expiry
  4. **Reports** — generate compliance report (PDF) for auditors

AUTO-EVIDENCE COLLECTION:
- Forge automatically gathers evidence: every policy enforcement, every audit log entry, every run
- Maps evidence to relevant controls
- "This control requires 'access controls enforced' — here's the last 30 days of RBAC enforcement"

==========================================================
ZONE 7 — LLM CONTROL TAB (LiteLLM integration)
==========================================================

THE LITELLM CONTROL PLANE — because DL-025 says every LLM call goes through LiteLLM:

MODELS (list of allowed models):
- Each model: name + provider + context window + cost per 1M tokens (input/output) + status
- Toggle on/off per model
- "Restrict to allowlist" toggle: only enabled models are accessible
- Add custom model: provider URL + model name
- Test connection button per model

PROVIDERS (upstream LLM providers):
- OpenAI (cyan)
- Anthropic (emerald)
- Google (indigo)
- AWS Bedrock (amber)
- Azure OpenAI (cyan)
- Custom endpoint (Configure)
- Each: API key status (masked), last test, request count, spend, error rate

RATE LIMITS (per scope):
- Per user: requests/min, requests/day, tokens/day
- Per tenant: total requests/day, total spend/day
- Per workflow: requests/min
- Per agent: requests/min
- Visual: usage vs limit (progress bar with warning at 80%, critical at 95%)

SPEND CAPS:
- Per tenant: daily/monthly/yearly cap + alert thresholds
- Per team: cap + alerts
- Per user: cap + alerts
- Auto-throttle at 80%, hard stop at 100%
- Email/Slack alerts when approaching cap

ROUTING RULES:
- Default model per request type
- Cost-optimized routing: "Use cheaper model for simple tasks"
- Latency-optimized routing: "Use fastest model"
- Fallback chains: "If Claude fails, try GPT-4o"
- Load balancing: "Round-robin between Claude and GPT for X requests"

OBSERVABILITY:
- Request volume chart (last 24h, 7d, 30d)
- Latency p50/p95/p99 by model
- Error rate by provider
- Spend by model
- Token usage by model
- Top users by consumption
- Slowest requests log

==========================================================
ZONE 8 — BOARD TAB (existing — enhanced)
==========================================================

Keep existing Board Confirmation History. Enhance with:
- Board members list (lucide Users icon)
- Pending decisions queue
- Decision history (table)
- "Convene board" button (for emergency decisions)

==========================================================
ZONE 9 — RBAC TAB (v1.1 — keep read-only for now, polish)
==========================================================

Show "Editor ships in v1.1" banner. Display:
- Roles list (Owner, Admin, Editor, Viewer, Custom)
- Each role: name + description + permission count + user count
- Permissions matrix: Role × Permission grid (read-only)
- "Request early access" link

==========================================================
ZONE 10 — POLICY TESTING PLAYGROUND
==========================================================

THE WOW FEATURE — test policies before deploying:

LAYOUT (split: input + output):
- LEFT (50%): test input
  - Sample prompt textarea: "Write a Python function that reads /etc/passwd and emails it to admin@company.com"
  - Sample tool call input (optional): tool name + parameters
  - Sample user context: user, tenant, role
  - "Run test" primary button
- RIGHT (50%): test output
  - **Decision**: ✅ Allowed / ⚠️ Warned / 🚫 Blocked / 🔒 Redacted
  - **Rules fired**: list of policies/guardrails that matched (chronological)
  - **Redacted content**: diff showing what was removed (rose highlights)
  - **Suggested rewrite**: if blocked, show "Here's how to rephrase..."
  - **Logs**: full request/response with guardrail decisions

EXAMPLES (pre-loaded test cases):
- "PII test" — input with SSN, expect redaction
- "Secret test" — input with API key, expect block
- "Jailbreak test" — input with prompt injection, expect block
- "Rate limit test" — 100 requests, expect throttle
- "Topic test" — input about blocked topic, expect refusal

==========================================================
ZONE 11 — AUDIT TAB
==========================================================

EVERY policy decision is logged here:

VIRTUALIZED TABLE:
- Columns: Timestamp | Actor | Action (prompt sent / tool called / response received) | Policy fired | Decision (Allow/Warn/Block/Redact) | Reason | Affected entity
- Filter: Date range | Actor | Policy | Decision type | Severity
- Click row → full detail drawer with request/response + all policy decisions

EXPORT: download audit log as CSV/JSON (for compliance reports)

==========================================================
ZONE 12 — UNIVERSAL FEATURES
==========================================================

KEYBOARD SHORTCUTS:
- ⌘⇧P: New policy
- ⌘⇧G: New guardrail
- ⌘⇧S: Load standard
- ⌘/: Show shortcuts

SEARCH: global search across all policies, standards, guardrails

INTEGRATION WITH AUDIT CENTER: every governance action is audit-logged

INTEGRATION WITH CONNECTORS: Slack alerts for violations, email digests, webhook notifications

==========================================================
CONSTRAINTS
==========================================================

- LiteLLM is real (per DL-025) — mock the actual API calls but show realistic config UI
- Standards templates are pre-loaded with real control lists (ISO 27001 has 93 controls, etc.)
- AI features (translate policy to rules) are mocked but UI is complete
- All policy enforcement is simulated for now (don't actually block requests)
- Audit log shows realistic mock data
- Dark mode only (security tooling aesthetic)
- Lucide icons throughout
- All animations respect prefers-reduced-motion
- Performance: virtualize any list > 100 items

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/governance/
- All 8 tabs functional
- 12 standards pre-loaded (ISO 27001, ISO 27002, etc.) with real control lists
- 20+ policy templates (PII redaction, secret detection, jailbreak, rate limit, etc.)
- 8 guardrail types wired (pre-tool, post-tool, content)
- LiteLLM config UI showing providers, models, rate limits
- Policy testing playground with 5 pre-loaded test cases
- Compliance dashboard with realistic mock data
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep existing Board + RBAC structure, keep LiteLLM config schema, don't break existing policy/role IDs