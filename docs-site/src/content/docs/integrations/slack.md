---
title: Slack / Teams MCP
description: The Slack / Teams MCP server — OAuth 2.0, R/W. Notification, approval, status.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: mcp-servers/slack/
generator: readme
approval_required: false
---

The **Slack / Teams MCP server** is the seventh MCP integration. It's the communication surface — Forge AI posts notifications, asks for approvals, and surfaces run status.

## Auth

- **Flow:** OAuth 2.0
- **Per-tenant:** yes
- **Scopes:** `chat:write`, `chat:write.public`, `channels:read`, `groups:read`, `users:read`, `reactions:write`
- **Token storage:** AWS Secrets Manager at `fora/prod/<tenant-slug>/slack-bot-token`

### Bootstrap

1. Create a Slack app at <https://api.slack.com/apps>
2. Add the **Bot Token Scopes** listed above
3. Install the app to your workspace
4. Get the **Bot User OAuth Token** (`xoxb-...`)
5. Populate the secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id fora/prod/acme-corp/slack \
  --secret-string '{"bot_token":"xoxb-...","signing_secret":"...","default_channel":"#fora-runs"}'
```

## Tools

| Tool | Description | Risk |
| --- | --- | --- |
| `slack.post_message` | Post a message | medium |
| `slack.post_dm` | Send a DM to a user | medium |
| `slack.update_message` | Update a message | low |
| `slack.add_reaction` | Add an emoji reaction | low |
| `slack.request_approval` | Post a message with approve/decline buttons | high — gates the run |
| `slack.handle_approval` | Receive the user's response (webhook) | low |
| `slack.search_messages` | Search public channels | low |
| `slack.get_user` | Resolve a user by email | low |

## The approval flow

A stage that needs a human approval posts a message with **approve / decline** buttons:

```json
{
  "channel": "#fora-runs",
  "text": "🔔 *PRD approval needed* for `acme-corp/run-01HXYZ`",
  "blocks": [{
    "type": "section",
    "text": { "type": "mrkdwn", "text": "The BA agent has drafted a PRD. Please review and approve." }
  }, {
    "type": "actions",
    "elements": [
      { "type": "button", "text": { "type": "plain_text", "text": "Approve" }, "style": "primary", "action_id": "approve" },
      { "type": "button", "text": { "type": "plain_text", "text": "Decline" }, "style": "danger", "action_id": "decline" }
    ]
  }]
}
```

The user's click is delivered to the MCP server via a webhook; the orchestrator resumes the run.

## The notification contract

| Event | Channel | Format |
| --- | --- | --- |
| **Run started** | `#fora-runs` | `🚀 Run <id> started by <user>` |
| **Stage passed** | `#fora-runs` | `✅ <Stage> passed for run <id>` |
| **Stage failed** | `#fora-runs` | `❌ <Stage> failed for run <id>: <error>` |
| **Approval needed** | DM to the approver | `🔔 <Stage> needs your approval: <link>` |
| **Run closed** | `#fora-runs` | `🎉 Run <id> closed in <duration>` |
| **Incident** | `#inc-<id>` | `🚨 <severity>: <summary>` |

## The Teams variant

The same MCP server shape ships a Microsoft Teams adapter. The auth flow is OAuth 2.0 via the Bot Framework; the tools are 1:1 with the Slack tools.

## Where to next

- **[AWS →](/integrations/aws/)** — the previous MCP server.
- **[Integrations overview →](/integrations/)** — back to the list.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>mcp-servers/slack/README.md</code> + <code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
