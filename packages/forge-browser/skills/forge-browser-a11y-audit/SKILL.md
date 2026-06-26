---
name: forge-browser-a11y-audit
description: Run a WCAG accessibility audit against a URL.
package: "@forge-ai/forge-browser"
category: review
icon: Accessibility
estimated-duration: 90
allowed-tools: forge-browser.a11y.audit_accessibility
requires:
  - tenant_id
  - project_id
  - url
---

# forge-browser-a11y-audit

Returns an `A11yAudit` (level A / AA / AAA) — findings, severity, CSS
selector, help URL. Drives `forge-audit-uat`'s visual UAT mode.