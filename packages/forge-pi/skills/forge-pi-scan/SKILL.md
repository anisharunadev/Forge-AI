---
name: forge-pi-scan
description: Trigger a forge-pi codebase scan to discover services, dependencies, and secrets across the active project.
package: "@forge-ai/forge-pi"
category: intelligence
icon: ScanSearch
estimated-duration: 90
allowed-tools: forge-pi.scanner.scan_codebase
requires:
  - tenant_id
  - project_id
---

# forge-pi-scan

Maps the active codebase into typed `ScannedService` records. Output drives
the Project Intelligence layer (artifact tree, dependency graph, "Project at
a glance" panel).

## When to invoke

- A new project is ingested
- A new service lands in the repo
- Project Intelligence needs to refresh

## Inputs

- `tenant_id`, `project_id` (mandatory, Forge Rule 2)
- `paths` — optional sub-tree filter

## Output

`CodebaseScanResult` — services, dependencies, secrets count, detector health.

## Implementation

```ts
import { scanCodebase } from '@forge-ai/forge-pi';
const result = await scanCodebase({ tenant_id, project_id }, { paths });
```