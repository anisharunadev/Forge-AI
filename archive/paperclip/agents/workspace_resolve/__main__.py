"""``python -m agents.workspace_resolve`` shim (FORA-411)."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())