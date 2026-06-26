---
name: forge-pi-market-signals
description: Pull from configured sources, extract market signals, and match them to the current project.
package: "@forge-ai/forge-pi"
category: intelligence
icon: Radar
estimated-duration: 60
allowed-tools: forge-pi.market_signals.extract_market_signals
requires:
  - tenant_id
  - project_id
---

# forge-pi-market-signals

Powers the Ideation Center "Market Signals" tab. Returns `MarketSignal[]`
with source, title, relevance, impact score.