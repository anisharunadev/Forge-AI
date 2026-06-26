---
name: forge-pi-cluster-voice
description: Auto-group Zendesk / Jira Service Desk tickets by theme and surface top pain points.
package: "@forge-ai/forge-pi"
category: intelligence
icon: MessagesSquare
estimated-duration: 45
allowed-tools: forge-pi.customer_voice.cluster_customer_voice
requires:
  - tenant_id
  - project_id
---

# forge-pi-cluster-voice

Powers the Ideation Center "Customer Voice" tab. Returns `CustomerCluster[]`
— theme, ticket IDs, severity, optional related services.