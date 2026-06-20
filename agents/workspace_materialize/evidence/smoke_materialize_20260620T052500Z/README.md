# FORA-409 / 0.8.3 — workspace:materialize smoke evidence

- started: `2026-06-20T05:25:00Z`
- finished: `2026-06-20T05:25:00Z`
- elapsed: `310 ms`

## AC summary

| AC | Result |
| --- | --- |
| `ac1_materialize_cold_start` | `ok=True, elapsed_s=0.31, files=50, chunks=65, duration_ms=309.3` |
| `ac2_tenant_tree_reads` | `ok=True, byte_identical=True` |
| `ac3_memory_index_primed` | `ok=True, facts=65, ns=memory:26, customer:18, project:21` |
| `ac4_subagent_recall_tenant_scoped` | `ok=True, files=50, top=customer/conventions.md` |
| `ac5_bootstrap_idempotent` | `ok=True, status=already_materialized` |
| `ac6_audit_row_appended` | `ok=True, op=materialize, slug=smoke-tenant, files=50` |
| `ac7_cli_entry_point` | `ok=True, exit=0, slug=cli-tenant, files=50` |

## Real-workspace run (FORA-409 evidence)

```text
slug:           demo-fora-409
files:          18
bytes:          173926
duration_ms:    2996.532
memory:         215 written, 0 updated, 215 chunks, 806.831 ms
tenant_ws:      tenants/demo-fora-409/workspace
```

The real seed (18 files) materializes in ~3s end-to-end with the
memory prime dominating (807ms inside the 3s total). The
50-file synthetic seed (acceptance bar) materializes in ~0.31s.

## Reproduction

```bash
PYTHONPATH=. python3 -m agents.workspace_materialize.smoke_test
PYTHONPATH=. python3 -c "
from agents.workspace_materialize import materialize
print(materialize('demo-fora-409').to_dict())
"
```

The smoke runs in a `tempfile.mkdtemp` so the real `tenants/`
tree and the real `var/memory.db` are never touched.
