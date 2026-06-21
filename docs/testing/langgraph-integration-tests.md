# Forge AI — LangGraph Integration Tests

> Status: Phase 11 / T14
> Linked: NFR-001 (reliability), NFR-018 (checkpoint durability), `docs/architecture/decisions/ADR-XXXX-langgraph.md`

This document describes how we test the LangGraph orchestration layer that powers agent loops, tool calls, and the human-in-the-loop approval gate. The graph itself is non-deterministic by design — we test the *invariants*, not the trace.

## 1. Goals

- **Determinism**: every test produces the same state transitions on every run.
- **Speed**: a full graph test should finish in < 1 s.
- **Coverage**: every node, every edge, every interrupt point is exercised.
- **Regression**: golden state transitions catch subtle semantic shifts.

## 2. Tooling

| Layer              | Tool                                                |
|--------------------|-----------------------------------------------------|
| Graph execution    | `langgraph` `CompiledGraph.invoke` / `.ainvoke`     |
| Async              | `pytest-asyncio` (mode = `auto`)                    |
| Checkpoint backend | `langgraph.checkpoint.aiosqlite.AioSqliteSaver` (in-memory for unit; file for integration) |
| Tool mocking       | `pytest-httpx`, custom fakes for MCP                |
| Snapshot           | `syrupy`                                            |
| Time               | `freezegun`                                         |

## 3. Layers of test

### 3.1 Pure node tests (cheapest, fastest)

Each node is a Python function. Test it as such.

```python
# backend/app/agents/langgraph/nodes/tests/test_summarize_node.py

async def test_summarize_node_when_input_under_4k_tokens_returns_input_unchanged():
    node = SummarizeNode(llm=fake_llm)
    state = GraphState(messages=[HumanMessage(content="hello")])
    result = await node(state)
    assert result.messages == state.messages
```

### 3.2 Subgraph tests

A subgraph is a small graph that takes a state and returns a state. Run it with the in-memory checkpointer.

```python
async def test_research_subgraph_when_search_returns_hits_appends_citations():
    fake_search = FakeSearchTool(hits=[Hit(...), Hit(...)])
    graph = build_research_subgraph(tools=[fake_search])
    saver = AioSqliteSaver.from_conn_string(":memory:")
    app = graph.compile(checkpointer=saver)

    config = {"configurable": {"thread_id": "t1"}}
    result = await app.ainvoke({"messages": [HumanMessage("find X")]}, config=config)

    assert any(m.type == "tool" for m in result["messages"])
```

### 3.3 End-to-end graph tests with mocked MCP

Mock every external tool. The graph does not know it is being mocked.

```python
@pytest.fixture
def fake_mcp_tool_bus():
    return FakeMcpBus({
        "gsd_wrapper.run": lambda args: {"stdout": "ok", "stderr": ""},
        "repomix_wrapper.pack": lambda args: {"path": "/tmp/out.txt"},
    })

async def test_main_graph_when_approval_required_pauses_at_interrupt(fake_mcp_tool_bus):
    graph = build_main_graph(tool_bus=fake_mcp_tool_bus)
    saver = AioSqliteSaver.from_conn_string(":memory:")
    app = graph.compile(checkpointer=saver, interrupt_before=["approval"])

    config = {"configurable": {"thread_id": "t2"}}
    out = await app.ainvoke({"messages": [HumanMessage("delete prod db")]}, config=config)

    # Graph paused before approval
    state = await app.aget_state(config)
    assert state.next == ("approval",)
    assert out["messages"][-1].content.startswith("This action requires approval")
```

### 3.4 State persistence tests

The checkpoint backend is real. We prove that re-invoking with the same `thread_id` resumes from where we left off.

