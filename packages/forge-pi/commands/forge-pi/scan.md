# forge-pi-scan

> Invokable from any Forge surface. Triggers a `forge-pi` codebase scan
> against the active tenant/project and persists the `CodebaseScanResult`
> to Project Intelligence.

## Usage

```
/forge-pi-scan
/forge-pi-scan --paths apps/forge
```

## Implementation

```ts
import { scanCodebase } from '@forge-ai/forge-pi';
```