---
name: forge-ns-manage
description: "config workspace | workstreams thread update ship inbox"
allowed-tools:
  - Read
  - Skill
---


Route to the appropriate management skill based on the user's intent.
`forge-config` (settings + advanced + integrations + profile) and `forge-workspace`
(new + list + remove) are post-#2790 consolidated entries.

| User wants | Invoke |
|---|---|
| Configure GSD settings (basic / advanced / integrations / profile) | forge-config |
| Manage workspaces (create / list / remove) | forge-workspace |
| Manage parallel workstreams | forge-workstreams |
| Continue work in a fresh context thread | forge-thread |
| Pause current work | forge-pause-work |
| Resume paused work | forge-resume-work |
| Update the GSD installation | forge-update |
| Ship completed work | forge-ship |
| Process inbox items | forge-inbox |
| Create a clean PR branch | forge-pr-branch |
| Undo the last GSD action | forge-undo |
| Archive accumulated phase directories | forge-cleanup |
| Diagnose planning directory health | forge-health |
| Open the interactive command center | forge-manager |
| Configure workflow toggles and model profile | forge-settings |
| Show project statistics | forge-stats |
| Toggle which skills are surfaced | forge-surface |
| Show the GSD command guide | forge-help |

Invoke the matched skill directly using the Skill tool.
