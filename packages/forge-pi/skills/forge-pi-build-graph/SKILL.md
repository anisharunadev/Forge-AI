---
name: forge-pi-build-graph
description: Build the Forge knowledge graph — fuse code, tickets, and docs into one queryable graph for the active project.
package: "@forge-ai/forge-pi"
category: intelligence
icon: Network
estimated-duration: 120
allowed-tools: forge-pi.knowledge_graph.build_knowledge_graph
requires:
  - tenant_id
  - project_id
---

# forge-pi-build-graph

Builds a `KnowledgeGraph` carrying `tenant_id` and `project_id` on every
node and edge. Powers the React Flow knowledge-graph view in Project
Intelligence and the Co-pilot context resolver.

## When to invoke

- After a `forge-pi-scan` completes
- After a Jira sync lands new tickets
- On-demand from Command Center

## Output

`KnowledgeGraph` — nodes, edges, graph_id, built_at.