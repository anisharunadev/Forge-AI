---
name: forge-browser-visual-test
description: Diff a URL against a baseline screenshot for visual regression detection.
package: "@forge-ai/forge-browser"
category: verification
icon: ImagePlus
estimated-duration: 60
allowed-tools: forge-browser.visual_test.run_visual_test
requires:
  - tenant_id
  - project_id
  - url
---

# forge-browser-visual-test

Drives the "Visual regression test" button on PRs in the ticket workflow.
Returns a `VisualDiff` with `pixel_diff_ratio` and differing region bboxes.