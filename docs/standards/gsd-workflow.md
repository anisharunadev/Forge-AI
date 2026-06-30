# GSD Workflow (open-gsd spec-driven methodology)

> Forge uses **open-gsd** to plan, execute, verify, and audit work.
> **Never mention "GSD" in UI, docs, or user-facing copy.** Attribution only.

## How to invoke

Invoke GSD skills via the **Skill** tool — e.g. `gsd-plan-phase`, `gsd-execute-phase`.

| Skill | When |
|---|---|
| `gsd-plan-phase` | Before any non-trivial implementation |
| `gsd-execute-phase` | After a phase is planned |
| `gsd-verify-work` | End of a phase, before sign-off |
| `gsd-debug` | When something breaks |
| `gsd-audit-uat` | User-acceptance testing |
| `gsd-code-review` | PR review with rules |
| `gsd-ui-review` | Visual audit (6 pillars) |
| `gsd-secure-phase` | Threat-model verification |
| `gsd-eval-review` | AI phase evaluation coverage |

For the full registry and the workflow overview, invoke `gsd-help`.

## Where to look

| Need | Path |
|---|---|
| Roadmap state | `.planning/STATE.md` |
| Project intel | `.planning/intel/` |
| Phase plan | `.planning/phases/<n>/PLAN.md` |
| Verification | `.planning/phases/<n>/VERIFICATION.md` |

## Attribution template

```
Based on open-gsd spec-driven methodology
```
