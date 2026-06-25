"""Forge integrations package.

Adapters to third-party systems. Each submodule follows the same
shape: a thin, async-first wrapper around the provider's HTTP API or
SDK, with graceful degradation and a Protocol-friendly factory for
testability.
"""