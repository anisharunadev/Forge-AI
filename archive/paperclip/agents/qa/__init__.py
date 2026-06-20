"""
QA Agent (FORA-20, FORA-43).

Stage 4 of the FORA SDLC pipeline. Sits between the Dev stage (PR
merged, CI green) and the Security stage. Produces a runnable test
suite for a merged PR and a coverage report, then hands off.

The v1 implementation is a deterministic scaffold:

    with QaAgent(...) as agent:
        result = agent.run(test_plan)

See `agents/qa/README.md` for the v1 contract and the v2 extension points.
"""
