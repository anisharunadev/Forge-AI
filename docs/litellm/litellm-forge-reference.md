# LiteLLM API Reference — Forge AI Integration

> **Source:** [`https://litellm-api.up.railway.app/`](https://litellm-api.up.railway.app/)  
> **Spec:** OpenAPI 3.1.0 · version `1.82.6`  
> **Coverage:** 637 endpoints across 25 domains (from 703 total)

---

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐
│   Forge AI UI   │ →  │  Forge Backend   │ →  │  LiteLLM Proxy         │
│   (Next.js)     │    │  (Node/Python)   │    │  litellm-api.up.       │
│                 │ ←  │                  │ ←  │  railway.app           │
└─────────────────┘    └──────────────────┘    └────────────────────────┘
                              │                          │
                              ↓                          ↓
                       Postgres · Redis           100+ LLM Providers
                       Forge DB                   OpenAI, Anthropic, ...
```

**Forge AI UI** never calls LiteLLM directly. All requests flow through the **Forge Backend**, which:

1. Authenticates the user (Forge session)
2. Selects the appropriate LiteLLM virtual key (per-user / per-team / per-agent)
3. Applies Forge-level policy + audit logging
4. Streams the response back to Forge UI

---

## Domain Index

| # | Domain | Endpoints | Priority for Forge |
|---|--------|-----------|---------------------|
| 1 | LLM Chat & Completion | 31 | P0 — critical |
| 2 | Models & Registry | 15 | P0 — critical |
| 3 | Skills (Agent Skills Registry) | 4 | P0 — critical (new feature) |
| 4 | MCP (Model Context Protocol) | 36 | P0 — critical |
| 5 | Guardrails | 24 | P0 — critical |
| 6 | Policies | 30 | P0 — critical |
| 7 | Prompts | 9 | P1 — high |
| 8 | Tools Registry | 7 | P1 — high |
| 9 | Virtual Keys & Auth | 17 | P0 — critical |
| 10 | Spend / Budget / Cost | 15 | P0 — critical |
| 11 | Audit / Logs / Health | 16 | P1 — high |
| 12 | Provider Pass-through | 94 | P1 — high |
| 13 | Embeddings / RAG / Vector Stores | 55 | P1 — high |
| 14 | Users / Teams / Orgs / Projects | 54 | P1 — high |
| 15 | Cache | 7 | P2 — medium |
| 16 | Credentials | 6 | P2 — medium |
| 17 | Settings & UI Config | 18 | P2 — medium |
| 18 | Access Control & Tags | 29 | P1 — high |
| 19 | OAuth / SCIM / OIDC | 33 | P2 — medium |
| 20 | A2A / Realtime / Cursor | 17 | P2 — medium |
| 21 | Public Endpoints | 12 | P3 — low |
| 22 | Claude Code Plugins | 7 | P2 — medium |
| 23 | Assistants / Threads | 11 | P3 — low |
| 24 | Files / Batches / Evals / Videos / Containers | 74 | P2 — medium |
| 25 | Router & Misc | 16 | P3 — low |

---


## LLM Chat & Completion

**Endpoints:** 31 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/chat/completions` | Chat Completion |
| `POST` | `/completions` | Completion |
| `GET` | `/models` | Model List |
| `GET` | `/models/{model_id}` | Model Info |
| `POST` | `/models/{model_name}:countTokens` | Google Count Tokens |
| `POST` | `/models/{model_name}:generateContent` | Google Generate Content |
| `POST` | `/models/{model_name}:streamGenerateContent` | Google Stream Generate Content |
| `GET` | `/responses` | WebSocket: responses_websocket_endpoint |
| `POST` | `/responses/compact` | Compact Response |
| `DELETE` | `/responses/{response_id}` | Delete Response |
| `GET` | `/responses/{response_id}` | Get Response |
| `POST` | `/responses/{response_id}/cancel` | Cancel Response |
| `GET` | `/responses/{response_id}/input_items` | Get Response Input Items |
| `POST` | `/v1/audio/speech` | Audio Speech |
| `POST` | `/v1/audio/transcriptions` | Audio Transcriptions |
| `POST` | `/v1/chat/completions` | Chat Completion |
| `POST` | `/v1/completions` | Completion |
| `POST` | `/v1/messages` | Anthropic Response |
| `POST` | `/v1/messages/count_tokens` | Count Tokens |
| `GET` | `/v1/models` | Model List |
| `GET` | `/v1/models/{model_id}` | Model Info |
| `GET` | `/v1/responses` | WebSocket: responses_websocket_endpoint |
| `POST` | `/v1/responses/compact` | Compact Response |
| `DELETE` | `/v1/responses/{response_id}` | Delete Response |
| `GET` | `/v1/responses/{response_id}` | Get Response |
| `POST` | `/v1/responses/{response_id}/cancel` | Cancel Response |
| `GET` | `/v1/responses/{response_id}/input_items` | Get Response Input Items |
| `POST` | `/v1beta/interactions` | Create Interaction |
| `DELETE` | `/v1beta/interactions/{interaction_id}` | Delete Interaction |
| `GET` | `/v1beta/interactions/{interaction_id}` | Get Interaction |
| `POST` | `/v1beta/interactions/{interaction_id}/cancel` | Cancel Interaction |


## Models & Registry

**Endpoints:** 15 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/model/delete` | Delete Model |
| `GET` | `/model/info` | Model Info V1 |
| `POST` | `/model/new` | Add New Model |
| `POST` | `/model/update` | Update Model |
| `PATCH` | `/model/{model_id}/update` | Patch Model |
| `GET` | `/model_group/info` | Model Group Info |
| `POST` | `/model_group/make_public` | Update Public Model Groups |
| `GET` | `/models` | Model List |
| `GET` | `/models/{model_id}` | Model Info |
| `POST` | `/models/{model_name}:countTokens` | Google Count Tokens |
| `POST` | `/models/{model_name}:generateContent` | Google Generate Content |
| `POST` | `/models/{model_name}:streamGenerateContent` | Google Stream Generate Content |
| `GET` | `/v1/model/info` | Model Info V1 |
| `GET` | `/v1/models` | Model List |
| `GET` | `/v1/models/{model_id}` | Model Info |


## Skills (Agent Skills Registry)

**Endpoints:** 4 · **Priority:** P0 — critical (new feature)

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/v1/skills` | List Skills |
| `POST` | `/v1/skills` | Create Skill |
| `DELETE` | `/v1/skills/{skill_id}` | Delete Skill |
| `GET` | `/v1/skills/{skill_id}` | Get Skill |


## MCP (Model Context Protocol)

**Endpoints:** 36 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/mcp-rest/test/connection` | Test Connection |
| `POST` | `/mcp-rest/test/tools/list` | Test Tools List |
| `POST` | `/mcp-rest/tools/call` | Call Tool Rest Api |
| `GET` | `/mcp-rest/tools/list` | List Tool Rest Api |
| `GET` | `/v1/mcp/access_groups` | Get Mcp Access Groups |
| `GET` | `/v1/mcp/discover` | Discover Mcp Servers |
| `POST` | `/v1/mcp/make_public` | Make Mcp Servers Public |
| `GET` | `/v1/mcp/network/client-ip` | Get Client Ip |
| `GET` | `/v1/mcp/openapi-registry` | Get Openapi Registry |
| `GET` | `/v1/mcp/registry.json` | Get Mcp Registry |
| `GET` | `/v1/mcp/server` | Fetch All Mcp Servers |
| `POST` | `/v1/mcp/server` | Add Mcp Server |
| `PUT` | `/v1/mcp/server` | Edit Mcp Server |
| `GET` | `/v1/mcp/server/health` | Health Check Servers |
| `POST` | `/v1/mcp/server/oauth/session` | Add Session Mcp Server |
| `POST` | `/v1/mcp/server/register` | Register Mcp Server |
| `GET` | `/v1/mcp/server/submissions` | Get Mcp Server Submissions |
| `DELETE` | `/v1/mcp/server/{server_id}` | Remove Mcp Server |
| `GET` | `/v1/mcp/server/{server_id}` | Fetch Mcp Server |
| `PUT` | `/v1/mcp/server/{server_id}/approve` | Approve Mcp Server Submission |
| `DELETE` | `/v1/mcp/server/{server_id}/oauth-user-credential` | Delete Mcp Oauth User Credential |
| `POST` | `/v1/mcp/server/{server_id}/oauth-user-credential` | Store Mcp Oauth User Credential |
| `GET` | `/v1/mcp/server/{server_id}/oauth-user-credential/status` | Get Mcp Oauth User Credential Status |
| `PUT` | `/v1/mcp/server/{server_id}/reject` | Reject Mcp Server Submission |
| `DELETE` | `/v1/mcp/server/{server_id}/user-credential` | Delete Mcp User Credential |
| `POST` | `/v1/mcp/server/{server_id}/user-credential` | Store Mcp User Credential |
| `GET` | `/v1/mcp/tools` | Get Mcp Tools |
| `GET` | `/v1/mcp/user-credentials` | List Mcp User Credentials |
| `GET` | `/{mcp_server_name}/authorize` | Authorize |
| `DELETE` | `/{mcp_server_name}/mcp` | Dynamic Mcp Route |
| `GET` | `/{mcp_server_name}/mcp` | Dynamic Mcp Route |
| `PATCH` | `/{mcp_server_name}/mcp` | Dynamic Mcp Route |
| `POST` | `/{mcp_server_name}/mcp` | Dynamic Mcp Route |
| `PUT` | `/{mcp_server_name}/mcp` | Dynamic Mcp Route |
| `POST` | `/{mcp_server_name}/register` | Register Client |
| `POST` | `/{mcp_server_name}/token` | Token Endpoint |


## Guardrails

**Endpoints:** 24 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/apply_guardrail` | Apply Guardrail |
| `POST` | `/guardrails` | Create Guardrail |
| `POST` | `/guardrails/apply_guardrail` | Apply Guardrail |
| `GET` | `/guardrails/list` | List Guardrails |
| `POST` | `/guardrails/register` | Register Guardrail |
| `GET` | `/guardrails/submissions` | List Guardrail Submissions |
| `GET` | `/guardrails/submissions/{guardrail_id}` | Get Guardrail Submission |
| `POST` | `/guardrails/submissions/{guardrail_id}/approve` | Approve Guardrail Submission |
| `POST` | `/guardrails/submissions/{guardrail_id}/reject` | Reject Guardrail Submission |
| `POST` | `/guardrails/test_custom_code` | Test Custom Code Guardrail |
| `GET` | `/guardrails/ui/add_guardrail_settings` | Get Guardrail Ui Settings |
| `GET` | `/guardrails/ui/category_yaml/{category_name}` | Get Category Yaml |
| `GET` | `/guardrails/ui/major_airlines` | Get Major Airlines |
| `GET` | `/guardrails/ui/provider_specific_params` | Get Provider Specific Params |
| `GET` | `/guardrails/usage/detail/{guardrail_id}` | Guardrails Usage Detail |
| `GET` | `/guardrails/usage/logs` | Guardrails Usage Logs |
| `GET` | `/guardrails/usage/overview` | Guardrails Usage Overview |
| `POST` | `/guardrails/validate_blocked_words_file` | Validate Blocked Words File |
| `DELETE` | `/guardrails/{guardrail_id}` | Delete Guardrail |
| `GET` | `/guardrails/{guardrail_id}` | Get Guardrail Info |
| `PATCH` | `/guardrails/{guardrail_id}` | Patch Guardrail |
| `PUT` | `/guardrails/{guardrail_id}` | Update Guardrail |
| `GET` | `/guardrails/{guardrail_id}/info` | Get Guardrail Info |
| `GET` | `/v2/guardrails/list` | List Guardrails V2 |


## Policies

**Endpoints:** 30 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/policies` | Create Policy |
| `POST` | `/policies/attachments` | Create Policy Attachment |
| `POST` | `/policies/attachments/estimate-impact` | Estimate Attachment Impact |
| `GET` | `/policies/attachments/list` | List Policy Attachments |
| `DELETE` | `/policies/attachments/{attachment_id}` | Delete Policy Attachment |
| `GET` | `/policies/attachments/{attachment_id}` | Get Policy Attachment |
| `GET` | `/policies/compare` | Compare Policy Versions |
| `GET` | `/policies/list` | List Policies |
| `DELETE` | `/policies/name/{policy_name}/all-versions` | Delete All Policy Versions |
| `GET` | `/policies/name/{policy_name}/versions` | List Policy Versions |
| `POST` | `/policies/name/{policy_name}/versions` | Create Policy Version |
| `POST` | `/policies/resolve` | Resolve Policies For Context |
| `POST` | `/policies/test-pipeline` | Test Pipeline |
| `GET` | `/policies/usage/overview` | Policies Usage Overview |
| `DELETE` | `/policies/{policy_id}` | Delete Policy |
| `GET` | `/policies/{policy_id}` | Get Policy |
| `PUT` | `/policies/{policy_id}` | Update Policy |
| `GET` | `/policies/{policy_id}/resolved-guardrails` | Get Resolved Guardrails |
| `PUT` | `/policies/{policy_id}/status` | Update Policy Version Status |
| `GET` | `/policy/info/{policy_name}` | Get Policy Info |
| `GET` | `/policy/list` | List Policies |
| `GET` | `/policy/templates` | Get Policy Templates |
| `POST` | `/policy/templates/enrich` | Enrich Policy Template |
| `POST` | `/policy/templates/enrich/stream` | Enrich Policy Template Stream |
| `POST` | `/policy/templates/suggest` | Suggest Policy Templates |
| `POST` | `/policy/templates/test` | Test Policy Template |
| `POST` | `/policy/test` | Test Policy Matching |
| `POST` | `/policy/validate` | Validate Policy |
| `POST` | `/v1/tool/policy` | Update Tool Policy |
| `GET` | `/v1/tool/policy/options` | Get Tool Policy Options |


## Prompts

**Endpoints:** 9 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/prompts` | Create Prompt |
| `GET` | `/prompts/list` | List Prompts |
| `POST` | `/prompts/test` | Test Prompt |
| `DELETE` | `/prompts/{prompt_id}` | Delete Prompt |
| `GET` | `/prompts/{prompt_id}` | Get Prompt Info |
| `PATCH` | `/prompts/{prompt_id}` | Patch Prompt |
| `PUT` | `/prompts/{prompt_id}` | Update Prompt |
| `GET` | `/prompts/{prompt_id}/info` | Get Prompt Info |
| `GET` | `/prompts/{prompt_id}/versions` | Get Prompt Versions |


## Tools Registry

**Endpoints:** 7 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/v1/tool/list` | List Tools |
| `POST` | `/v1/tool/policy` | Update Tool Policy |
| `GET` | `/v1/tool/policy/options` | Get Tool Policy Options |
| `GET` | `/v1/tool/{tool_name}` | Get Tool |
| `GET` | `/v1/tool/{tool_name}/detail` | Get Tool Detail |
| `GET` | `/v1/tool/{tool_name}/logs` | Get Tool Usage Logs |
| `DELETE` | `/v1/tool/{tool_name}/overrides` | Delete Tool Policy Override |


## Virtual Keys & Auth

**Endpoints:** 17 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/authorize` | Authorize |
| `GET` | `/key/aliases` | Key Aliases |
| `POST` | `/key/block` | Block Key |
| `POST` | `/key/bulk_update` | Bulk Update Keys |
| `POST` | `/key/delete` | Delete Key Fn |
| `POST` | `/key/generate` | Generate Key Fn |
| `POST` | `/key/health` | Key Health |
| `GET` | `/key/info` | Info Key Fn |
| `GET` | `/key/list` | List Keys |
| `POST` | `/key/regenerate` | Regenerate Key Fn |
| `POST` | `/key/service-account/generate` | Generate Service Account Key Fn |
| `POST` | `/key/unblock` | Unblock Key |
| `POST` | `/key/update` | Update Key Fn |
| `POST` | `/key/{key}/regenerate` | Regenerate Key Fn |
| `POST` | `/key/{key}/reset_spend` | Reset Key Spend Fn |
| `POST` | `/register` | Register Client |
| `POST` | `/token` | Token Endpoint |


## Spend / Budget / Cost

**Endpoints:** 15 · **Priority:** P0 — critical

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/budget/delete` | Delete Budget |
| `POST` | `/budget/info` | Info Budget |
| `GET` | `/budget/list` | List Budget |
| `POST` | `/budget/new` | New Budget |
| `GET` | `/budget/settings` | Budget Settings |
| `POST` | `/budget/update` | Update Budget |
| `POST` | `/cost/estimate` | Estimate Cost |
| `GET` | `/global/spend/report` | Get Global Spend Report |
| `POST` | `/global/spend/reset` | Global Spend Reset |
| `GET` | `/global/spend/tags` | Global View Spend Tags |
| `GET` | `/provider/budgets` | Provider Budgets |
| `POST` | `/spend/calculate` | Calculate Spend |
| `GET` | `/spend/logs` | View Spend Logs |
| `GET` | `/spend/logs/v2` | Ui View Spend Logs |
| `GET` | `/spend/tags` | View Spend Tags |


## Audit / Logs / Health

**Endpoints:** 16 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/api/event_logging/batch` | Event Logging Batch |
| `GET` | `/audit` | Get Audit Logs |
| `GET` | `/audit/{id}` | Get Audit Log By Id |
| `GET` | `/health` | Health Endpoint |
| `GET` | `/health/backlog` | Health Backlog |
| `GET` | `/health/history` | Health Check History Endpoint |
| `GET` | `/health/latest` | Latest Health Checks Endpoint |
| `GET` | `/health/license` | Health License Endpoint |
| `GET` | `/health/liveliness` | Health Liveliness |
| `GET` | `/health/liveness` | Health Liveliness |
| `GET` | `/health/readiness` | Health Readiness |
| `GET` | `/health/services` | Health Services Endpoint |
| `GET` | `/health/shared-status` | Shared Health Check Status Endpoint |
| `POST` | `/health/test_connection` | Test Model Connection |
| `GET` | `/spend/logs` | View Spend Logs |
| `GET` | `/spend/logs/v2` | Ui View Spend Logs |


## Provider Pass-through

**Endpoints:** 94 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `DELETE` | `/anthropic/{endpoint}` | Anthropic Proxy Route |
| `GET` | `/anthropic/{endpoint}` | Anthropic Proxy Route |
| `PATCH` | `/anthropic/{endpoint}` | Anthropic Proxy Route |
| `POST` | `/anthropic/{endpoint}` | Anthropic Proxy Route |
| `PUT` | `/anthropic/{endpoint}` | Anthropic Proxy Route |
| `DELETE` | `/assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `GET` | `/assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `PATCH` | `/assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `POST` | `/assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `PUT` | `/assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `DELETE` | `/azure/{endpoint}` | Azure Proxy Route |
| `GET` | `/azure/{endpoint}` | Azure Proxy Route |
| `PATCH` | `/azure/{endpoint}` | Azure Proxy Route |
| `POST` | `/azure/{endpoint}` | Azure Proxy Route |
| `PUT` | `/azure/{endpoint}` | Azure Proxy Route |
| `DELETE` | `/azure_ai/{endpoint}` | Azure Proxy Route |
| `GET` | `/azure_ai/{endpoint}` | Azure Proxy Route |
| `PATCH` | `/azure_ai/{endpoint}` | Azure Proxy Route |
| `POST` | `/azure_ai/{endpoint}` | Azure Proxy Route |
| `PUT` | `/azure_ai/{endpoint}` | Azure Proxy Route |
| `DELETE` | `/bedrock/{endpoint}` | Bedrock Proxy Route |
| `GET` | `/bedrock/{endpoint}` | Bedrock Proxy Route |
| `PATCH` | `/bedrock/{endpoint}` | Bedrock Proxy Route |
| `POST` | `/bedrock/{endpoint}` | Bedrock Proxy Route |
| `PUT` | `/bedrock/{endpoint}` | Bedrock Proxy Route |
| `DELETE` | `/cohere/{endpoint}` | Cohere Proxy Route |
| `GET` | `/cohere/{endpoint}` | Cohere Proxy Route |
| `PATCH` | `/cohere/{endpoint}` | Cohere Proxy Route |
| `POST` | `/cohere/{endpoint}` | Cohere Proxy Route |
| `PUT` | `/cohere/{endpoint}` | Cohere Proxy Route |
| `DELETE` | `/config/pass_through_endpoint` | Delete Pass Through Endpoints |
| `GET` | `/config/pass_through_endpoint` | Get Pass Through Endpoints |
| `POST` | `/config/pass_through_endpoint` | Create Pass Through Endpoints |
| `GET` | `/config/pass_through_endpoint/team/{team_id}` | Get Pass Through Endpoints |
| `POST` | `/config/pass_through_endpoint/{endpoint_id}` | Update Pass Through Endpoints |
| `DELETE` | `/eu.assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `GET` | `/eu.assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `PATCH` | `/eu.assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `POST` | `/eu.assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `PUT` | `/eu.assemblyai/{endpoint}` | Assemblyai Proxy Route |
| `DELETE` | `/gemini/{endpoint}` | Gemini Proxy Route |
| `GET` | `/gemini/{endpoint}` | Gemini Proxy Route |
| `PATCH` | `/gemini/{endpoint}` | Gemini Proxy Route |
| `POST` | `/gemini/{endpoint}` | Gemini Proxy Route |
| `PUT` | `/gemini/{endpoint}` | Gemini Proxy Route |
| `DELETE` | `/langfuse/{endpoint}` | Langfuse Proxy Route |
| `GET` | `/langfuse/{endpoint}` | Langfuse Proxy Route |
| `PATCH` | `/langfuse/{endpoint}` | Langfuse Proxy Route |
| `POST` | `/langfuse/{endpoint}` | Langfuse Proxy Route |
| `PUT` | `/langfuse/{endpoint}` | Langfuse Proxy Route |
| `DELETE` | `/mistral/{endpoint}` | Mistral Proxy Route |
| `GET` | `/mistral/{endpoint}` | Mistral Proxy Route |
| `PATCH` | `/mistral/{endpoint}` | Mistral Proxy Route |
| `POST` | `/mistral/{endpoint}` | Mistral Proxy Route |
| `PUT` | `/mistral/{endpoint}` | Mistral Proxy Route |
| `POST` | `/openai/deployments/{model}/chat/completions` | Chat Completion |
| `POST` | `/openai/deployments/{model}/completions` | Completion |
| `POST` | `/openai/deployments/{model}/embeddings` | Embeddings |
| `POST` | `/openai/deployments/{model}/images/edits` | Image Edit Api |
| `POST` | `/openai/deployments/{model}/images/generations` | Image Generation |
| `POST` | `/openai/v1/realtime/calls` | Proxy Realtime Calls |
| `POST` | `/openai/v1/realtime/client_secrets` | Create Realtime Client Secret |
| `POST` | `/openai/v1/responses` | Responses Api |
| `POST` | `/openai/v1/responses/compact` | Compact Response |
| `DELETE` | `/openai/v1/responses/{response_id}` | Delete Response |
| `GET` | `/openai/v1/responses/{response_id}` | Get Response |
| `POST` | `/openai/v1/responses/{response_id}/cancel` | Cancel Response |
| `GET` | `/openai/v1/responses/{response_id}/input_items` | Get Response Input Items |
| `DELETE` | `/openai/{endpoint}` | Openai Proxy Route |
| `GET` | `/openai/{endpoint}` | Openai Proxy Route |
| `PATCH` | `/openai/{endpoint}` | Openai Proxy Route |
| `POST` | `/openai/{endpoint}` | Openai Proxy Route |
| `PUT` | `/openai/{endpoint}` | Openai Proxy Route |
| `DELETE` | `/openai_passthrough/{endpoint}` | Openai Proxy Route |
| `GET` | `/openai_passthrough/{endpoint}` | Openai Proxy Route |
| `PATCH` | `/openai_passthrough/{endpoint}` | Openai Proxy Route |
| `POST` | `/openai_passthrough/{endpoint}` | Openai Proxy Route |
| `PUT` | `/openai_passthrough/{endpoint}` | Openai Proxy Route |
| `DELETE` | `/vertex_ai/discovery/{endpoint}` | Vertex Discovery Proxy Route |
| `GET` | `/vertex_ai/discovery/{endpoint}` | Vertex Discovery Proxy Route |
| `PATCH` | `/vertex_ai/discovery/{endpoint}` | Vertex Discovery Proxy Route |
| `POST` | `/vertex_ai/discovery/{endpoint}` | Vertex Discovery Proxy Route |
| `PUT` | `/vertex_ai/discovery/{endpoint}` | Vertex Discovery Proxy Route |
| `GET` | `/vertex_ai/live` | WebSocket: vertex_ai_live_passthrough_endpoint |
| `DELETE` | `/vertex_ai/{endpoint}` | Vertex Proxy Route |
| `GET` | `/vertex_ai/{endpoint}` | Vertex Proxy Route |
| `PATCH` | `/vertex_ai/{endpoint}` | Vertex Proxy Route |
| `POST` | `/vertex_ai/{endpoint}` | Vertex Proxy Route |
| `PUT` | `/vertex_ai/{endpoint}` | Vertex Proxy Route |
| `DELETE` | `/vllm/{endpoint}` | Vllm Proxy Route |
| `GET` | `/vllm/{endpoint}` | Vllm Proxy Route |
| `PATCH` | `/vllm/{endpoint}` | Vllm Proxy Route |
| `POST` | `/vllm/{endpoint}` | Vllm Proxy Route |
| `PUT` | `/vllm/{endpoint}` | Vllm Proxy Route |


## Embeddings / RAG / Vector Stores

**Endpoints:** 55 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/embeddings` | Embeddings |
| `POST` | `/ocr` | Ocr |
| `POST` | `/rag/ingest` | Rag Ingest |
| `POST` | `/rag/query` | Rag Query |
| `POST` | `/rerank` | Rerank |
| `POST` | `/search` | Search |
| `GET` | `/search/tools` | List Search Tools |
| `POST` | `/search/{search_tool_name}` | Search |
| `POST` | `/search_tools` | Create Search Tool |
| `GET` | `/search_tools/list` | List Search Tools |
| `POST` | `/search_tools/test_connection` | Test Search Tool Connection |
| `GET` | `/search_tools/ui/available_providers` | Get Available Search Providers |
| `DELETE` | `/search_tools/{search_tool_id}` | Delete Search Tool |
| `GET` | `/search_tools/{search_tool_id}` | Get Search Tool Info |
| `PUT` | `/search_tools/{search_tool_id}` | Update Search Tool |
| `POST` | `/v1/embeddings` | Embeddings |
| `POST` | `/v1/indexes` | Index Create |
| `POST` | `/v1/ocr` | Ocr |
| `POST` | `/v1/rag/ingest` | Rag Ingest |
| `POST` | `/v1/rag/query` | Rag Query |
| `POST` | `/v1/rerank` | Rerank |
| `POST` | `/v1/search` | Search |
| `GET` | `/v1/search/tools` | List Search Tools |
| `POST` | `/v1/search/{search_tool_name}` | Search |
| `GET` | `/v1/vector_store/list` | List Vector Stores |
| `GET` | `/v1/vector_stores` | Vector Store List |
| `POST` | `/v1/vector_stores` | Vector Store Create |
| `DELETE` | `/v1/vector_stores/{vector_store_id}` | Vector Store Delete |
| `GET` | `/v1/vector_stores/{vector_store_id}` | Vector Store Retrieve |
| `POST` | `/v1/vector_stores/{vector_store_id}` | Vector Store Update |
| `GET` | `/v1/vector_stores/{vector_store_id}/files` | Vector Store File List |
| `POST` | `/v1/vector_stores/{vector_store_id}/files` | Vector Store File Create |
| `DELETE` | `/v1/vector_stores/{vector_store_id}/files/{file_id}` | Vector Store File Delete |
| `GET` | `/v1/vector_stores/{vector_store_id}/files/{file_id}` | Vector Store File Retrieve |
| `POST` | `/v1/vector_stores/{vector_store_id}/files/{file_id}` | Vector Store File Update |
| `GET` | `/v1/vector_stores/{vector_store_id}/files/{file_id}/content` | Vector Store File Content |
| `POST` | `/v1/vector_stores/{vector_store_id}/search` | Vector Store Search |
| `POST` | `/v2/rerank` | Rerank |
| `POST` | `/vector_store/delete` | Delete Vector Store |
| `POST` | `/vector_store/info` | Get Vector Store Info |
| `GET` | `/vector_store/list` | List Vector Stores |
| `POST` | `/vector_store/new` | New Vector Store |
| `POST` | `/vector_store/update` | Update Vector Store |
| `GET` | `/vector_stores` | Vector Store List |
| `POST` | `/vector_stores` | Vector Store Create |
| `DELETE` | `/vector_stores/{vector_store_id}` | Vector Store Delete |
| `GET` | `/vector_stores/{vector_store_id}` | Vector Store Retrieve |
| `POST` | `/vector_stores/{vector_store_id}` | Vector Store Update |
| `GET` | `/vector_stores/{vector_store_id}/files` | Vector Store File List |
| `POST` | `/vector_stores/{vector_store_id}/files` | Vector Store File Create |
| `DELETE` | `/vector_stores/{vector_store_id}/files/{file_id}` | Vector Store File Delete |
| `GET` | `/vector_stores/{vector_store_id}/files/{file_id}` | Vector Store File Retrieve |
| `POST` | `/vector_stores/{vector_store_id}/files/{file_id}` | Vector Store File Update |
| `GET` | `/vector_stores/{vector_store_id}/files/{file_id}/content` | Vector Store File Content |
| `POST` | `/vector_stores/{vector_store_id}/search` | Vector Store Search |


## Users / Teams / Orgs / Projects

**Endpoints:** 54 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/customer/block` | Block User |
| `GET` | `/customer/daily/activity` | Get Customer Daily Activity |
| `POST` | `/customer/delete` | Delete End User |
| `GET` | `/customer/info` | End User Info |
| `GET` | `/customer/list` | List End User |
| `POST` | `/customer/new` | New End User |
| `POST` | `/customer/unblock` | Unblock User |
| `POST` | `/customer/update` | Update End User |
| `GET` | `/organization/daily/activity` | Get Organization Daily Activity |
| `DELETE` | `/organization/delete` | Delete Organization |
| `GET` | `/organization/info` | Info Organization |
| `POST` | `/organization/info` | Deprecated Info Organization |
| `GET` | `/organization/list` | List Organization |
| `POST` | `/organization/member_add` | Organization Member Add |
| `DELETE` | `/organization/member_delete` | Organization Member Delete |
| `PATCH` | `/organization/member_update` | Organization Member Update |
| `POST` | `/organization/new` | New Organization |
| `PATCH` | `/organization/update` | Update Organization |
| `DELETE` | `/project/delete` | Delete Project |
| `GET` | `/project/info` | Project Info |
| `GET` | `/project/list` | List Projects |
| `POST` | `/project/new` | New Project |
| `POST` | `/project/update` | Update Project |
| `GET` | `/team/available` | List Available Teams |
| `POST` | `/team/block` | Block Team |
| `POST` | `/team/bulk_member_add` | Bulk Team Member Add |
| `GET` | `/team/daily/activity` | Get Team Daily Activity |
| `POST` | `/team/delete` | Delete Team |
| `GET` | `/team/info` | Team Info |
| `GET` | `/team/list` | List Team |
| `POST` | `/team/member_add` | Team Member Add |
| `POST` | `/team/member_delete` | Team Member Delete |
| `POST` | `/team/member_update` | Team Member Update |
| `POST` | `/team/model/add` | Team Model Add |
| `POST` | `/team/model/delete` | Team Model Delete |
| `POST` | `/team/new` | New Team |
| `GET` | `/team/permissions_list` | Team Member Permissions |
| `POST` | `/team/permissions_update` | Update Team Member Permissions |
| `POST` | `/team/unblock` | Unblock Team |
| `POST` | `/team/update` | Update Team |
| `GET` | `/team/{team_id}/callback` | Get Team Callbacks |
| `POST` | `/team/{team_id}/callback` | Add Team Callbacks |
| `POST` | `/team/{team_id}/disable_logging` | Disable Team Logging |
| `GET` | `/user/available_users` | Available Enterprise Users |
| `POST` | `/user/bulk_update` | Bulk User Update |
| `GET` | `/user/daily/activity` | Get User Daily Activity |
| `GET` | `/user/daily/activity/aggregated` | Get User Daily Activity Aggregated |
| `POST` | `/user/delete` | Delete User |
| `GET` | `/user/info` | User Info |
| `GET` | `/user/list` | Get Users |
| `POST` | `/user/new` | New User |
| `POST` | `/user/update` | User Update |
| `GET` | `/v2/team/list` | List Team V2 |
| `GET` | `/v2/user/info` | User Info V2 |


## Cache

**Endpoints:** 7 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/cache/delete` | Cache Delete |
| `POST` | `/cache/flushall` | Cache Flushall |
| `GET` | `/cache/ping` | Cache Ping |
| `GET` | `/cache/redis/info` | Cache Redis Info |
| `GET` | `/cache/settings` | Get Cache Settings |
| `POST` | `/cache/settings` | Update Cache Settings |
| `POST` | `/cache/settings/test` | Test Cache Connection |


## Credentials

**Endpoints:** 6 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/credentials` | Get Credentials |
| `POST` | `/credentials` | Create Credential |
| `GET` | `/credentials/by_model/{model_id}` | Get Credential By Model |
| `GET` | `/credentials/by_name/{credential_name}` | Get Credential By Name |
| `DELETE` | `/credentials/{credential_name}` | Delete Credential |
| `PATCH` | `/credentials/{credential_name}` | Update Credential |


## Settings & UI Config

**Endpoints:** 18 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/fallback` | Create Fallback |
| `DELETE` | `/fallback/{model}` | Delete Fallback |
| `GET` | `/fallback/{model}` | Get Fallback |
| `GET` | `/get/default_team_settings` | Get Default Team Settings |
| `GET` | `/get/internal_user_settings` | Get Internal User Settings |
| `GET` | `/get/mcp_semantic_filter_settings` | Get Mcp Semantic Filter Settings |
| `GET` | `/get/sso_settings` | Get Sso Settings |
| `GET` | `/get/ui_settings` | Get Ui Settings |
| `GET` | `/get/ui_theme_settings` | Get Ui Theme Settings |
| `GET` | `/in_product_nudges` | Get In Product Nudges |
| `GET` | `/settings` | Active Callbacks |
| `PATCH` | `/update/default_team_settings` | Update Default Team Settings |
| `PATCH` | `/update/internal_user_settings` | Update Internal User Settings |
| `PATCH` | `/update/mcp_semantic_filter_settings` | Update Mcp Semantic Filter Settings |
| `PATCH` | `/update/sso_settings` | Update Sso Settings |
| `PATCH` | `/update/ui_settings` | Update Ui Settings |
| `PATCH` | `/update/ui_theme_settings` | Update Ui Theme Settings |
| `POST` | `/upload/logo` | Upload Logo |


## Access Control & Tags

**Endpoints:** 29 · **Priority:** P1 — high

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/access_group/list` | List Access Groups |
| `POST` | `/access_group/new` | Create Model Group |
| `DELETE` | `/access_group/{access_group}/delete` | Delete Access Group |
| `GET` | `/access_group/{access_group}/info` | Get Access Group Info |
| `PUT` | `/access_group/{access_group}/update` | Update Access Group |
| `POST` | `/add/allowed_ip` | Add Allowed Ip |
| `POST` | `/delete/allowed_ip` | Delete Allowed Ip |
| `GET` | `/tag/daily/activity` | Get Tag Daily Activity |
| `GET` | `/tag/dau` | Get Daily Active Users |
| `POST` | `/tag/delete` | Delete Tag |
| `GET` | `/tag/distinct` | Get Distinct User Agent Tags |
| `POST` | `/tag/info` | Info Tag |
| `GET` | `/tag/list` | List Tags |
| `GET` | `/tag/mau` | Get Monthly Active Users |
| `POST` | `/tag/new` | New Tag |
| `GET` | `/tag/summary` | Get Tag Summary |
| `POST` | `/tag/update` | Update Tag |
| `GET` | `/tag/user-agent/per-user-analytics` | Get Per User Analytics |
| `GET` | `/tag/wau` | Get Weekly Active Users |
| `GET` | `/v1/access_group` | List Access Groups |
| `POST` | `/v1/access_group` | Create Access Group |
| `DELETE` | `/v1/access_group/{access_group_id}` | Delete Access Group |
| `GET` | `/v1/access_group/{access_group_id}` | Get Access Group |
| `PUT` | `/v1/access_group/{access_group_id}` | Update Access Group |
| `GET` | `/v1/unified_access_group` | List Access Groups |
| `POST` | `/v1/unified_access_group` | Create Access Group |
| `DELETE` | `/v1/unified_access_group/{access_group_id}` | Delete Access Group |
| `GET` | `/v1/unified_access_group/{access_group_id}` | Get Access Group |
| `PUT` | `/v1/unified_access_group/{access_group_id}` | Update Access Group |


## OAuth / SCIM / OIDC

**Endpoints:** 33 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/.well-known/jwks.json` | Jwks Json |
| `GET` | `/.well-known/litellm-ui-config` | Get Ui Config |
| `GET` | `/.well-known/oauth-authorization-server` | Oauth Authorization Server Mcp |
| `GET` | `/.well-known/oauth-authorization-server/mcp/{mcp_server_name}` | Oauth Authorization Server Mcp Standard |
| `GET` | `/.well-known/oauth-authorization-server/{mcp_server_name}` | Oauth Authorization Server Mcp |
| `GET` | `/.well-known/oauth-authorization-server/{mcp_server_name}/mcp` | Oauth Authorization Server Legacy |
| `GET` | `/.well-known/oauth-protected-resource` | Oauth Protected Resource Mcp |
| `GET` | `/.well-known/oauth-protected-resource/mcp/{mcp_server_name}` | Oauth Protected Resource Mcp Standard |
| `GET` | `/.well-known/oauth-protected-resource/{mcp_server_name}/mcp` | Oauth Protected Resource Mcp |
| `GET` | `/.well-known/openid-configuration` | Openid Configuration |
| `POST` | `/jwt/key/mapping/delete` | Delete Jwt Key Mapping |
| `GET` | `/jwt/key/mapping/info` | Info Jwt Key Mapping |
| `GET` | `/jwt/key/mapping/list` | List Jwt Key Mappings |
| `POST` | `/jwt/key/mapping/new` | Create Jwt Key Mapping |
| `POST` | `/jwt/key/mapping/update` | Update Jwt Key Mapping |
| `GET` | `/scim/v2` | Get Scim Base |
| `GET` | `/scim/v2/Groups` | Get Groups |
| `POST` | `/scim/v2/Groups` | Create Group |
| `DELETE` | `/scim/v2/Groups/{group_id}` | Delete Group |
| `GET` | `/scim/v2/Groups/{group_id}` | Get Group |
| `PATCH` | `/scim/v2/Groups/{group_id}` | Patch Group |
| `PUT` | `/scim/v2/Groups/{group_id}` | Update Group |
| `GET` | `/scim/v2/ResourceTypes` | Get Resource Types |
| `GET` | `/scim/v2/ResourceTypes/{resource_type_id}` | Get Resource Type |
| `GET` | `/scim/v2/Schemas` | Get Schemas |
| `GET` | `/scim/v2/Schemas/{schema_id}` | Get Schema |
| `GET` | `/scim/v2/ServiceProviderConfig` | Get Service Provider Config |
| `GET` | `/scim/v2/Users` | Get Users |
| `POST` | `/scim/v2/Users` | Create User |
| `DELETE` | `/scim/v2/Users/{user_id}` | Delete User |
| `GET` | `/scim/v2/Users/{user_id}` | Get User |
| `PATCH` | `/scim/v2/Users/{user_id}` | Patch User |
| `PUT` | `/scim/v2/Users/{user_id}` | Update User |


## A2A / Realtime / Cursor

**Endpoints:** 17 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/a2a/{agent_id}` | Invoke Agent A2A |
| `GET` | `/a2a/{agent_id}/.well-known/agent-card.json` | Get Agent Card |
| `GET` | `/a2a/{agent_id}/.well-known/agent.json` | Get Agent Card |
| `POST` | `/a2a/{agent_id}/message/send` | Invoke Agent A2A |
| `POST` | `/cursor/chat/completions` | Cursor Chat Completions |
| `DELETE` | `/cursor/{endpoint}` | Cursor Proxy Route |
| `GET` | `/cursor/{endpoint}` | Cursor Proxy Route |
| `PATCH` | `/cursor/{endpoint}` | Cursor Proxy Route |
| `POST` | `/cursor/{endpoint}` | Cursor Proxy Route |
| `PUT` | `/cursor/{endpoint}` | Cursor Proxy Route |
| `GET` | `/realtime` | WebSocket: realtime_websocket_endpoint |
| `POST` | `/realtime/calls` | Proxy Realtime Calls |
| `POST` | `/realtime/client_secrets` | Create Realtime Client Secret |
| `POST` | `/v1/a2a/{agent_id}/message/send` | Invoke Agent A2A |
| `GET` | `/v1/realtime` | WebSocket: realtime_websocket_endpoint |
| `POST` | `/v1/realtime/calls` | Proxy Realtime Calls |
| `POST` | `/v1/realtime/client_secrets` | Create Realtime Client Secret |


## Public Endpoints

**Endpoints:** 12 · **Priority:** P3 — low

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/litellm/.well-known/litellm-ui-config` | Get Ui Config |
| `GET` | `/public/agent_hub` | Get Agents |
| `GET` | `/public/agents/fields` | Get Agent Fields |
| `GET` | `/public/endpoints` | Get Supported Endpoints |
| `GET` | `/public/litellm_blog_posts` | Get Litellm Blog Posts |
| `GET` | `/public/litellm_model_cost_map` | Get Litellm Model Cost Map |
| `GET` | `/public/mcp_hub` | Get Mcp Servers |
| `GET` | `/public/model_hub` | Public Model Hub |
| `GET` | `/public/model_hub/info` | Public Model Hub Info |
| `GET` | `/public/providers` | Get Supported Providers |
| `GET` | `/public/providers/fields` | Get Provider Fields |
| `GET` | `/robots.txt` | Get Robots |


## Claude Code Plugins

**Endpoints:** 7 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/claude-code/marketplace.json` | Get Marketplace |
| `GET` | `/claude-code/plugins` | List Plugins |
| `POST` | `/claude-code/plugins` | Register Plugin |
| `DELETE` | `/claude-code/plugins/{plugin_name}` | Delete Plugin |
| `GET` | `/claude-code/plugins/{plugin_name}` | Get Plugin |
| `POST` | `/claude-code/plugins/{plugin_name}/disable` | Disable Plugin |
| `POST` | `/claude-code/plugins/{plugin_name}/enable` | Enable Plugin |


## Assistants / Threads

**Endpoints:** 11 · **Priority:** P3 — low

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/assistants` | Get Assistants |
| `POST` | `/assistants` | Create Assistant |
| `DELETE` | `/assistants/{assistant_id}` | Delete Assistant |
| `POST` | `/threads` | Create Threads |
| `GET` | `/threads/{thread_id}` | Get Thread |
| `GET` | `/threads/{thread_id}/messages` | Get Messages |
| `POST` | `/threads/{thread_id}/messages` | Add Messages |
| `POST` | `/threads/{thread_id}/runs` | Run Thread |
| `GET` | `/v1/assistants` | Get Assistants |
| `POST` | `/v1/assistants` | Create Assistant |
| `DELETE` | `/v1/assistants/{assistant_id}` | Delete Assistant |


## Files / Batches / Evals / Videos / Containers

**Endpoints:** 74 · **Priority:** P2 — medium

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/batches/{batch_id}` | Retrieve Batch |
| `POST` | `/batches/{batch_id}/cancel` | Cancel Batch |
| `DELETE` | `/containers/{container_id}` | Delete Container |
| `GET` | `/containers/{container_id}` | Retrieve Container |
| `GET` | `/containers/{container_id}/files` | Handler Container Id |
| `POST` | `/containers/{container_id}/files` | Handler Multipart Upload |
| `DELETE` | `/containers/{container_id}/files/{file_id}` | Handler Container File |
| `GET` | `/containers/{container_id}/files/{file_id}` | Handler Container File |
| `GET` | `/containers/{container_id}/files/{file_id}/content` | Handler Binary Content |
| `DELETE` | `/files/{file_id}` | Delete File |
| `GET` | `/files/{file_id}` | Get File |
| `GET` | `/files/{file_id}/content` | Get File Content |
| `GET` | `/fine_tuning/jobs` | ✨ (Enterprise) List Fine-Tuning Jobs |
| `POST` | `/fine_tuning/jobs` | ✨ (Enterprise) Create Fine-Tuning Job |
| `GET` | `/fine_tuning/jobs/{fine_tuning_job_id}` | ✨ (Enterprise) Retrieve Fine-Tuning Job |
| `POST` | `/fine_tuning/jobs/{fine_tuning_job_id}/cancel` | ✨ (Enterprise) Cancel Fine-Tuning Jobs |
| `GET` | `/v1/batches` | List Batches |
| `POST` | `/v1/batches` | Create Batch |
| `GET` | `/v1/batches/{batch_id}` | Retrieve Batch |
| `POST` | `/v1/batches/{batch_id}/cancel` | Cancel Batch |
| `GET` | `/v1/containers` | List Containers |
| `POST` | `/v1/containers` | Create Container |
| `DELETE` | `/v1/containers/{container_id}` | Delete Container |
| `GET` | `/v1/containers/{container_id}` | Retrieve Container |
| `GET` | `/v1/containers/{container_id}/files` | Handler Container Id |
| `POST` | `/v1/containers/{container_id}/files` | Handler Multipart Upload |
| `DELETE` | `/v1/containers/{container_id}/files/{file_id}` | Handler Container File |
| `GET` | `/v1/containers/{container_id}/files/{file_id}` | Handler Container File |
| `GET` | `/v1/containers/{container_id}/files/{file_id}/content` | Handler Binary Content |
| `GET` | `/v1/evals` | List Evals |
| `POST` | `/v1/evals` | Create Eval |
| `DELETE` | `/v1/evals/{eval_id}` | Delete Eval |
| `GET` | `/v1/evals/{eval_id}` | Get Eval |
| `POST` | `/v1/evals/{eval_id}` | Update Eval |
| `POST` | `/v1/evals/{eval_id}/cancel` | Cancel Eval |
| `GET` | `/v1/evals/{eval_id}/runs` | List Runs |
| `POST` | `/v1/evals/{eval_id}/runs` | Create Run |
| `DELETE` | `/v1/evals/{eval_id}/runs/{run_id}` | Delete Run |
| `GET` | `/v1/evals/{eval_id}/runs/{run_id}` | Get Run |
| `POST` | `/v1/evals/{eval_id}/runs/{run_id}` | Cancel Run |
| `GET` | `/v1/files` | List Files |
| `POST` | `/v1/files` | Create File |
| `DELETE` | `/v1/files/{file_id}` | Delete File |
| `GET` | `/v1/files/{file_id}` | Get File |
| `GET` | `/v1/files/{file_id}/content` | Get File Content |
| `GET` | `/v1/fine_tuning/jobs` | ✨ (Enterprise) List Fine-Tuning Jobs |
| `POST` | `/v1/fine_tuning/jobs` | ✨ (Enterprise) Create Fine-Tuning Job |
| `GET` | `/v1/fine_tuning/jobs/{fine_tuning_job_id}` | ✨ (Enterprise) Retrieve Fine-Tuning Job |
| `POST` | `/v1/fine_tuning/jobs/{fine_tuning_job_id}/cancel` | ✨ (Enterprise) Cancel Fine-Tuning Jobs |
| `GET` | `/v1/videos` | Video List |
| `POST` | `/v1/videos` | Video Generation |
| `POST` | `/v1/videos/characters` | Video Create Character |
| `GET` | `/v1/videos/characters/{character_id}` | Video Get Character |
| `POST` | `/v1/videos/edits` | Video Edit |
| `POST` | `/v1/videos/extensions` | Video Extension |
| `GET` | `/v1/videos/{video_id}` | Video Status |
| `GET` | `/v1/videos/{video_id}/content` | Video Content |
| `POST` | `/v1/videos/{video_id}/remix` | Video Remix |
| `POST` | `/videos/characters` | Video Create Character |
| `GET` | `/videos/characters/{character_id}` | Video Get Character |
| `POST` | `/videos/edits` | Video Edit |
| `POST` | `/videos/extensions` | Video Extension |
| `GET` | `/videos/{video_id}` | Video Status |
| `GET` | `/videos/{video_id}/content` | Video Content |
| `POST` | `/videos/{video_id}/remix` | Video Remix |
| `GET` | `/{provider}/v1/batches` | List Batches |
| `POST` | `/{provider}/v1/batches` | Create Batch |
| `GET` | `/{provider}/v1/batches/{batch_id}` | Retrieve Batch |
| `POST` | `/{provider}/v1/batches/{batch_id}/cancel` | Cancel Batch |
| `GET` | `/{provider}/v1/files` | List Files |
| `POST` | `/{provider}/v1/files` | Create File |
| `DELETE` | `/{provider}/v1/files/{file_id}` | Delete File |
| `GET` | `/{provider}/v1/files/{file_id}` | Get File |
| `GET` | `/{provider}/v1/files/{file_id}/content` | Get File Content |


## Router & Misc

**Endpoints:** 16 · **Priority:** P3 — low

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/active/callbacks` | Active Callbacks |
| `GET` | `/callback` | Callback |
| `GET` | `/callbacks/configs` | Get Callback Configs |
| `GET` | `/callbacks/list` | List Callbacks |
| `POST` | `/compliance/eu-ai-act` | Check Eu Ai Act Compliance |
| `POST` | `/compliance/gdpr` | Check Gdpr Compliance |
| `GET` | `/debug/asyncio-tasks` | Get Active Tasks Stats |
| `GET` | `/router/fields` | Get Router Fields |
| `GET` | `/router/settings` | Get Router Settings |
| `GET` | `/routes` | Get Routes |
| `GET` | `/test` | Test Endpoint |
| `POST` | `/utils/dotprompt_json_converter` | Convert Prompt File To Json |
| `GET` | `/utils/supported_openai_params` | Supported Openai Params |
| `POST` | `/utils/test_policies_and_guardrails` | Test Policies And Guardrails |
| `POST` | `/utils/token_counter` | Token Counter |
| `POST` | `/utils/transform_request` | Transform Request |
