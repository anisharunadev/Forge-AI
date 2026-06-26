---
name: forge-browser-ui-review
description: Run a multi-viewport UI review with responsive findings.
package: "@forge-ai/forge-browser"
category: review
icon: LayoutTemplate
estimated-duration: 90
allowed-tools: forge-browser.ui_review.review_ui
requires:
  - tenant_id
  - project_id
  - url
---

# forge-browser-ui-review

Captures the URL at mobile / tablet / desktop viewports and reports
findings (touch target sizes, contrast, overflow).