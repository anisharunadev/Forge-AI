# Bad fixture — a `secrets:` block with only `secret_ref` should pass

This file lives under `bad/` but the lint must NOT flag it. The
test asserts that the violation count is driven by the other
files in `bad/`, not by this one.

```yaml
secrets:
  - secret_ref: tenants/tnt_acme/secrets/gh_pat@latest
```