```python
async def test_graph_when_invoked_twice_with_same_thread_id_resumes_from_checkpoint(tmp_path):
    db = tmp_path / "ckpt.sqlite"
    saver = AioSqliteSaver.from_conn_string(f"sqlite:///{db}")
    app = build_main_graph(tool_bus=fake_mcp_tool_bus).compile(checkpointer=saver)
    config = {"configurable": {"thread_id": "t3"}}

    # First turn — pause for approval
    await app.ainvoke({"messages": [HumanMessage("deploy to prod")]}, config=config)
    state = await app.aget_state(config)
    assert state.next == ("approval",)

    # Second turn — provide approval
    out = await app.ainvoke(
        {"messages": [HumanMessage(content="approve", name="user@forge.test")]},
        config=config,
    )

    # The graph should have resumed and completed the deploy node
    state = await app.aget_state(config)
    assert state.next == ()
    assert "deployment_url" in out
```

### 3.5 Snapshot regression

We snapshot *state transitions*, not exact token outputs. This makes snapshots robust to model changes but catches semantic regressions.

```python
async def test_main_graph_happy_path_snapshot(snapshot):
    out = await app.ainvoke({"messages": [HumanMessage("summarize the repo")]}, config=config)
    # Strip non-deterministic fields (timestamps, request ids)
    cleaned = strip_volatile_fields(out)
    snapshot.assert_match(cleaned)
```

Snapshots live in `__snapshots__/` next to the test file. They are reviewed in PR diffs like any other generated artifact.

## 4. What we *do not* mock

- The checkpointer. Always real (in-memory or file).
- The state schema (Pydantic models). Always real.
- The interrupt mechanism. Always real.
- The human-in-the-loop `Command(resume=...)` resume path. Always real.

If a test feels like it needs to mock the framework itself, the test is probably wrong — write the test at the level just below the framework.

## 5. Chaos / failure modes

We have a small set of "what if X" tests that prove the graph degrades safely.

```python
async def test_graph_when_llm_times_out_raises_recoverable_error_not_silent_corruption():
    with mock_llm(latency=timedelta(seconds=11), exception=httpx.TimeoutException):
        with pytest.raises(LlmTimeoutError) as exc:
            await app.ainvoke({"messages": [HumanMessage("...")]}, config=config)
    assert exc.value.recoverable is True

async def test_graph_when_mcp_tool_errors_records_error_in_state_and_continues():
    fake_mcp_tool_bus.set_error("gsd_wrapper.run", McpToolError("boom"))
    out = await app.ainvoke({"messages": [HumanMessage("run gsd")]}, config=config)
    assert any(m.type == "error" for m in out["messages"])

async def test_graph_when_two_concurrent_invokes_share_no_state():
    config_a = {"configurable": {"thread_id": "a"}}
    config_b = {"configurable": {"thread_id": "b"}}
    await asyncio.gather(
        app.ainvoke({"messages": [HumanMessage("from a")]}, config=config_a),
        app.ainvoke({"messages": [HumanMessage("from b")]}, config=config_b),
    )
    state_a = await app.aget_state(config_a)
    state_b = await app.aget_state(config_b)
    assert "from a" in state_a.values["messages"][0].content
    assert "from b" in state_b.values["messages"][0].content
```

## 6. Approval gate (NFR-018)

The approval gate is the *most tested* component in the system. Tests cover:

- Approval node pauses on every action in the `requires_approval` set.
- Rejection produces a `Command(resume="reject")` flow that stops the graph cleanly.
- Approval with a one-time token is single-use.
- Approval with a session-bound token is bound to the user.
- Two simultaneous approvals for different actions do not deadlock.
- Approval timeout cancels the graph and emits a metric.

## 7. Where these tests live

```
backend/app/agents/langgraph/
  nodes/
    summarize.py
    summarize_node_tests.py      # pure node tests
    approval.py
    approval_node_tests.py
  graphs/
    main.py
    tests/
      test_main_graph_happy.py
      test_main_graph_approval.py
      test_main_graph_chaos.py
      __snapshots__/
```

## 8. Anti-patterns

- Mocking `langgraph` itself.
- Comparing exact `AIMessage` content (non-deterministic).
- Sleeping in tests instead of using `freezegun`.
- Sharing one `thread_id` across tests (state leak).
- Asserting on tool-call IDs (non-deterministic; assert on `tool_call["name"]` and `tool_call["args"]` instead).
