"""Top-level ``agents`` package — F-501 Code Validator sub-graph.

This package is the home of the Code Validator sub-graph and is
INTENTIONALLY independent of ``backend.app.agents``. The sub-graph:

* has its own prompt templates (none — it is deterministic),
* has its own LiteLLM virtual key namespace,
* does NOT import from ``backend.app.agents.sdlc_agent``.

See ``code_validator.graph.build_code_validator_graph``.
"""
