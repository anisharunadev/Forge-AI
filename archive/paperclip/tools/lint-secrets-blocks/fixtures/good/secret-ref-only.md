# Good fixture — secrets block uses secret_ref

A `secrets:` block that only references `secret_ref` is allowed.

```yaml
secrets:
  - name: gh_pat
    secret_ref: tenants/tnt_acme/secrets/gh_pat@latest
  - name: webhook
    secret_ref: tenants/tnt_acme/secrets/slack_webhook
```

A nested mapping is also allowed when the inner value carries the
`secret_ref`:

```yaml
secrets:
  gh_pat:
    secret_ref: tenants/tnt_acme/secrets/gh_pat@latest
  webhook:
    secret_ref: tenants/tnt_acme/secrets/slack_webhook
```

A bare `secrets:` key in a non-fenced YAML block (e.g. inside a
markdown body without a fence) is treated as a secrets block but
its values still need to be `secret_ref` references:

```yaml
secrets:
  - secret_ref: tenants/tnt_acme/secrets/gh_pat@latest
```
