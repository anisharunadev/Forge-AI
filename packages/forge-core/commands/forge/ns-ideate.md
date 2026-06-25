---
name: forge-ideate
description: "exploration capture | explore sketch spike spec capture"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
requires: [capture, explore, sketch, spike, spec-phase]
---

Route to the appropriate exploration / capture skill based on the user's intent.
`forge-note`, `forge-add-todo`, `forge-add-backlog`, and `forge-plant-seed` were folded
into `forge-capture` (with `--note`, default, `--backlog`, `--seed` modes) by
#2790. The capture target lists pending todos via `--list`.

| User wants | Invoke |
|---|---|
| Explore an idea or opportunity | forge-explore |
| Sketch out a rough design or plan | forge-sketch |
| Time-boxed technical spike | forge-spike |
| Write a spec for a phase | forge-spec-phase |
| Capture a thought (todo / note / backlog / seed) | forge-capture |

Invoke the matched skill directly using the Skill tool.
