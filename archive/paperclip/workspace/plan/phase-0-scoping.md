# Forge AI: Phase 0 - Project Intelligence Scoping

**Status:** Proposed
**Goal:** Implement the Project Intelligence Layer to ingest up to 20 repositories and generate the foundational Knowledge, Architecture, and Dependency graphs, without modifying or breaking any existing customer systems.

---

## 1. Objectives

As defined in the Master Development Charter, Phase 0 focuses entirely on **understanding before generating**. The goal is to build the ingestion and analysis pipelines that connect to a tenant's existing tools, extract context, and build an explorable graph of their software ecosystem.

- **Inputs:** GitHub/Bitbucket (Code), Jira (Tickets), Confluence (Docs).
- **Outputs:** Knowledge Graph, Architecture Graph, Dependency Graph.
- **Constraints:** 100% Read-Only. No writes to customer systems. Complete tenant isolation.

---

## 2. Architecture & Technical Approach

We will leverage the new Forge AI tech stack (Python 3.13, FastAPI, PostgreSQL 17, pgvector, LangGraph) to build the ingestion engine.

### 2.1 Ingestion Engine (The "Crawlers")
- **MCP Connectors:** We will use the existing MCP layer (or build new Python MCP clients) to securely connect to GitHub, Jira, and Confluence.
- **Worker Queues:** Background jobs will be dispatched to crawl repositories.
- **Chunking & Parsing:** Code and documentation will be parsed (e.g., using ASTs for code, Markdown parsers for Confluence) and chunked for LLM processing.

### 2.2 Graph Generation Pipeline (LangGraph)
- **Dependency Extractor Node:** Parses package managers (`package.json`, `requirements.txt`, `go.mod`) to build the deterministic **Dependency Graph**.
- **Architecture Extractor Node:** Uses LiteLLM (Anthropic/OpenAI) to analyze infrastructure files (Terraform, docker-compose) and code structure to deduce the **Architecture Graph** (e.g., Service A talks to Database B).
- **Knowledge Extractor Node:** Processes PR descriptions, Jira tickets, and Confluence pages to build the **Knowledge Graph** (mapping business terminology to code modules).

### 2.3 Storage Model (PostgreSQL 17 + pgvector)
We will not introduce a dedicated Graph Database yet to keep the stack simple (boring is correct).
- **Nodes Table:** `id`, `tenant_id`, `type` (repo, service, database, concept), `metadata` (JSONB), `embedding` (vector).
- **Edges Table:** `source_id`, `target_id`, `tenant_id`, `relationship_type` (depends_on, implements, documents).
- **Semantic Search:** `pgvector` will be used to quickly find relevant nodes based on natural language queries.

---

## 3. Milestones & Deliverables

### Milestone 1: Secure Ingestion Foundation
- Setup tenant-isolated background workers.
- Implement read-only MCP clients for GitHub.
- **Output:** Ability to clone/read 20 repositories into memory securely, chunk the files, and store raw text + embeddings in Postgres.

### Milestone 2: Deterministic Dependency Graph
- Implement parsers for common ecosystems (Node, Python, Go).
- Map internal repository dependencies and external library dependencies.
- **Output:** A queriable SQL-based Dependency Graph.

### Milestone 3: LLM-Powered Architecture & Knowledge Graphs
- Implement the LangGraph workflow to extract architecture from IaC and codebase structure.
- Integrate Jira/Confluence MCPs to link requirements/docs to code.
- **Output:** Rich JSONB nodes and edges representing the Architecture and Knowledge graphs.

### Milestone 4: Visualization
- Expose FastAPI endpoints for the graphs.
- Build the **Project Intelligence** view in the Next.js 15 frontend using `React Flow` to visualize the graphs.
- **Output:** A fully explorable UI for the customer to see their system.

---

## 4. Risk Mitigation (Ensuring we "affect nothing")

1. **Read-Only Credentials:** The MCP servers and integration roles will strictly require read-only access scopes.
2. **Resource Limits:** Ingestion will be rate-limited and chunked to prevent API rate-limit exhaustion on the customer's GitHub/Jira instances.
3. **Parallel Execution:** The Phase 0 ingestion engine will be built alongside the existing systems. It will operate in a new `forge-pi` (Project Intelligence) namespace/schema, ensuring zero interference with existing tables or workflows until ready to integrate.
