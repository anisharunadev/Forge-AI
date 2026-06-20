"""``python -m agents.workspace_materialize`` entry point.

Thin shim that forwards to :func:`agents.workspace_materialize.cli.main`.
Kept separate from ``cli.py`` so the CLI function is still importable as
a library (for unit tests / cold-start hooks) while the
``python -m`` invocation dispatches correctly.

Usage:

    python -m agents.workspace_materialize --tenant acme
    python -m agents.workspace_materialize --tenant acme --no-prime-memory
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from .cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())