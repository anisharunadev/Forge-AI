# Bad fixture — fenced block labelled `secrets`

A fenced code block with the label `secrets` is a secrets block,
and any value on a raw-value key is a violation.

```secrets
gh_pat: ghp_XYZ987anotherfixturevalue
webhook: https://hooks.slack.com/services/AAAA/BBBB/CCCC
```

A regular yaml block (no `secrets` label) with the same content
is NOT a violation — the lint only flags secrets blocks.
