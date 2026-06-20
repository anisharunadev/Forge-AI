"""
Test suite for agents/cost (FORA-75, 0.6 Cost tracking).

Each test module is a standalone runner.  From the project root:

    python3 -m agents.cost.tests.test_ledger
    python3 -m agents.cost.tests.test_ceiling
    python3 -m agents.cost.tests.test_alerts
    python3 -m agents.cost.tests.test_gate
    python3 -m agents.cost.tests.test_board
    python3 -m agents.cost.tests.test_integration
    python3 -m agents.cost.tests.test_reconciliation

Each test prints `OK` or `FAIL` with a list of failures.  Evidence
artefacts are written to `agents/cost/evidence/<test>_<scenario>.json`.
"""
