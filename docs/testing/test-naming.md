# Forge AI — Test Naming Conventions

> Status: Phase 11 / T14
> Linked: `docs/testing/test-strategy.md`

## 1. Why naming matters

Tests are documentation. The next engineer will read your test name before they read the code it tests. Names should:

- Describe **behavior**, not implementation.
- Read like a sentence: "test that *when* this *then* that".
- Be searchable: include the unit under test.

## 2. File names

### Python (pytest)

```text
test_<unit>_<scenario>.py
```

| Pattern                                     | Example                                              |
|---------------------------------------------|------------------------------------------------------|
| `test_<unit>.py`                            | `test_cost_ledger.py`                                |
| `test_<unit>_<scenario>.py`                 | `test_cost_ledger_concurrent_writes.py`              |
| `test_<unit>_<integration>.py`              | `test_auth_keycloak_integration.py`                  |
| `tests/factories/<model>_factory.py`        | `tests/factories/user_factory.py`                    |
| `tests/fixtures/<scope>/<fixture>.py`       | `tests/fixtures/auth/oidc_id_token.py`               |

The `<unit>` should match the module under test. The `<scenario>` is optional — use it when the file covers one specific scenario in depth.

### TypeScript (vitest / Jest)

```text
<unit>.test.ts          # co-located, vitest default
<unit>.test.tsx
<unit>.spec.ts          # only for Playwright E2E
```

Examples:

- `apps/forge/lib/cost/ledger.ts` → `apps/forge/lib/cost/ledger.test.ts`
- `apps/forge/components/Terminal.test.tsx`
- `apps/forge/e2e/terminal.spec.ts`

### Playwright

```text
<feature>.spec.ts
<journey>.<context>.spec.ts
```

Examples:

- `e2e/auth/login.spec.ts`
- `e2e/agent/invoke.openai.spec.ts`

## 3. Test function names

### Python

```python
def test_<behavior>_when_<condition>_then_<result>():
    ...
```

Examples:

```python
def test_artifact_registry_supersede_when_active_artifact_exists_creates_new_version():
    ...

def test_cost_ledger_charge_when_insufficient_balance_raises_lease_exceeded():
    ...

def test_jwt_validator_when_signature_invalid_raises_401():
    ...
```

### TypeScript (vitest)

```typescript
describe('<unit>', () => {
  it('<behavior> when <condition> then <result>', () => { ... });
  it('should <behavior> when <condition>', () => { ... });
});
```

Examples:

```typescript
describe('CostLedger', () => {
  it('charges the tenant when the call succeeds', () => { ... });
  it('rolls back the charge when the tool errors', () => { ... });
});

describe('useTerminal', () => {
  it('opens a websocket when the user clicks connect', () => { ... });
  it('disconnects when the tab unmounts', () => { ... });
});
```

We accept both `it('does X')` and `it('should do X')`. We prefer the `when/then` form when the behavior is conditional.

## 4. Long test names are fine

A 100-character test name is fine if it is unambiguous. A 30-character test name is a smell. Do not abbreviate; do not collapse `when`s.

```python
# BAD
def test_user_login(): ...

# GOOD
def test_user_login_when_password_expired_then_redirects_to_reset():
    ...
```

## 5. Anti-patterns

| Anti-pattern                                       | Why it's bad                                |
|----------------------------------------------------|---------------------------------------------|
| `test_1`, `test_2`                                 | No signal                                   |
| `test_happy_path`                                  | Doesn't say which path, or what happy means|
| `test_edge_case`                                   | Same — which edge case?                     |
| `test_<unit>_v2`, `test_<unit>_new`                | Versioning belongs in git, not names        |
| Comments explaining what a test name says          | Fix the name                                |
| Tests named after the bug ticket                   | `test_FORA-1234` — describes nothing        |

## 6. Examples by surface

### Backend (Python)

```python
# backend/app/services/cost/ledger/tests.py

def test_cost_ledger_charge_when_amount_within_balance_decrements_balance():
    ...

def test_cost_ledger_charge_when_amount_exceeds_balance_raises_lease_exceeded():
    ...

def test_cost_ledger_refund_when_charge_exists_increments_balance_by_charge_amount():
    ...

def test_cost_ledger_refund_when_no_charge_exists_raises_unmatched_refund():
    ...

def test_cost_ledger_idempotency_when_same_idempotency_key_reused_does_not_double_charge():
    ...
```

### Frontend (TypeScript)

```typescript
// apps/forge/components/Terminal.test.tsx

describe('Terminal', () => {
  it('renders an xterm canvas when mounted', () => { ... });
  it('connects to the websocket when the user opens a tab', () => { ... });
  it('shows a connection error banner when the websocket 1006s', () => { ... });
  it('clears the buffer when the user clicks clear', () => { ... });
});
```

### Playwright

```typescript
// apps/forge/e2e/terminal.spec.ts

test('user can open a terminal, run ls, and see files', async ({ page }) => { ... });
test('user sees a permission error when the command escapes the workspace', async ({ page }) => { ... });
test('terminal buffers are not shared between two open tabs', async ({ page, context }) => { ... });
```

## 7. Migration

Existing tests that don't follow this convention should be renamed when they are next touched. We do not block on renaming en masse; the convention applies to **new** tests and **modified** tests.

The lint rules in `ruff` (N801, N802) and `eslint-plugin-vitest` (no `it.only` in committed code) help enforce these.
