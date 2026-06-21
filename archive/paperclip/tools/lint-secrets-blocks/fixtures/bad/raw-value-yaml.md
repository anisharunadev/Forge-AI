# Bad fixture — raw value inside a secrets block

A `secrets:` block with a literal raw value is a violation.

```yaml
secrets:
  - name: gh_pat
    value: ghp_ABC123thisisnotarealtokenjustafixture
```
