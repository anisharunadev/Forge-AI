"""
FORA Knowledge Layer lint gate (FORA-408, sub-goal 0.8.1).

The package exposes a pure-Python linter that enforces the production
bar from `workspace/README.md §3` (Related footer, no undefined
acronyms, no tribal-knowledge pointers, no vague hedges).

Import paths (do NOT eagerly import `lint` here — the CLI uses
`python -m agents.workspace.lint`, which would otherwise trigger a
double-import warning):

    from agents.workspace.lint import lint, LintReport, Violation

CLI:

    python -m agents.workspace.lint --root workspace/
    python -m agents.workspace.lint --root workspace/ --json
"""

__all__: list = []
