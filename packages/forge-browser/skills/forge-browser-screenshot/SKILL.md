---
name: forge-browser-screenshot
description: Open a URL in the forge-browser session and capture a screenshot.
package: "@forge-ai/forge-browser"
category: verification
icon: Camera
estimated-duration: 30
allowed-tools: forge-browser.agent.capture_screenshot
requires:
  - tenant_id
  - project_id
  - url
---

# forge-browser-screenshot

Returns a `Screenshot` typed artifact. Use as a building block for
visual tests, UI reviews, and the "Open browser preview" button in
story detail.