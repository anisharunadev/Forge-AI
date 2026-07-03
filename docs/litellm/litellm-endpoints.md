# LiteLLM Endpoints — Complete Catalog

> **Source of truth:** [`docs/litellm/litellm-openapi.json`](./litellm-openapi.json) — OpenAPI 3.1 · LiteLLM `1.82.6`
> **Generated from:** 524 paths · **703 endpoint-methods** (rules out duplicates / pass-through `/v1/realtime` placeholders)
> **Companion docs:** [`forge-litellm-integration.md`](./forge-litellm-integration.md) (architecture + Forge feature matrix) · [`litellm-forge-reference.md`](./litellm-forge-reference.md) (curated Forge-priority digest, 637 endpoints)
> **Why this file:** the curated digest omits P2/P3 paths and pass-through `/v1/realtime` placeholders; this catalog lists **every** endpoint with method, path, summary, operationId, and tags straight from the spec.

**How to read:**
- **Method** = HTTP verb. **Path** may contain `{param}` placeholders.
- **opId** = the spec's `operationId` (stable identifier for clients).
- **Tags** = spec-level grouping (may differ from the bucket name below).
- All paths are relative to the LiteLLM Proxy base URL (`{LITELLM_BASE_URL}` in code).

## Quick index

| # | Bucket | Endpoints |
|---|---|---|
| 1 | [`v1/ (LLM Chat · Responses · Models · Skills · MCP · Tools · Audio · Images · Videos · Containers · Files · Batches · Evals · Fine-tuning · Realtime · A2A)`](#v1) | 147 |
| 2 | [`Chat (legacy paths)`](#chat) | 1 |
| 3 | [`Completions (legacy)`](#completions) | 1 |
| 4 | [`Responses (legacy)`](#responses) | 6 |
| 5 | [`embeddings`](#embeddings) | 1 |
| 6 | [`Models registry`](#models) | 5 |
| 7 | [`v2/ (legacy user/team info)`](#v2) | 4 |
| 8 | [`Guardrails (legacy v1)`](#guardrails) | 22 |
| 9 | [`Policies`](#policies) | 19 |
| 10 | [`Policies (legacy paths)`](#policy) | 9 |
| 11 | [`Prompts`](#prompts) | 9 |
| 12 | [`MCP REST (test/list/call)`](#mcp-rest) | 4 |
| 13 | [`.well-known (OAuth / JWKS / discovery)`](#well-known-oauth--jwks--discovery) | 10 |
| 14 | [`Virtual Keys & Auth`](#key) | 14 |
| 15 | [`Users`](#user) | 9 |
| 16 | [`Teams`](#team) | 20 |
| 17 | [`Organizations`](#organization) | 10 |
| 18 | [`Projects`](#project) | 5 |
| 19 | [`Customers (end-users)`](#customer) | 8 |
| 20 | [`Spend`](#spend) | 4 |
| 21 | [`Budgets`](#budget) | 6 |
| 22 | [`Global spend`](#global) | 3 |
| 23 | [`Provider budgets`](#provider) | 1 |
| 24 | [`Cost`](#cost) | 1 |
| 25 | [`Tags & analytics`](#tag) | 12 |
| 26 | [`Audit logs`](#audit) | 2 |
| 27 | [`Event logging`](#api) | 1 |
| 28 | [`Health & readiness`](#health) | 14 |
| 29 | [`Vector stores (bare paths)`](#vector_stores) | 12 |
| 30 | [`Vector stores (legacy paths)`](#vector_store) | 5 |
| 31 | [`RAG (legacy)`](#rag) | 2 |
| 32 | [`Rerank (legacy)`](#rerank) | 1 |
| 33 | [`OCR (legacy)`](#ocr) | 1 |
| 34 | [`Search tools`](#search_tools) | 7 |
| 35 | [`Search (legacy)`](#search) | 3 |
| 36 | [`Apply guardrail (root)`](#apply_guardrail) | 1 |
| 37 | [`Files (bare paths)`](#files) | 5 |
| 38 | [`Batches (bare paths)`](#batches) | 4 |
| 39 | [`Fine-tuning (legacy)`](#fine_tuning) | 4 |
| 40 | [`Audio (legacy)`](#audio) | 2 |
| 41 | [`Images (legacy)`](#images) | 2 |
| 42 | [`Videos (legacy)`](#videos) | 9 |
| 43 | [`Containers (legacy)`](#containers) | 9 |
| 44 | [`Realtime (legacy)`](#realtime) | 3 |
| 45 | [`A2A (legacy)`](#a2a) | 4 |
| 46 | [`Interactions (v1beta)`](#v1beta) | 7 |
| 47 | [`Interactions (legacy)`](#interactions) | 4 |
| 48 | [`Assistants (legacy)`](#assistants) | 3 |
| 49 | [`Threads (legacy)`](#threads) | 5 |
| 50 | [`Callback (singular)`](#callback) | 1 |
| 51 | [`Callbacks`](#callbacks) | 2 |
| 52 | [`Router`](#router) | 2 |
| 53 | [`Credentials`](#credentials) | 6 |
| 54 | [`Cache`](#cache) | 7 |
| 55 | [`Access groups (legacy)`](#access_group) | 5 |
| 56 | [`Add (allowed IPs)`](#add) | 1 |
| 57 | [`Delete (allowed IPs)`](#delete) | 1 |
| 58 | [`JWT keys`](#jwt) | 5 |
| 59 | [`SSO`](#sso) | 1 |
| 60 | [`Get settings`](#get) | 6 |
| 61 | [`Update settings`](#update) | 6 |
| 62 | [`Upload (logo)`](#upload) | 1 |
| 63 | [`Fallbacks`](#fallback) | 3 |
| 64 | [`Config`](#config) | 9 |
| 65 | [`Config overrides`](#config_overrides) | 4 |
| 66 | [`Settings`](#settings) | 1 |
| 67 | [`litellm/ (UI config)`](#litellm) | 1 |
| 68 | [`Public`](#public) | 10 |
| 69 | [`Provider Pass-through · OpenAI`](#provider-pass-through--openai) | 18 |
| 70 | [`Provider Pass-through · OpenAI (alias)`](#provider-pass-through--openai_passthrough) | 5 |
| 71 | [`Provider Pass-through · Anthropic`](#provider-pass-through--anthropic) | 5 |
| 72 | [`Provider Pass-through · Bedrock`](#provider-pass-through--bedrock) | 5 |
| 73 | [`Provider Pass-through · Vertex AI`](#provider-pass-through--vertex_ai) | 11 |
| 74 | [`Provider Pass-through · Gemini`](#provider-pass-through--gemini) | 5 |
| 75 | [`Provider Pass-through · Mistral`](#provider-pass-through--mistral) | 5 |
| 76 | [`Provider Pass-through · Cohere`](#provider-pass-through--cohere) | 5 |
| 77 | [`Provider Pass-through · AssemblyAI`](#provider-pass-through--assemblyai) | 5 |
| 78 | [`Provider Pass-through · AssemblyAI (EU)`](#provider-pass-through--euassemblyai) | 5 |
| 79 | [`Provider Pass-through · Azure`](#provider-pass-through--azure) | 5 |
| 80 | [`Provider Pass-through · Azure AI`](#provider-pass-through--azure_ai) | 5 |
| 81 | [`Provider Pass-through · vLLM`](#provider-pass-through--vllm) | 5 |
| 82 | [`Provider Pass-through · Cursor`](#provider-pass-through--cursor) | 6 |
| 83 | [`Provider Pass-through · Langfuse`](#provider-pass-through--langfuse) | 5 |
| 84 | [`MCP — dynamic per-server routes`](#mcp--dynamic-routes) | 10 |
| 85 | [`Test endpoints`](#test) | 1 |
| 86 | [`Utilities`](#utils) | 5 |
| 87 | [`Debug`](#debug) | 1 |
| 88 | [`Routes introspection`](#routes) | 1 |
| 89 | [`Compliance`](#compliance) | 2 |
| 90 | [`OAuth client registration`](#register) | 1 |
| 91 | [`OAuth token`](#token) | 1 |
| 92 | [`OAuth authorize`](#authorize) | 1 |
| 93 | [`OAuth / SCIM / OIDC`](#oauth--scim--oidc) | 18 |
| 94 | [``](#) | 1 |
| 95 | [`Claude Code Plugins`](#claude-code-plugins) | 7 |
| 96 | [`active`](#active) | 1 |
| 97 | [`agent`](#agent) | 1 |
| 98 | [`cloudzero`](#cloudzero) | 6 |
| 99 | [`email`](#email) | 3 |
| 100 | [`engines`](#engines) | 3 |
| 101 | [`in_product_nudges`](#in_product_nudges) | 1 |
| 102 | [`milvus`](#milvus) | 5 |
| 103 | [`model`](#model) | 5 |
| 104 | [`model_group`](#model_group) | 2 |
| 105 | [`model_hub`](#model_hub) | 1 |
| 106 | [`moderations`](#moderations) | 1 |
| 107 | [`robots.txt`](#robotstxt) | 1 |
| 108 | [`usage`](#usage) | 1 |
| 109 | [`vantage`](#vantage) | 6 |
| 110 | [`{provider}`](#provider) | 9 |

---

## `v1` — v1/ (LLM Chat · Responses · Models · Skills · MCP · Tools · Audio · Images · Videos · Containers · Files · Batches · Evals · Fine-tuning · Realtime · A2A)

- **`POST` `/v1/a2a/{agent_id}/message/send`** — Invoke Agent A2A `invoke_agent_a2a_v1_a2a__agent_id__message_send_post`  
  _Tags:_ [beta] A2A Agents
- **`GET` `/v1/access_group`** — List Access Groups `list_access_groups_v1_access_group_get`  
  _Tags:_ access group management
- **`POST` `/v1/access_group`** — Create Access Group `create_access_group_v1_access_group_post`  
  _Tags:_ access group management
- **`GET` `/v1/access_group/{access_group_id}`** — Get Access Group `get_access_group_v1_access_group__access_group_id__get`  
  _Tags:_ access group management
- **`PUT` `/v1/access_group/{access_group_id}`** — Update Access Group `update_access_group_v1_access_group__access_group_id__put`  
  _Tags:_ access group management
- **`DELETE` `/v1/access_group/{access_group_id}`** — Delete Access Group `delete_access_group_v1_access_group__access_group_id__delete`  
  _Tags:_ access group management
- **`GET` `/v1/agents`** — Get Agents `get_agents_v1_agents_get`  
  _Tags:_ [beta] A2A Agents
- **`POST` `/v1/agents`** — Create Agent `create_agent_v1_agents_post`  
  _Tags:_ [beta] A2A Agents
- **`POST` `/v1/agents/make_public`** — Make Agents Public `make_agents_public_v1_agents_make_public_post`  
  _Tags:_ [beta] A2A Agents
- **`GET` `/v1/agents/{agent_id}`** — Get Agent By Id `get_agent_by_id_v1_agents__agent_id__get`  
  _Tags:_ [beta] A2A Agents
- **`PUT` `/v1/agents/{agent_id}`** — Update Agent `update_agent_v1_agents__agent_id__put`  
  _Tags:_ [beta] A2A Agents
- **`DELETE` `/v1/agents/{agent_id}`** — Delete Agent `delete_agent_v1_agents__agent_id__delete`  
  _Tags:_ Agents
- **`PATCH` `/v1/agents/{agent_id}`** — Patch Agent `patch_agent_v1_agents__agent_id__patch`  
  _Tags:_ [beta] A2A Agents
- **`POST` `/v1/agents/{agent_id}/make_public`** — Make Agent Public `make_agent_public_v1_agents__agent_id__make_public_post`  
  _Tags:_ [beta] A2A Agents
- **`GET` `/v1/assistants`** — Get Assistants `get_assistants_v1_assistants_get`  
  _Tags:_ assistants
- **`POST` `/v1/assistants`** — Create Assistant `create_assistant_v1_assistants_post`  
  _Tags:_ assistants
- **`DELETE` `/v1/assistants/{assistant_id}`** — Delete Assistant `delete_assistant_v1_assistants__assistant_id__delete`  
  _Tags:_ assistants
- **`POST` `/v1/audio/speech`** — Audio Speech `audio_speech_v1_audio_speech_post`  
  _Tags:_ audio
- **`POST` `/v1/audio/transcriptions`** — Audio Transcriptions `audio_transcriptions_v1_audio_transcriptions_post`  
  _Tags:_ audio
- **`GET` `/v1/batches`** — List Batches `list_batches_v1_batches_get`  
  _Tags:_ batch
- **`POST` `/v1/batches`** — Create Batch `create_batch_v1_batches_post`  
  _Tags:_ batch
- **`GET` `/v1/batches/{batch_id}`** — Retrieve Batch `retrieve_batch_v1_batches__batch_id__get`  
  _Tags:_ batch
- **`POST` `/v1/batches/{batch_id}/cancel`** — Cancel Batch `cancel_batch_v1_batches__batch_id__cancel_post`  
  _Tags:_ batch
- **`POST` `/v1/chat/completions`** — Chat Completion `chat_completion_v1_chat_completions_post`  
  _Tags:_ chat/completions
- **`POST` `/v1/completions`** — Completion `completion_v1_completions_post`  
  _Tags:_ completions
- **`GET` `/v1/containers`** — List Containers `list_containers_v1_containers_get`  
  _Tags:_ containers
- **`POST` `/v1/containers`** — Create Container `create_container_v1_containers_post`  
  _Tags:_ containers
- **`GET` `/v1/containers/{container_id}`** — Retrieve Container `retrieve_container_v1_containers__container_id__get`  
  _Tags:_ containers
- **`DELETE` `/v1/containers/{container_id}`** — Delete Container `delete_container_v1_containers__container_id__delete`  
  _Tags:_ containers
- **`GET` `/v1/containers/{container_id}/files`** — Handler Container Id `handler_container_id_v1_containers__container_id__files_get`  
  _Tags:_ containers
- **`POST` `/v1/containers/{container_id}/files`** — Handler Multipart Upload `handler_multipart_upload_v1_containers__container_id__files_post`  
  _Tags:_ containers
- **`GET` `/v1/containers/{container_id}/files/{file_id}`** — Handler Container File `handler_container_file_v1_containers__container_id__files__file_id__get`  
  _Tags:_ containers
- **`DELETE` `/v1/containers/{container_id}/files/{file_id}`** — Handler Container File `handler_container_file_v1_containers__container_id__files__file_id__delete`  
  _Tags:_ containers
- **`GET` `/v1/containers/{container_id}/files/{file_id}/content`** — Handler Binary Content `handler_binary_content_v1_containers__container_id__files__file_id__content_get`  
  _Tags:_ containers
- **`POST` `/v1/embeddings`** — Embeddings `embeddings_v1_embeddings_post`  
  _Tags:_ embeddings
- **`GET` `/v1/evals`** — List Evals `list_evals_v1_evals_get`  
  _Tags:_ OpenAI Evals API
- **`POST` `/v1/evals`** — Create Eval `create_eval_v1_evals_post`  
  _Tags:_ OpenAI Evals API
- **`GET` `/v1/evals/{eval_id}`** — Get Eval `get_eval_v1_evals__eval_id__get`  
  _Tags:_ OpenAI Evals API
- **`POST` `/v1/evals/{eval_id}`** — Update Eval `update_eval_v1_evals__eval_id__post`  
  _Tags:_ OpenAI Evals API
- **`DELETE` `/v1/evals/{eval_id}`** — Delete Eval `delete_eval_v1_evals__eval_id__delete`  
  _Tags:_ OpenAI Evals API
- **`POST` `/v1/evals/{eval_id}/cancel`** — Cancel Eval `cancel_eval_v1_evals__eval_id__cancel_post`  
  _Tags:_ OpenAI Evals API
- **`GET` `/v1/evals/{eval_id}/runs`** — List Runs `list_runs_v1_evals__eval_id__runs_get`  
  _Tags:_ OpenAI Evals API - Runs
- **`POST` `/v1/evals/{eval_id}/runs`** — Create Run `create_run_v1_evals__eval_id__runs_post`  
  _Tags:_ OpenAI Evals API - Runs
- **`GET` `/v1/evals/{eval_id}/runs/{run_id}`** — Get Run `get_run_v1_evals__eval_id__runs__run_id__get`  
  _Tags:_ OpenAI Evals API - Runs
- **`POST` `/v1/evals/{eval_id}/runs/{run_id}`** — Cancel Run `cancel_run_v1_evals__eval_id__runs__run_id__post`  
  _Tags:_ OpenAI Evals API - Runs
- **`DELETE` `/v1/evals/{eval_id}/runs/{run_id}`** — Delete Run `delete_run_v1_evals__eval_id__runs__run_id__delete`  
  _Tags:_ OpenAI Evals API - Runs
- **`GET` `/v1/files`** — List Files `list_files_v1_files_get`  
  _Tags:_ files
- **`POST` `/v1/files`** — Create File `create_file_v1_files_post`  
  _Tags:_ files
- **`GET` `/v1/files/{file_id}`** — Get File `get_file_v1_files__file_id__get`  
  _Tags:_ files
- **`DELETE` `/v1/files/{file_id}`** — Delete File `delete_file_v1_files__file_id__delete`  
  _Tags:_ files
- **`GET` `/v1/files/{file_id}/content`** — Get File Content `get_file_content_v1_files__file_id__content_get`  
  _Tags:_ files
- **`GET` `/v1/fine_tuning/jobs`** — ✨ (Enterprise) List Fine-Tuning Jobs `list_fine_tuning_jobs_v1_fine_tuning_jobs_get`  
  _Tags:_ fine-tuning
- **`POST` `/v1/fine_tuning/jobs`** — ✨ (Enterprise) Create Fine-Tuning Job `create_fine_tuning_job_v1_fine_tuning_jobs_post`  
  _Tags:_ fine-tuning
- **`GET` `/v1/fine_tuning/jobs/{fine_tuning_job_id}`** — ✨ (Enterprise) Retrieve Fine-Tuning Job `retrieve_fine_tuning_job_v1_fine_tuning_jobs__fine_tuning_job_id__get`  
  _Tags:_ fine-tuning
- **`POST` `/v1/fine_tuning/jobs/{fine_tuning_job_id}/cancel`** — ✨ (Enterprise) Cancel Fine-Tuning Jobs `cancel_fine_tuning_job_v1_fine_tuning_jobs__fine_tuning_job_id__cancel_post`  
  _Tags:_ fine-tuning
- **`POST` `/v1/images/edits`** — Image Edit Api `image_edit_api_v1_images_edits_post`  
  _Tags:_ images
- **`POST` `/v1/images/generations`** — Image Generation `image_generation_v1_images_generations_post`  
  _Tags:_ images
- **`POST` `/v1/indexes`** — Index Create `index_create_v1_indexes_post`
- **`GET` `/v1/mcp/access_groups`** — Get Mcp Access Groups `get_mcp_access_groups_v1_mcp_access_groups_get`  
  _Tags:_ mcp, mcp
- **`GET` `/v1/mcp/discover`** — Discover Mcp Servers `discover_mcp_servers_v1_mcp_discover_get`  
  _Tags:_ mcp
- **`POST` `/v1/mcp/make_public`** — Make Mcp Servers Public `make_mcp_servers_public_v1_mcp_make_public_post`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/network/client-ip`** — Get Client Ip `get_client_ip_v1_mcp_network_client_ip_get`  
  _Tags:_ mcp, mcp
- **`GET` `/v1/mcp/openapi-registry`** — Get Openapi Registry `get_openapi_registry_v1_mcp_openapi_registry_get`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/registry.json`** — Get Mcp Registry `get_mcp_registry_v1_mcp_registry_json_get`  
  _Tags:_ mcp, mcp
- **`GET` `/v1/mcp/server`** — Fetch All Mcp Servers `fetch_all_mcp_servers_v1_mcp_server_get`  
  _Tags:_ mcp
- **`POST` `/v1/mcp/server`** — Add Mcp Server `add_mcp_server_v1_mcp_server_post`  
  _Tags:_ mcp
- **`PUT` `/v1/mcp/server`** — Edit Mcp Server `edit_mcp_server_v1_mcp_server_put`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/server/health`** — Health Check Servers `health_check_servers_v1_mcp_server_health_get`  
  _Tags:_ mcp
- **`POST` `/v1/mcp/server/oauth/session`** — Add Session Mcp Server `add_session_mcp_server_v1_mcp_server_oauth_session_post`  
  _Tags:_ mcp
- **`POST` `/v1/mcp/server/register`** — Register Mcp Server `register_mcp_server_v1_mcp_server_register_post`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/server/submissions`** — Get Mcp Server Submissions `get_mcp_server_submissions_v1_mcp_server_submissions_get`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/server/{server_id}`** — Fetch Mcp Server `fetch_mcp_server_v1_mcp_server__server_id__get`  
  _Tags:_ mcp
- **`DELETE` `/v1/mcp/server/{server_id}`** — Remove Mcp Server `remove_mcp_server_v1_mcp_server__server_id__delete`  
  _Tags:_ mcp
- **`PUT` `/v1/mcp/server/{server_id}/approve`** — Approve Mcp Server Submission `approve_mcp_server_submission_v1_mcp_server__server_id__approve_put`  
  _Tags:_ mcp
- **`POST` `/v1/mcp/server/{server_id}/oauth-user-credential`** — Store Mcp Oauth User Credential `store_mcp_oauth_user_credential_v1_mcp_server__server_id__oauth_user_credential_post`  
  _Tags:_ mcp
- **`DELETE` `/v1/mcp/server/{server_id}/oauth-user-credential`** — Delete Mcp Oauth User Credential `delete_mcp_oauth_user_credential_v1_mcp_server__server_id__oauth_user_credential_delete`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/server/{server_id}/oauth-user-credential/status`** — Get Mcp Oauth User Credential Status `get_mcp_oauth_user_credential_status_v1_mcp_server__server_id__oauth_user_credential_status_get`  
  _Tags:_ mcp
- **`PUT` `/v1/mcp/server/{server_id}/reject`** — Reject Mcp Server Submission `reject_mcp_server_submission_v1_mcp_server__server_id__reject_put`  
  _Tags:_ mcp
- **`POST` `/v1/mcp/server/{server_id}/user-credential`** — Store Mcp User Credential `store_mcp_user_credential_v1_mcp_server__server_id__user_credential_post`  
  _Tags:_ mcp
- **`DELETE` `/v1/mcp/server/{server_id}/user-credential`** — Delete Mcp User Credential `delete_mcp_user_credential_v1_mcp_server__server_id__user_credential_delete`  
  _Tags:_ mcp
- **`GET` `/v1/mcp/tools`** — Get Mcp Tools `get_mcp_tools_v1_mcp_tools_get`  
  _Tags:_ mcp, mcp
- **`GET` `/v1/mcp/user-credentials`** — List Mcp User Credentials `list_mcp_user_credentials_v1_mcp_user_credentials_get`  
  _Tags:_ mcp
- **`POST` `/v1/messages`** — Anthropic Response `anthropic_response_v1_messages_post`  
  _Tags:_ [beta] Anthropic `/v1/messages`
- **`POST` `/v1/messages/count_tokens`** — Count Tokens `count_tokens_v1_messages_count_tokens_post`  
  _Tags:_ [beta] Anthropic Messages Token Counting
- **`GET` `/v1/model/info`** — Model Info V1 `model_info_v1_v1_model_info_get`  
  _Tags:_ model management
- **`GET` `/v1/models`** — Model List `model_list_v1_models_get`  
  _Tags:_ model management
- **`GET` `/v1/models/{model_id}`** — Model Info `model_info_v1_models__model_id__get`  
  _Tags:_ model management
- **`POST` `/v1/moderations`** — Moderations `moderations_v1_moderations_post`  
  _Tags:_ moderations
- **`POST` `/v1/ocr`** — Ocr `ocr_v1_ocr_post`  
  _Tags:_ ocr
- **`POST` `/v1/rag/ingest`** — Rag Ingest `rag_ingest_v1_rag_ingest_post`  
  _Tags:_ rag
- **`POST` `/v1/rag/query`** — Rag Query `rag_query_v1_rag_query_post`  
  _Tags:_ rag
- **`GET` `/v1/realtime`** — WebSocket: realtime_websocket_endpoint `websocket_realtime_websocket_endpoint`  
  _Tags:_ WebSocket
- **`POST` `/v1/realtime/calls`** — Proxy Realtime Calls `proxy_realtime_calls_v1_realtime_calls_post`  
  _Tags:_ realtime
- **`POST` `/v1/realtime/client_secrets`** — Create Realtime Client Secret `create_realtime_client_secret_v1_realtime_client_secrets_post`  
  _Tags:_ realtime
- **`POST` `/v1/rerank`** — Rerank `rerank_v1_rerank_post`  
  _Tags:_ rerank
- **`GET` `/v1/responses`** — WebSocket: responses_websocket_endpoint `websocket_responses_websocket_endpoint`  
  _Tags:_ WebSocket
- **`POST` `/v1/responses/compact`** — Compact Response `compact_response_v1_responses_compact_post`  
  _Tags:_ responses
- **`GET` `/v1/responses/{response_id}`** — Get Response `get_response_v1_responses__response_id__get`  
  _Tags:_ responses
- **`DELETE` `/v1/responses/{response_id}`** — Delete Response `delete_response_v1_responses__response_id__delete`  
  _Tags:_ responses
- **`POST` `/v1/responses/{response_id}/cancel`** — Cancel Response `cancel_response_v1_responses__response_id__cancel_post`  
  _Tags:_ responses
- **`GET` `/v1/responses/{response_id}/input_items`** — Get Response Input Items `get_response_input_items_v1_responses__response_id__input_items_get`  
  _Tags:_ responses
- **`POST` `/v1/search`** — Search `search_v1_search_post`  
  _Tags:_ search
- **`GET` `/v1/search/tools`** — List Search Tools `list_search_tools_v1_search_tools_get`  
  _Tags:_ search
- **`POST` `/v1/search/{search_tool_name}`** — Search `search_v1_search__search_tool_name__post`  
  _Tags:_ search
- **`GET` `/v1/skills`** — List Skills `list_skills_v1_skills_get`  
  _Tags:_ [beta] Anthropic Skills API
- **`POST` `/v1/skills`** — Create Skill `create_skill_v1_skills_post`  
  _Tags:_ [beta] Anthropic Skills API
- **`GET` `/v1/skills/{skill_id}`** — Get Skill `get_skill_v1_skills__skill_id__get`  
  _Tags:_ [beta] Anthropic Skills API
- **`DELETE` `/v1/skills/{skill_id}`** — Delete Skill `delete_skill_v1_skills__skill_id__delete`  
  _Tags:_ [beta] Anthropic Skills API
- **`POST` `/v1/threads`** — Create Threads `create_threads_v1_threads_post`  
  _Tags:_ assistants
- **`GET` `/v1/threads/{thread_id}`** — Get Thread `get_thread_v1_threads__thread_id__get`  
  _Tags:_ assistants
- **`GET` `/v1/threads/{thread_id}/messages`** — Get Messages `get_messages_v1_threads__thread_id__messages_get`  
  _Tags:_ assistants
- **`POST` `/v1/threads/{thread_id}/messages`** — Add Messages `add_messages_v1_threads__thread_id__messages_post`  
  _Tags:_ assistants
- **`POST` `/v1/threads/{thread_id}/runs`** — Run Thread `run_thread_v1_threads__thread_id__runs_post`  
  _Tags:_ assistants
- **`GET` `/v1/tool/list`** — List Tools `list_tools_v1_tool_list_get`  
  _Tags:_ tool management
- **`POST` `/v1/tool/policy`** — Update Tool Policy `update_tool_policy_v1_tool_policy_post`  
  _Tags:_ tool management
- **`GET` `/v1/tool/policy/options`** — Get Tool Policy Options `get_tool_policy_options_v1_tool_policy_options_get`  
  _Tags:_ tool management
- **`GET` `/v1/tool/{tool_name}`** — Get Tool `get_tool_v1_tool__tool_name__get`  
  _Tags:_ tool management
- **`GET` `/v1/tool/{tool_name}/detail`** — Get Tool Detail `get_tool_detail_v1_tool__tool_name__detail_get`  
  _Tags:_ tool management
- **`GET` `/v1/tool/{tool_name}/logs`** — Get Tool Usage Logs `get_tool_usage_logs_v1_tool__tool_name__logs_get`  
  _Tags:_ tool management
- **`DELETE` `/v1/tool/{tool_name}/overrides`** — Delete Tool Policy Override `delete_tool_policy_override_v1_tool__tool_name__overrides_delete`  
  _Tags:_ tool management
- **`GET` `/v1/unified_access_group`** — List Access Groups `list_access_groups_v1_unified_access_group_get`  
  _Tags:_ access group management
- **`POST` `/v1/unified_access_group`** — Create Access Group `create_access_group_v1_unified_access_group_post`  
  _Tags:_ access group management
- **`GET` `/v1/unified_access_group/{access_group_id}`** — Get Access Group `get_access_group_v1_unified_access_group__access_group_id__get`  
  _Tags:_ access group management
- **`PUT` `/v1/unified_access_group/{access_group_id}`** — Update Access Group `update_access_group_v1_unified_access_group__access_group_id__put`  
  _Tags:_ access group management
- **`DELETE` `/v1/unified_access_group/{access_group_id}`** — Delete Access Group `delete_access_group_v1_unified_access_group__access_group_id__delete`  
  _Tags:_ access group management
- **`GET` `/v1/vector_store/list`** — List Vector Stores `list_vector_stores_v1_vector_store_list_get`  
  _Tags:_ vector store management
- **`GET` `/v1/vector_stores`** — Vector Store List `vector_store_list_v1_vector_stores_get`
- **`POST` `/v1/vector_stores`** — Vector Store Create `vector_store_create_v1_vector_stores_post`
- **`GET` `/v1/vector_stores/{vector_store_id}`** — Vector Store Retrieve `vector_store_retrieve_v1_vector_stores__vector_store_id__get`
- **`POST` `/v1/vector_stores/{vector_store_id}`** — Vector Store Update `vector_store_update_v1_vector_stores__vector_store_id__post`
- **`DELETE` `/v1/vector_stores/{vector_store_id}`** — Vector Store Delete `vector_store_delete_v1_vector_stores__vector_store_id__delete`
- **`GET` `/v1/vector_stores/{vector_store_id}/files`** — Vector Store File List `vector_store_file_list_v1_vector_stores__vector_store_id__files_get`  
  _Tags:_ vector_store_files
- **`POST` `/v1/vector_stores/{vector_store_id}/files`** — Vector Store File Create `vector_store_file_create_v1_vector_stores__vector_store_id__files_post`  
  _Tags:_ vector_store_files
- **`GET` `/v1/vector_stores/{vector_store_id}/files/{file_id}`** — Vector Store File Retrieve `vector_store_file_retrieve_v1_vector_stores__vector_store_id__files__file_id__get`  
  _Tags:_ vector_store_files
- **`POST` `/v1/vector_stores/{vector_store_id}/files/{file_id}`** — Vector Store File Update `vector_store_file_update_v1_vector_stores__vector_store_id__files__file_id__post`  
  _Tags:_ vector_store_files
- **`DELETE` `/v1/vector_stores/{vector_store_id}/files/{file_id}`** — Vector Store File Delete `vector_store_file_delete_v1_vector_stores__vector_store_id__files__file_id__delete`  
  _Tags:_ vector_store_files
- **`GET` `/v1/vector_stores/{vector_store_id}/files/{file_id}/content`** — Vector Store File Content `vector_store_file_content_v1_vector_stores__vector_store_id__files__file_id__content_get`  
  _Tags:_ vector_store_files
- **`POST` `/v1/vector_stores/{vector_store_id}/search`** — Vector Store Search `vector_store_search_v1_vector_stores__vector_store_id__search_post`
- **`GET` `/v1/videos`** — Video List `video_list_v1_videos_get`  
  _Tags:_ videos
- **`POST` `/v1/videos`** — Video Generation `video_generation_v1_videos_post`  
  _Tags:_ videos
- **`POST` `/v1/videos/characters`** — Video Create Character `video_create_character_v1_videos_characters_post`  
  _Tags:_ videos
- **`GET` `/v1/videos/characters/{character_id}`** — Video Get Character `video_get_character_v1_videos_characters__character_id__get`  
  _Tags:_ videos
- **`POST` `/v1/videos/edits`** — Video Edit `video_edit_v1_videos_edits_post`  
  _Tags:_ videos
- **`POST` `/v1/videos/extensions`** — Video Extension `video_extension_v1_videos_extensions_post`  
  _Tags:_ videos
- **`GET` `/v1/videos/{video_id}`** — Video Status `video_status_v1_videos__video_id__get`  
  _Tags:_ videos
- **`GET` `/v1/videos/{video_id}/content`** — Video Content `video_content_v1_videos__video_id__content_get`  
  _Tags:_ videos
- **`POST` `/v1/videos/{video_id}/remix`** — Video Remix `video_remix_v1_videos__video_id__remix_post`  
  _Tags:_ videos

## `chat` — Chat (legacy paths)

- **`POST` `/chat/completions`** — Chat Completion `chat_completion_chat_completions_post`  
  _Tags:_ chat/completions

## `completions` — Completions (legacy)

- **`POST` `/completions`** — Completion `completion_completions_post`  
  _Tags:_ completions

## `responses` — Responses (legacy)

- **`GET` `/responses`** — WebSocket: responses_websocket_endpoint `websocket_responses_websocket_endpoint`  
  _Tags:_ WebSocket
- **`POST` `/responses/compact`** — Compact Response `compact_response_responses_compact_post`  
  _Tags:_ responses
- **`GET` `/responses/{response_id}`** — Get Response `get_response_responses__response_id__get`  
  _Tags:_ responses
- **`DELETE` `/responses/{response_id}`** — Delete Response `delete_response_responses__response_id__delete`  
  _Tags:_ responses
- **`POST` `/responses/{response_id}/cancel`** — Cancel Response `cancel_response_responses__response_id__cancel_post`  
  _Tags:_ responses
- **`GET` `/responses/{response_id}/input_items`** — Get Response Input Items `get_response_input_items_responses__response_id__input_items_get`  
  _Tags:_ responses

## `embeddings` — embeddings

- **`POST` `/embeddings`** — Embeddings `embeddings_embeddings_post`  
  _Tags:_ embeddings

## `models` — Models registry

- **`GET` `/models`** — Model List `model_list_models_get`  
  _Tags:_ model management
- **`GET` `/models/{model_id}`** — Model Info `model_info_models__model_id__get`  
  _Tags:_ model management
- **`POST` `/models/{model_name}:countTokens`** — Google Count Tokens `google_count_tokens_models__model_name__countTokens_post`  
  _Tags:_ google genai endpoints
- **`POST` `/models/{model_name}:generateContent`** — Google Generate Content `google_generate_content_models__model_name__generateContent_post`  
  _Tags:_ google genai endpoints
- **`POST` `/models/{model_name}:streamGenerateContent`** — Google Stream Generate Content `google_stream_generate_content_models__model_name__streamGenerateContent_post`  
  _Tags:_ google genai endpoints

## `v2` — v2/ (legacy user/team info)

- **`GET` `/v2/guardrails/list`** — List Guardrails V2 `list_guardrails_v2_v2_guardrails_list_get`  
  _Tags:_ Guardrails
- **`POST` `/v2/rerank`** — Rerank `rerank_v2_rerank_post`  
  _Tags:_ rerank
- **`GET` `/v2/team/list`** — List Team V2 `list_team_v2_v2_team_list_get`  
  _Tags:_ team management
- **`GET` `/v2/user/info`** — User Info V2 `user_info_v2_v2_user_info_get`  
  _Tags:_ Internal User management

## `guardrails` — Guardrails (legacy v1)

- **`POST` `/guardrails`** — Create Guardrail `create_guardrail_guardrails_post`  
  _Tags:_ Guardrails
- **`POST` `/guardrails/apply_guardrail`** — Apply Guardrail `apply_guardrail_guardrails_apply_guardrail_post`
- **`GET` `/guardrails/list`** — List Guardrails `list_guardrails_guardrails_list_get`  
  _Tags:_ Guardrails
- **`POST` `/guardrails/register`** — Register Guardrail `register_guardrail_guardrails_register_post`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/submissions`** — List Guardrail Submissions `list_guardrail_submissions_guardrails_submissions_get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/submissions/{guardrail_id}`** — Get Guardrail Submission `get_guardrail_submission_guardrails_submissions__guardrail_id__get`  
  _Tags:_ Guardrails
- **`POST` `/guardrails/submissions/{guardrail_id}/approve`** — Approve Guardrail Submission `approve_guardrail_submission_guardrails_submissions__guardrail_id__approve_post`  
  _Tags:_ Guardrails
- **`POST` `/guardrails/submissions/{guardrail_id}/reject`** — Reject Guardrail Submission `reject_guardrail_submission_guardrails_submissions__guardrail_id__reject_post`  
  _Tags:_ Guardrails
- **`POST` `/guardrails/test_custom_code`** — Test Custom Code Guardrail `test_custom_code_guardrail_guardrails_test_custom_code_post`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/ui/add_guardrail_settings`** — Get Guardrail Ui Settings `get_guardrail_ui_settings_guardrails_ui_add_guardrail_settings_get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/ui/category_yaml/{category_name}`** — Get Category Yaml `get_category_yaml_guardrails_ui_category_yaml__category_name__get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/ui/major_airlines`** — Get Major Airlines `get_major_airlines_guardrails_ui_major_airlines_get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/ui/provider_specific_params`** — Get Provider Specific Params `get_provider_specific_params_guardrails_ui_provider_specific_params_get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/usage/detail/{guardrail_id}`** — Guardrails Usage Detail `guardrails_usage_detail_guardrails_usage_detail__guardrail_id__get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/usage/logs`** — Guardrails Usage Logs `guardrails_usage_logs_guardrails_usage_logs_get`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/usage/overview`** — Guardrails Usage Overview `guardrails_usage_overview_guardrails_usage_overview_get`  
  _Tags:_ Guardrails
- **`POST` `/guardrails/validate_blocked_words_file`** — Validate Blocked Words File `validate_blocked_words_file_guardrails_validate_blocked_words_file_post`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/{guardrail_id}`** — Get Guardrail Info `get_guardrail_info_guardrails__guardrail_id__get`  
  _Tags:_ Guardrails
- **`PUT` `/guardrails/{guardrail_id}`** — Update Guardrail `update_guardrail_guardrails__guardrail_id__put`  
  _Tags:_ Guardrails
- **`DELETE` `/guardrails/{guardrail_id}`** — Delete Guardrail `delete_guardrail_guardrails__guardrail_id__delete`  
  _Tags:_ Guardrails
- **`PATCH` `/guardrails/{guardrail_id}`** — Patch Guardrail `patch_guardrail_guardrails__guardrail_id__patch`  
  _Tags:_ Guardrails
- **`GET` `/guardrails/{guardrail_id}/info`** — Get Guardrail Info `get_guardrail_info_guardrails__guardrail_id__info_get`  
  _Tags:_ Guardrails

## `policies` — Policies

- **`POST` `/policies`** — Create Policy `create_policy_policies_post`  
  _Tags:_ Policies
- **`POST` `/policies/attachments`** — Create Policy Attachment `create_policy_attachment_policies_attachments_post`  
  _Tags:_ Policies
- **`POST` `/policies/attachments/estimate-impact`** — Estimate Attachment Impact `estimate_attachment_impact_policies_attachments_estimate_impact_post`  
  _Tags:_ Policies
- **`GET` `/policies/attachments/list`** — List Policy Attachments `list_policy_attachments_policies_attachments_list_get`  
  _Tags:_ Policies
- **`GET` `/policies/attachments/{attachment_id}`** — Get Policy Attachment `get_policy_attachment_policies_attachments__attachment_id__get`  
  _Tags:_ Policies
- **`DELETE` `/policies/attachments/{attachment_id}`** — Delete Policy Attachment `delete_policy_attachment_policies_attachments__attachment_id__delete`  
  _Tags:_ Policies
- **`GET` `/policies/compare`** — Compare Policy Versions `compare_policy_versions_policies_compare_get`  
  _Tags:_ Policies
- **`GET` `/policies/list`** — List Policies `list_policies_policies_list_get`  
  _Tags:_ Policies
- **`DELETE` `/policies/name/{policy_name}/all-versions`** — Delete All Policy Versions `delete_all_policy_versions_policies_name__policy_name__all_versions_delete`  
  _Tags:_ Policies
- **`GET` `/policies/name/{policy_name}/versions`** — List Policy Versions `list_policy_versions_policies_name__policy_name__versions_get`  
  _Tags:_ Policies
- **`POST` `/policies/name/{policy_name}/versions`** — Create Policy Version `create_policy_version_policies_name__policy_name__versions_post`  
  _Tags:_ Policies
- **`POST` `/policies/resolve`** — Resolve Policies For Context `resolve_policies_for_context_policies_resolve_post`  
  _Tags:_ Policies
- **`POST` `/policies/test-pipeline`** — Test Pipeline `test_pipeline_policies_test_pipeline_post`  
  _Tags:_ Policies
- **`GET` `/policies/usage/overview`** — Policies Usage Overview `policies_usage_overview_policies_usage_overview_get`  
  _Tags:_ Policies
- **`GET` `/policies/{policy_id}`** — Get Policy `get_policy_policies__policy_id__get`  
  _Tags:_ Policies
- **`PUT` `/policies/{policy_id}`** — Update Policy `update_policy_policies__policy_id__put`  
  _Tags:_ Policies
- **`DELETE` `/policies/{policy_id}`** — Delete Policy `delete_policy_policies__policy_id__delete`  
  _Tags:_ Policies
- **`GET` `/policies/{policy_id}/resolved-guardrails`** — Get Resolved Guardrails `get_resolved_guardrails_policies__policy_id__resolved_guardrails_get`  
  _Tags:_ Policies
- **`PUT` `/policies/{policy_id}/status`** — Update Policy Version Status `update_policy_version_status_policies__policy_id__status_put`  
  _Tags:_ Policies

## `policy` — Policies (legacy paths)

- **`GET` `/policy/info/{policy_name}`** — Get Policy Info `get_policy_info_policy_info__policy_name__get`  
  _Tags:_ policy management
- **`GET` `/policy/list`** — List Policies `list_policies_policy_list_get`  
  _Tags:_ policy management
- **`GET` `/policy/templates`** — Get Policy Templates `get_policy_templates_policy_templates_get`  
  _Tags:_ policy management
- **`POST` `/policy/templates/enrich`** — Enrich Policy Template `enrich_policy_template_policy_templates_enrich_post`  
  _Tags:_ policy management
- **`POST` `/policy/templates/enrich/stream`** — Enrich Policy Template Stream `enrich_policy_template_stream_policy_templates_enrich_stream_post`  
  _Tags:_ policy management
- **`POST` `/policy/templates/suggest`** — Suggest Policy Templates `suggest_policy_templates_policy_templates_suggest_post`  
  _Tags:_ policy management
- **`POST` `/policy/templates/test`** — Test Policy Template `test_policy_template_policy_templates_test_post`  
  _Tags:_ policy management
- **`POST` `/policy/test`** — Test Policy Matching `test_policy_matching_policy_test_post`  
  _Tags:_ policy management
- **`POST` `/policy/validate`** — Validate Policy `validate_policy_policy_validate_post`  
  _Tags:_ policy management

## `prompts` — Prompts

- **`POST` `/prompts`** — Create Prompt `create_prompt_prompts_post`  
  _Tags:_ Prompt Management
- **`GET` `/prompts/list`** — List Prompts `list_prompts_prompts_list_get`  
  _Tags:_ Prompt Management
- **`POST` `/prompts/test`** — Test Prompt `test_prompt_prompts_test_post`  
  _Tags:_ Prompt Management
- **`GET` `/prompts/{prompt_id}`** — Get Prompt Info `get_prompt_info_prompts__prompt_id__get`  
  _Tags:_ Prompt Management
- **`PUT` `/prompts/{prompt_id}`** — Update Prompt `update_prompt_prompts__prompt_id__put`  
  _Tags:_ Prompt Management
- **`DELETE` `/prompts/{prompt_id}`** — Delete Prompt `delete_prompt_prompts__prompt_id__delete`  
  _Tags:_ Prompt Management
- **`PATCH` `/prompts/{prompt_id}`** — Patch Prompt `patch_prompt_prompts__prompt_id__patch`  
  _Tags:_ Prompt Management
- **`GET` `/prompts/{prompt_id}/info`** — Get Prompt Info `get_prompt_info_prompts__prompt_id__info_get`  
  _Tags:_ Prompt Management
- **`GET` `/prompts/{prompt_id}/versions`** — Get Prompt Versions `get_prompt_versions_prompts__prompt_id__versions_get`  
  _Tags:_ Prompt Management

## `mcp-rest` — MCP REST (test/list/call)

- **`POST` `/mcp-rest/test/connection`** — Test Connection `test_connection_mcp_rest_test_connection_post`  
  _Tags:_ mcp
- **`POST` `/mcp-rest/test/tools/list`** — Test Tools List `test_tools_list_mcp_rest_test_tools_list_post`  
  _Tags:_ mcp
- **`POST` `/mcp-rest/tools/call`** — Call Tool Rest Api `call_tool_rest_api_mcp_rest_tools_call_post`  
  _Tags:_ mcp
- **`GET` `/mcp-rest/tools/list`** — List Tool Rest Api `list_tool_rest_api_mcp_rest_tools_list_get`  
  _Tags:_ mcp

## `.well-known (OAuth / JWKS / discovery)` — .well-known (OAuth / JWKS / discovery)

- **`GET` `/.well-known/jwks.json`** — Jwks Json `jwks_json__well_known_jwks_json_get`  
  _Tags:_ mcp
- **`GET` `/.well-known/litellm-ui-config`** — Get Ui Config `get_ui_config__well_known_litellm_ui_config_get`
- **`GET` `/.well-known/oauth-authorization-server`** — Oauth Authorization Server Mcp `oauth_authorization_server_mcp__well_known_oauth_authorization_server_get`  
  _Tags:_ mcp
- **`GET` `/.well-known/oauth-authorization-server/mcp/{mcp_server_name}`** — Oauth Authorization Server Mcp Standard `oauth_authorization_server_mcp_standard__well_known_oauth_authorization_server_mcp__mcp_server_name__get`  
  _Tags:_ mcp
- **`GET` `/.well-known/oauth-authorization-server/{mcp_server_name}`** — Oauth Authorization Server Mcp `oauth_authorization_server_mcp__well_known_oauth_authorization_server__mcp_server_name__get`  
  _Tags:_ mcp
- **`GET` `/.well-known/oauth-authorization-server/{mcp_server_name}/mcp`** — Oauth Authorization Server Legacy `oauth_authorization_server_legacy__well_known_oauth_authorization_server__mcp_server_name__mcp_get`  
  _Tags:_ mcp
- **`GET` `/.well-known/oauth-protected-resource`** — Oauth Protected Resource Mcp `oauth_protected_resource_mcp__well_known_oauth_protected_resource_get`  
  _Tags:_ mcp
- **`GET` `/.well-known/oauth-protected-resource/mcp/{mcp_server_name}`** — Oauth Protected Resource Mcp Standard `oauth_protected_resource_mcp_standard__well_known_oauth_protected_resource_mcp__mcp_server_name__get`  
  _Tags:_ mcp
- **`GET` `/.well-known/oauth-protected-resource/{mcp_server_name}/mcp`** — Oauth Protected Resource Mcp `oauth_protected_resource_mcp__well_known_oauth_protected_resource__mcp_server_name__mcp_get`  
  _Tags:_ mcp
- **`GET` `/.well-known/openid-configuration`** — Openid Configuration `openid_configuration__well_known_openid_configuration_get`  
  _Tags:_ mcp

## `key` — Virtual Keys & Auth

- **`GET` `/key/aliases`** — Key Aliases `key_aliases_key_aliases_get`  
  _Tags:_ key management
- **`POST` `/key/block`** — Block Key `block_key_key_block_post`  
  _Tags:_ key management
- **`POST` `/key/bulk_update`** — Bulk Update Keys `bulk_update_keys_key_bulk_update_post`  
  _Tags:_ key management
- **`POST` `/key/delete`** — Delete Key Fn `delete_key_fn_key_delete_post`  
  _Tags:_ key management
- **`POST` `/key/generate`** — Generate Key Fn `generate_key_fn_key_generate_post`  
  _Tags:_ key management
- **`POST` `/key/health`** — Key Health `key_health_key_health_post`  
  _Tags:_ key management
- **`GET` `/key/info`** — Info Key Fn `info_key_fn_key_info_get`  
  _Tags:_ key management
- **`GET` `/key/list`** — List Keys `list_keys_key_list_get`  
  _Tags:_ key management
- **`POST` `/key/regenerate`** — Regenerate Key Fn `regenerate_key_fn_key_regenerate_post`  
  _Tags:_ key management
- **`POST` `/key/service-account/generate`** — Generate Service Account Key Fn `generate_service_account_key_fn_key_service_account_generate_post`  
  _Tags:_ key management
- **`POST` `/key/unblock`** — Unblock Key `unblock_key_key_unblock_post`  
  _Tags:_ key management
- **`POST` `/key/update`** — Update Key Fn `update_key_fn_key_update_post`  
  _Tags:_ key management
- **`POST` `/key/{key}/regenerate`** — Regenerate Key Fn `regenerate_key_fn_key__key__regenerate_post`  
  _Tags:_ key management
- **`POST` `/key/{key}/reset_spend`** — Reset Key Spend Fn `reset_key_spend_fn_key__key__reset_spend_post`  
  _Tags:_ key management

## `user` — Users

- **`GET` `/user/available_users`** — Available Enterprise Users `available_enterprise_users_user_available_users_get`  
  _Tags:_ Internal User management
- **`POST` `/user/bulk_update`** — Bulk User Update `bulk_user_update_user_bulk_update_post`  
  _Tags:_ Internal User management
- **`GET` `/user/daily/activity`** — Get User Daily Activity `get_user_daily_activity_user_daily_activity_get`  
  _Tags:_ Budget & Spend Tracking, Internal User management
- **`GET` `/user/daily/activity/aggregated`** — Get User Daily Activity Aggregated `get_user_daily_activity_aggregated_user_daily_activity_aggregated_get`  
  _Tags:_ Budget & Spend Tracking, Internal User management
- **`POST` `/user/delete`** — Delete User `delete_user_user_delete_post`  
  _Tags:_ Internal User management
- **`GET` `/user/info`** — User Info `user_info_user_info_get`  
  _Tags:_ Internal User management
- **`GET` `/user/list`** — Get Users `get_users_user_list_get`  
  _Tags:_ Internal User management
- **`POST` `/user/new`** — New User `new_user_user_new_post`  
  _Tags:_ Internal User management
- **`POST` `/user/update`** — User Update `user_update_user_update_post`  
  _Tags:_ Internal User management

## `team` — Teams

- **`GET` `/team/available`** — List Available Teams `list_available_teams_team_available_get`
- **`POST` `/team/block`** — Block Team `block_team_team_block_post`  
  _Tags:_ team management
- **`POST` `/team/bulk_member_add`** — Bulk Team Member Add `bulk_team_member_add_team_bulk_member_add_post`  
  _Tags:_ team management
- **`GET` `/team/daily/activity`** — Get Team Daily Activity `get_team_daily_activity_team_daily_activity_get`  
  _Tags:_ team management
- **`POST` `/team/delete`** — Delete Team `delete_team_team_delete_post`  
  _Tags:_ team management
- **`GET` `/team/info`** — Team Info `team_info_team_info_get`  
  _Tags:_ team management
- **`GET` `/team/list`** — List Team `list_team_team_list_get`  
  _Tags:_ team management
- **`POST` `/team/member_add`** — Team Member Add `team_member_add_team_member_add_post`  
  _Tags:_ team management
- **`POST` `/team/member_delete`** — Team Member Delete `team_member_delete_team_member_delete_post`  
  _Tags:_ team management
- **`POST` `/team/member_update`** — Team Member Update `team_member_update_team_member_update_post`  
  _Tags:_ team management
- **`POST` `/team/model/add`** — Team Model Add `team_model_add_team_model_add_post`  
  _Tags:_ team management
- **`POST` `/team/model/delete`** — Team Model Delete `team_model_delete_team_model_delete_post`  
  _Tags:_ team management
- **`POST` `/team/new`** — New Team `new_team_team_new_post`  
  _Tags:_ team management
- **`GET` `/team/permissions_list`** — Team Member Permissions `team_member_permissions_team_permissions_list_get`  
  _Tags:_ team management
- **`POST` `/team/permissions_update`** — Update Team Member Permissions `update_team_member_permissions_team_permissions_update_post`  
  _Tags:_ team management
- **`POST` `/team/unblock`** — Unblock Team `unblock_team_team_unblock_post`  
  _Tags:_ team management
- **`POST` `/team/update`** — Update Team `update_team_team_update_post`  
  _Tags:_ team management
- **`GET` `/team/{team_id}/callback`** — Get Team Callbacks `get_team_callbacks_team__team_id__callback_get`  
  _Tags:_ team management
- **`POST` `/team/{team_id}/callback`** — Add Team Callbacks `add_team_callbacks_team__team_id__callback_post`  
  _Tags:_ team management
- **`POST` `/team/{team_id}/disable_logging`** — Disable Team Logging `disable_team_logging_team__team_id__disable_logging_post`  
  _Tags:_ team management

## `organization` — Organizations

- **`GET` `/organization/daily/activity`** — Get Organization Daily Activity `get_organization_daily_activity_organization_daily_activity_get`  
  _Tags:_ organization management
- **`DELETE` `/organization/delete`** — Delete Organization `delete_organization_organization_delete_delete`  
  _Tags:_ organization management
- **`GET` `/organization/info`** — Info Organization `info_organization_organization_info_get`  
  _Tags:_ organization management
- **`POST` `/organization/info`** — Deprecated Info Organization `deprecated_info_organization_organization_info_post`  
  _Tags:_ organization management
- **`GET` `/organization/list`** — List Organization `list_organization_organization_list_get`  
  _Tags:_ organization management
- **`POST` `/organization/member_add`** — Organization Member Add `organization_member_add_organization_member_add_post`  
  _Tags:_ organization management
- **`DELETE` `/organization/member_delete`** — Organization Member Delete `organization_member_delete_organization_member_delete_delete`  
  _Tags:_ organization management
- **`PATCH` `/organization/member_update`** — Organization Member Update `organization_member_update_organization_member_update_patch`  
  _Tags:_ organization management
- **`POST` `/organization/new`** — New Organization `new_organization_organization_new_post`  
  _Tags:_ organization management
- **`PATCH` `/organization/update`** — Update Organization `update_organization_organization_update_patch`  
  _Tags:_ organization management

## `project` — Projects

- **`DELETE` `/project/delete`** — Delete Project `delete_project_project_delete_delete`  
  _Tags:_ project management
- **`GET` `/project/info`** — Project Info `project_info_project_info_get`  
  _Tags:_ project management
- **`GET` `/project/list`** — List Projects `list_projects_project_list_get`  
  _Tags:_ project management
- **`POST` `/project/new`** — New Project `new_project_project_new_post`  
  _Tags:_ project management
- **`POST` `/project/update`** — Update Project `update_project_project_update_post`  
  _Tags:_ project management

## `customer` — Customers (end-users)

- **`POST` `/customer/block`** — Block User `block_user_customer_block_post`  
  _Tags:_ Customer Management
- **`GET` `/customer/daily/activity`** — Get Customer Daily Activity `get_customer_daily_activity_customer_daily_activity_get`  
  _Tags:_ Customer Management
- **`POST` `/customer/delete`** — Delete End User `delete_end_user_customer_delete_post`  
  _Tags:_ Customer Management
- **`GET` `/customer/info`** — End User Info `end_user_info_customer_info_get`  
  _Tags:_ Customer Management
- **`GET` `/customer/list`** — List End User `list_end_user_customer_list_get`  
  _Tags:_ Customer Management
- **`POST` `/customer/new`** — New End User `new_end_user_customer_new_post`  
  _Tags:_ Customer Management
- **`POST` `/customer/unblock`** — Unblock User `unblock_user_customer_unblock_post`  
  _Tags:_ Customer Management
- **`POST` `/customer/update`** — Update End User `update_end_user_customer_update_post`  
  _Tags:_ Customer Management

## `spend` — Spend

- **`POST` `/spend/calculate`** — Calculate Spend `calculate_spend_spend_calculate_post`  
  _Tags:_ Budget & Spend Tracking
- **`GET` `/spend/logs`** — View Spend Logs `view_spend_logs_spend_logs_get`  
  _Tags:_ Budget & Spend Tracking
- **`GET` `/spend/logs/v2`** — Ui View Spend Logs `ui_view_spend_logs_spend_logs_v2_get`  
  _Tags:_ Budget & Spend Tracking
- **`GET` `/spend/tags`** — View Spend Tags `view_spend_tags_spend_tags_get`  
  _Tags:_ Budget & Spend Tracking

## `budget` — Budgets

- **`POST` `/budget/delete`** — Delete Budget `delete_budget_budget_delete_post`  
  _Tags:_ budget management
- **`POST` `/budget/info`** — Info Budget `info_budget_budget_info_post`  
  _Tags:_ budget management
- **`GET` `/budget/list`** — List Budget `list_budget_budget_list_get`  
  _Tags:_ budget management
- **`POST` `/budget/new`** — New Budget `new_budget_budget_new_post`  
  _Tags:_ budget management
- **`GET` `/budget/settings`** — Budget Settings `budget_settings_budget_settings_get`  
  _Tags:_ budget management
- **`POST` `/budget/update`** — Update Budget `update_budget_budget_update_post`  
  _Tags:_ budget management

## `global` — Global spend

- **`GET` `/global/spend/report`** — Get Global Spend Report `get_global_spend_report_global_spend_report_get`  
  _Tags:_ Budget & Spend Tracking
- **`POST` `/global/spend/reset`** — Global Spend Reset `global_spend_reset_global_spend_reset_post`  
  _Tags:_ Budget & Spend Tracking
- **`GET` `/global/spend/tags`** — Global View Spend Tags `global_view_spend_tags_global_spend_tags_get`  
  _Tags:_ Budget & Spend Tracking

## `provider` — Provider budgets

- **`GET` `/provider/budgets`** — Provider Budgets `provider_budgets_provider_budgets_get`

## `cost` — Cost

- **`POST` `/cost/estimate`** — Estimate Cost `estimate_cost_cost_estimate_post`  
  _Tags:_ Cost Tracking

## `tag` — Tags & analytics

- **`GET` `/tag/daily/activity`** — Get Tag Daily Activity `get_tag_daily_activity_tag_daily_activity_get`  
  _Tags:_ tag management
- **`GET` `/tag/dau`** — Get Daily Active Users `get_daily_active_users_tag_dau_get`  
  _Tags:_ tag management, user agent analytics
- **`POST` `/tag/delete`** — Delete Tag `delete_tag_tag_delete_post`  
  _Tags:_ tag management
- **`GET` `/tag/distinct`** — Get Distinct User Agent Tags `get_distinct_user_agent_tags_tag_distinct_get`  
  _Tags:_ tag management, user agent analytics
- **`POST` `/tag/info`** — Info Tag `info_tag_tag_info_post`  
  _Tags:_ tag management
- **`GET` `/tag/list`** — List Tags `list_tags_tag_list_get`  
  _Tags:_ tag management
- **`GET` `/tag/mau`** — Get Monthly Active Users `get_monthly_active_users_tag_mau_get`  
  _Tags:_ tag management, user agent analytics
- **`POST` `/tag/new`** — New Tag `new_tag_tag_new_post`  
  _Tags:_ tag management
- **`GET` `/tag/summary`** — Get Tag Summary `get_tag_summary_tag_summary_get`  
  _Tags:_ tag management, user agent analytics
- **`POST` `/tag/update`** — Update Tag `update_tag_tag_update_post`  
  _Tags:_ tag management
- **`GET` `/tag/user-agent/per-user-analytics`** — Get Per User Analytics `get_per_user_analytics_tag_user_agent_per_user_analytics_get`  
  _Tags:_ tag management, user agent analytics
- **`GET` `/tag/wau`** — Get Weekly Active Users `get_weekly_active_users_tag_wau_get`  
  _Tags:_ tag management, user agent analytics

## `audit` — Audit logs

- **`GET` `/audit`** — Get Audit Logs `get_audit_logs_audit_get`  
  _Tags:_ Audit Logging
- **`GET` `/audit/{id}`** — Get Audit Log By Id `get_audit_log_by_id_audit__id__get`  
  _Tags:_ Audit Logging

## `api` — Event logging

- **`POST` `/api/event_logging/batch`** — Event Logging Batch `event_logging_batch_api_event_logging_batch_post`  
  _Tags:_ [beta] Anthropic Event Logging

## `health` — Health & readiness

- **`GET` `/health`** — Health Endpoint `health_endpoint_health_get`  
  _Tags:_ health
- **`GET` `/health/backlog`** — Health Backlog `health_backlog_health_backlog_get`  
  _Tags:_ health
- **`GET` `/health/history`** — Health Check History Endpoint `health_check_history_endpoint_health_history_get`  
  _Tags:_ health
- **`GET` `/health/latest`** — Latest Health Checks Endpoint `latest_health_checks_endpoint_health_latest_get`  
  _Tags:_ health
- **`GET` `/health/license`** — Health License Endpoint `health_license_endpoint_health_license_get`  
  _Tags:_ health
- **`GET` `/health/liveliness`** — Health Liveliness `health_liveliness_health_liveliness_get`  
  _Tags:_ health
- **`OPTIONS` `/health/liveliness`** — Health Liveliness Options `health_liveliness_options_health_liveliness_options`  
  _Tags:_ health
- **`GET` `/health/liveness`** — Health Liveliness `health_liveliness_health_liveness_get`  
  _Tags:_ health
- **`OPTIONS` `/health/liveness`** — Health Liveliness Options `health_liveliness_options_health_liveness_options`  
  _Tags:_ health
- **`GET` `/health/readiness`** — Health Readiness `health_readiness_health_readiness_get`  
  _Tags:_ health
- **`OPTIONS` `/health/readiness`** — Health Readiness Options `health_readiness_options_health_readiness_options`  
  _Tags:_ health
- **`GET` `/health/services`** — Health Services Endpoint `health_services_endpoint_health_services_get`  
  _Tags:_ health
- **`GET` `/health/shared-status`** — Shared Health Check Status Endpoint `shared_health_check_status_endpoint_health_shared_status_get`  
  _Tags:_ health
- **`POST` `/health/test_connection`** — Test Model Connection `test_model_connection_health_test_connection_post`  
  _Tags:_ health

## `vector_stores` — Vector stores (bare paths)

- **`GET` `/vector_stores`** — Vector Store List `vector_store_list_vector_stores_get`
- **`POST` `/vector_stores`** — Vector Store Create `vector_store_create_vector_stores_post`
- **`GET` `/vector_stores/{vector_store_id}`** — Vector Store Retrieve `vector_store_retrieve_vector_stores__vector_store_id__get`
- **`POST` `/vector_stores/{vector_store_id}`** — Vector Store Update `vector_store_update_vector_stores__vector_store_id__post`
- **`DELETE` `/vector_stores/{vector_store_id}`** — Vector Store Delete `vector_store_delete_vector_stores__vector_store_id__delete`
- **`GET` `/vector_stores/{vector_store_id}/files`** — Vector Store File List `vector_store_file_list_vector_stores__vector_store_id__files_get`  
  _Tags:_ vector_store_files
- **`POST` `/vector_stores/{vector_store_id}/files`** — Vector Store File Create `vector_store_file_create_vector_stores__vector_store_id__files_post`  
  _Tags:_ vector_store_files
- **`GET` `/vector_stores/{vector_store_id}/files/{file_id}`** — Vector Store File Retrieve `vector_store_file_retrieve_vector_stores__vector_store_id__files__file_id__get`  
  _Tags:_ vector_store_files
- **`POST` `/vector_stores/{vector_store_id}/files/{file_id}`** — Vector Store File Update `vector_store_file_update_vector_stores__vector_store_id__files__file_id__post`  
  _Tags:_ vector_store_files
- **`DELETE` `/vector_stores/{vector_store_id}/files/{file_id}`** — Vector Store File Delete `vector_store_file_delete_vector_stores__vector_store_id__files__file_id__delete`  
  _Tags:_ vector_store_files
- **`GET` `/vector_stores/{vector_store_id}/files/{file_id}/content`** — Vector Store File Content `vector_store_file_content_vector_stores__vector_store_id__files__file_id__content_get`  
  _Tags:_ vector_store_files
- **`POST` `/vector_stores/{vector_store_id}/search`** — Vector Store Search `vector_store_search_vector_stores__vector_store_id__search_post`

## `vector_store` — Vector stores (legacy paths)

- **`POST` `/vector_store/delete`** — Delete Vector Store `delete_vector_store_vector_store_delete_post`  
  _Tags:_ vector store management
- **`POST` `/vector_store/info`** — Get Vector Store Info `get_vector_store_info_vector_store_info_post`  
  _Tags:_ vector store management
- **`GET` `/vector_store/list`** — List Vector Stores `list_vector_stores_vector_store_list_get`  
  _Tags:_ vector store management
- **`POST` `/vector_store/new`** — New Vector Store `new_vector_store_vector_store_new_post`  
  _Tags:_ vector store management
- **`POST` `/vector_store/update`** — Update Vector Store `update_vector_store_vector_store_update_post`  
  _Tags:_ vector store management

## `rag` — RAG (legacy)

- **`POST` `/rag/ingest`** — Rag Ingest `rag_ingest_rag_ingest_post`  
  _Tags:_ rag
- **`POST` `/rag/query`** — Rag Query `rag_query_rag_query_post`  
  _Tags:_ rag

## `rerank` — Rerank (legacy)

- **`POST` `/rerank`** — Rerank `rerank_rerank_post`  
  _Tags:_ rerank

## `ocr` — OCR (legacy)

- **`POST` `/ocr`** — Ocr `ocr_ocr_post`  
  _Tags:_ ocr

## `search_tools` — Search tools

- **`POST` `/search_tools`** — Create Search Tool `create_search_tool_search_tools_post`  
  _Tags:_ Search Tools
- **`GET` `/search_tools/list`** — List Search Tools `list_search_tools_search_tools_list_get`  
  _Tags:_ Search Tools
- **`POST` `/search_tools/test_connection`** — Test Search Tool Connection `test_search_tool_connection_search_tools_test_connection_post`  
  _Tags:_ Search Tools
- **`GET` `/search_tools/ui/available_providers`** — Get Available Search Providers `get_available_search_providers_search_tools_ui_available_providers_get`  
  _Tags:_ Search Tools
- **`GET` `/search_tools/{search_tool_id}`** — Get Search Tool Info `get_search_tool_info_search_tools__search_tool_id__get`  
  _Tags:_ Search Tools
- **`PUT` `/search_tools/{search_tool_id}`** — Update Search Tool `update_search_tool_search_tools__search_tool_id__put`  
  _Tags:_ Search Tools
- **`DELETE` `/search_tools/{search_tool_id}`** — Delete Search Tool `delete_search_tool_search_tools__search_tool_id__delete`  
  _Tags:_ Search Tools

## `search` — Search (legacy)

- **`POST` `/search`** — Search `search_search_post`  
  _Tags:_ search
- **`GET` `/search/tools`** — List Search Tools `list_search_tools_search_tools_get`  
  _Tags:_ search
- **`POST` `/search/{search_tool_name}`** — Search `search_search__search_tool_name__post`  
  _Tags:_ search

## `apply_guardrail` — Apply guardrail (root)

- **`POST` `/apply_guardrail`** — Apply Guardrail `apply_guardrail_apply_guardrail_post`

## `files` — Files (bare paths)

- **`GET` `/files`** — List Files `list_files_files_get`  
  _Tags:_ files
- **`POST` `/files`** — Create File `create_file_files_post`  
  _Tags:_ files
- **`GET` `/files/{file_id}`** — Get File `get_file_files__file_id__get`  
  _Tags:_ files
- **`DELETE` `/files/{file_id}`** — Delete File `delete_file_files__file_id__delete`  
  _Tags:_ files
- **`GET` `/files/{file_id}/content`** — Get File Content `get_file_content_files__file_id__content_get`  
  _Tags:_ files

## `batches` — Batches (bare paths)

- **`GET` `/batches`** — List Batches `list_batches_batches_get`  
  _Tags:_ batch
- **`POST` `/batches`** — Create Batch `create_batch_batches_post`  
  _Tags:_ batch
- **`GET` `/batches/{batch_id}`** — Retrieve Batch `retrieve_batch_batches__batch_id__get`  
  _Tags:_ batch
- **`POST` `/batches/{batch_id}/cancel`** — Cancel Batch `cancel_batch_batches__batch_id__cancel_post`  
  _Tags:_ batch

## `fine_tuning` — Fine-tuning (legacy)

- **`GET` `/fine_tuning/jobs`** — ✨ (Enterprise) List Fine-Tuning Jobs `list_fine_tuning_jobs_fine_tuning_jobs_get`  
  _Tags:_ fine-tuning
- **`POST` `/fine_tuning/jobs`** — ✨ (Enterprise) Create Fine-Tuning Job `create_fine_tuning_job_fine_tuning_jobs_post`  
  _Tags:_ fine-tuning
- **`GET` `/fine_tuning/jobs/{fine_tuning_job_id}`** — ✨ (Enterprise) Retrieve Fine-Tuning Job `retrieve_fine_tuning_job_fine_tuning_jobs__fine_tuning_job_id__get`  
  _Tags:_ fine-tuning
- **`POST` `/fine_tuning/jobs/{fine_tuning_job_id}/cancel`** — ✨ (Enterprise) Cancel Fine-Tuning Jobs `cancel_fine_tuning_job_fine_tuning_jobs__fine_tuning_job_id__cancel_post`  
  _Tags:_ fine-tuning

## `audio` — Audio (legacy)

- **`POST` `/audio/speech`** — Audio Speech `audio_speech_audio_speech_post`  
  _Tags:_ audio
- **`POST` `/audio/transcriptions`** — Audio Transcriptions `audio_transcriptions_audio_transcriptions_post`  
  _Tags:_ audio

## `images` — Images (legacy)

- **`POST` `/images/edits`** — Image Edit Api `image_edit_api_images_edits_post`  
  _Tags:_ images
- **`POST` `/images/generations`** — Image Generation `image_generation_images_generations_post`  
  _Tags:_ images

## `videos` — Videos (legacy)

- **`GET` `/videos`** — Video List `video_list_videos_get`  
  _Tags:_ videos
- **`POST` `/videos`** — Video Generation `video_generation_videos_post`  
  _Tags:_ videos
- **`POST` `/videos/characters`** — Video Create Character `video_create_character_videos_characters_post`  
  _Tags:_ videos
- **`GET` `/videos/characters/{character_id}`** — Video Get Character `video_get_character_videos_characters__character_id__get`  
  _Tags:_ videos
- **`POST` `/videos/edits`** — Video Edit `video_edit_videos_edits_post`  
  _Tags:_ videos
- **`POST` `/videos/extensions`** — Video Extension `video_extension_videos_extensions_post`  
  _Tags:_ videos
- **`GET` `/videos/{video_id}`** — Video Status `video_status_videos__video_id__get`  
  _Tags:_ videos
- **`GET` `/videos/{video_id}/content`** — Video Content `video_content_videos__video_id__content_get`  
  _Tags:_ videos
- **`POST` `/videos/{video_id}/remix`** — Video Remix `video_remix_videos__video_id__remix_post`  
  _Tags:_ videos

## `containers` — Containers (legacy)

- **`GET` `/containers`** — List Containers `list_containers_containers_get`  
  _Tags:_ containers
- **`POST` `/containers`** — Create Container `create_container_containers_post`  
  _Tags:_ containers
- **`GET` `/containers/{container_id}`** — Retrieve Container `retrieve_container_containers__container_id__get`  
  _Tags:_ containers
- **`DELETE` `/containers/{container_id}`** — Delete Container `delete_container_containers__container_id__delete`  
  _Tags:_ containers
- **`GET` `/containers/{container_id}/files`** — Handler Container Id `handler_container_id_containers__container_id__files_get`  
  _Tags:_ containers
- **`POST` `/containers/{container_id}/files`** — Handler Multipart Upload `handler_multipart_upload_containers__container_id__files_post`  
  _Tags:_ containers
- **`GET` `/containers/{container_id}/files/{file_id}`** — Handler Container File `handler_container_file_containers__container_id__files__file_id__get`  
  _Tags:_ containers
- **`DELETE` `/containers/{container_id}/files/{file_id}`** — Handler Container File `handler_container_file_containers__container_id__files__file_id__delete`  
  _Tags:_ containers
- **`GET` `/containers/{container_id}/files/{file_id}/content`** — Handler Binary Content `handler_binary_content_containers__container_id__files__file_id__content_get`  
  _Tags:_ containers

## `realtime` — Realtime (legacy)

- **`GET` `/realtime`** — WebSocket: realtime_websocket_endpoint `websocket_realtime_websocket_endpoint`  
  _Tags:_ WebSocket
- **`POST` `/realtime/calls`** — Proxy Realtime Calls `proxy_realtime_calls_realtime_calls_post`  
  _Tags:_ realtime
- **`POST` `/realtime/client_secrets`** — Create Realtime Client Secret `create_realtime_client_secret_realtime_client_secrets_post`  
  _Tags:_ realtime

## `a2a` — A2A (legacy)

- **`POST` `/a2a/{agent_id}`** — Invoke Agent A2A `invoke_agent_a2a_a2a__agent_id__post`  
  _Tags:_ [beta] A2A Agents
- **`GET` `/a2a/{agent_id}/.well-known/agent-card.json`** — Get Agent Card `get_agent_card_a2a__agent_id___well_known_agent_card_json_get`  
  _Tags:_ [beta] A2A Agents
- **`GET` `/a2a/{agent_id}/.well-known/agent.json`** — Get Agent Card `get_agent_card_a2a__agent_id___well_known_agent_json_get`  
  _Tags:_ [beta] A2A Agents
- **`POST` `/a2a/{agent_id}/message/send`** — Invoke Agent A2A `invoke_agent_a2a_a2a__agent_id__message_send_post`  
  _Tags:_ [beta] A2A Agents

## `v1beta` — Interactions (v1beta)

- **`POST` `/v1beta/interactions`** — Create Interaction `create_interaction_v1beta_interactions_post`  
  _Tags:_ google genai endpoints, interactions
- **`GET` `/v1beta/interactions/{interaction_id}`** — Get Interaction `get_interaction_v1beta_interactions__interaction_id__get`  
  _Tags:_ google genai endpoints, interactions
- **`DELETE` `/v1beta/interactions/{interaction_id}`** — Delete Interaction `delete_interaction_v1beta_interactions__interaction_id__delete`  
  _Tags:_ google genai endpoints, interactions
- **`POST` `/v1beta/interactions/{interaction_id}/cancel`** — Cancel Interaction `cancel_interaction_v1beta_interactions__interaction_id__cancel_post`  
  _Tags:_ google genai endpoints, interactions
- **`POST` `/v1beta/models/{model_name}:countTokens`** — Google Count Tokens `google_count_tokens_v1beta_models__model_name__countTokens_post`  
  _Tags:_ google genai endpoints
- **`POST` `/v1beta/models/{model_name}:generateContent`** — Google Generate Content `google_generate_content_v1beta_models__model_name__generateContent_post`  
  _Tags:_ google genai endpoints
- **`POST` `/v1beta/models/{model_name}:streamGenerateContent`** — Google Stream Generate Content `google_stream_generate_content_v1beta_models__model_name__streamGenerateContent_post`  
  _Tags:_ google genai endpoints

## `interactions` — Interactions (legacy)

- **`POST` `/interactions`** — Create Interaction `create_interaction_interactions_post`  
  _Tags:_ google genai endpoints, interactions
- **`GET` `/interactions/{interaction_id}`** — Get Interaction `get_interaction_interactions__interaction_id__get`  
  _Tags:_ google genai endpoints, interactions
- **`DELETE` `/interactions/{interaction_id}`** — Delete Interaction `delete_interaction_interactions__interaction_id__delete`  
  _Tags:_ google genai endpoints, interactions
- **`POST` `/interactions/{interaction_id}/cancel`** — Cancel Interaction `cancel_interaction_interactions__interaction_id__cancel_post`  
  _Tags:_ google genai endpoints, interactions

## `assistants` — Assistants (legacy)

- **`GET` `/assistants`** — Get Assistants `get_assistants_assistants_get`  
  _Tags:_ assistants
- **`POST` `/assistants`** — Create Assistant `create_assistant_assistants_post`  
  _Tags:_ assistants
- **`DELETE` `/assistants/{assistant_id}`** — Delete Assistant `delete_assistant_assistants__assistant_id__delete`  
  _Tags:_ assistants

## `threads` — Threads (legacy)

- **`POST` `/threads`** — Create Threads `create_threads_threads_post`  
  _Tags:_ assistants
- **`GET` `/threads/{thread_id}`** — Get Thread `get_thread_threads__thread_id__get`  
  _Tags:_ assistants
- **`GET` `/threads/{thread_id}/messages`** — Get Messages `get_messages_threads__thread_id__messages_get`  
  _Tags:_ assistants
- **`POST` `/threads/{thread_id}/messages`** — Add Messages `add_messages_threads__thread_id__messages_post`  
  _Tags:_ assistants
- **`POST` `/threads/{thread_id}/runs`** — Run Thread `run_thread_threads__thread_id__runs_post`  
  _Tags:_ assistants

## `callback` — Callback (singular)

- **`GET` `/callback`** — Callback `callback_callback_get`  
  _Tags:_ mcp

## `callbacks` — Callbacks

- **`GET` `/callbacks/configs`** — Get Callback Configs `get_callback_configs_callbacks_configs_get`  
  _Tags:_ Logging Callbacks
- **`GET` `/callbacks/list`** — List Callbacks `list_callbacks_callbacks_list_get`  
  _Tags:_ Logging Callbacks

## `router` — Router

- **`GET` `/router/fields`** — Get Router Fields `get_router_fields_router_fields_get`  
  _Tags:_ Router Settings
- **`GET` `/router/settings`** — Get Router Settings `get_router_settings_router_settings_get`  
  _Tags:_ Router Settings

## `credentials` — Credentials

- **`GET` `/credentials`** — Get Credentials `get_credentials_credentials_get`  
  _Tags:_ credential management
- **`POST` `/credentials`** — Create Credential `create_credential_credentials_post`  
  _Tags:_ credential management
- **`GET` `/credentials/by_model/{model_id}`** — Get Credential By Model `get_credential_by_model_credentials_by_model__model_id__get`  
  _Tags:_ credential management
- **`GET` `/credentials/by_name/{credential_name}`** — Get Credential By Name `get_credential_by_name_credentials_by_name__credential_name__get`  
  _Tags:_ credential management
- **`DELETE` `/credentials/{credential_name}`** — Delete Credential `delete_credential_credentials__credential_name__delete`  
  _Tags:_ credential management
- **`PATCH` `/credentials/{credential_name}`** — Update Credential `update_credential_credentials__credential_name__patch`  
  _Tags:_ credential management

## `cache` — Cache

- **`POST` `/cache/delete`** — Cache Delete `cache_delete_cache_delete_post`  
  _Tags:_ caching, caching
- **`POST` `/cache/flushall`** — Cache Flushall `cache_flushall_cache_flushall_post`  
  _Tags:_ caching, caching
- **`GET` `/cache/ping`** — Cache Ping `cache_ping_cache_ping_get`  
  _Tags:_ caching
- **`GET` `/cache/redis/info`** — Cache Redis Info `cache_redis_info_cache_redis_info_get`  
  _Tags:_ caching
- **`GET` `/cache/settings`** — Get Cache Settings `get_cache_settings_cache_settings_get`  
  _Tags:_ Cache Settings
- **`POST` `/cache/settings`** — Update Cache Settings `update_cache_settings_cache_settings_post`  
  _Tags:_ Cache Settings
- **`POST` `/cache/settings/test`** — Test Cache Connection `test_cache_connection_cache_settings_test_post`  
  _Tags:_ Cache Settings

## `access_group` — Access groups (legacy)

- **`GET` `/access_group/list`** — List Access Groups `list_access_groups_access_group_list_get`  
  _Tags:_ model management
- **`POST` `/access_group/new`** — Create Model Group `create_model_group_access_group_new_post`  
  _Tags:_ model management
- **`DELETE` `/access_group/{access_group}/delete`** — Delete Access Group `delete_access_group_access_group__access_group__delete_delete`  
  _Tags:_ model management
- **`GET` `/access_group/{access_group}/info`** — Get Access Group Info `get_access_group_info_access_group__access_group__info_get`  
  _Tags:_ model management
- **`PUT` `/access_group/{access_group}/update`** — Update Access Group `update_access_group_access_group__access_group__update_put`  
  _Tags:_ model management

## `add` — Add (allowed IPs)

- **`POST` `/add/allowed_ip`** — Add Allowed Ip `add_allowed_ip_add_allowed_ip_post`  
  _Tags:_ Budget & Spend Tracking

## `delete` — Delete (allowed IPs)

- **`POST` `/delete/allowed_ip`** — Delete Allowed Ip `delete_allowed_ip_delete_allowed_ip_post`  
  _Tags:_ Budget & Spend Tracking

## `jwt` — JWT keys

- **`POST` `/jwt/key/mapping/delete`** — Delete Jwt Key Mapping `delete_jwt_key_mapping_jwt_key_mapping_delete_post`  
  _Tags:_ JWT Key Mapping
- **`GET` `/jwt/key/mapping/info`** — Info Jwt Key Mapping `info_jwt_key_mapping_jwt_key_mapping_info_get`  
  _Tags:_ JWT Key Mapping
- **`GET` `/jwt/key/mapping/list`** — List Jwt Key Mappings `list_jwt_key_mappings_jwt_key_mapping_list_get`  
  _Tags:_ JWT Key Mapping
- **`POST` `/jwt/key/mapping/new`** — Create Jwt Key Mapping `create_jwt_key_mapping_jwt_key_mapping_new_post`  
  _Tags:_ JWT Key Mapping
- **`POST` `/jwt/key/mapping/update`** — Update Jwt Key Mapping `update_jwt_key_mapping_jwt_key_mapping_update_post`  
  _Tags:_ JWT Key Mapping

## `sso` — SSO

- **`GET` `/sso/readiness`** — Sso Readiness `sso_readiness_sso_readiness_get`  
  _Tags:_ experimental

## `get` — Get settings

- **`GET` `/get/default_team_settings`** — Get Default Team Settings `get_default_team_settings_get_default_team_settings_get`  
  _Tags:_ SSO Settings
- **`GET` `/get/internal_user_settings`** — Get Internal User Settings `get_internal_user_settings_get_internal_user_settings_get`  
  _Tags:_ SSO Settings
- **`GET` `/get/mcp_semantic_filter_settings`** — Get Mcp Semantic Filter Settings `get_mcp_semantic_filter_settings_get_mcp_semantic_filter_settings_get`  
  _Tags:_ Settings
- **`GET` `/get/sso_settings`** — Get Sso Settings `get_sso_settings_get_sso_settings_get`  
  _Tags:_ SSO Settings
- **`GET` `/get/ui_settings`** — Get Ui Settings `get_ui_settings_get_ui_settings_get`  
  _Tags:_ UI Settings
- **`GET` `/get/ui_theme_settings`** — Get Ui Theme Settings `get_ui_theme_settings_get_ui_theme_settings_get`  
  _Tags:_ UI Theme Settings

## `update` — Update settings

- **`PATCH` `/update/default_team_settings`** — Update Default Team Settings `update_default_team_settings_update_default_team_settings_patch`  
  _Tags:_ SSO Settings
- **`PATCH` `/update/internal_user_settings`** — Update Internal User Settings `update_internal_user_settings_update_internal_user_settings_patch`  
  _Tags:_ SSO Settings
- **`PATCH` `/update/mcp_semantic_filter_settings`** — Update Mcp Semantic Filter Settings `update_mcp_semantic_filter_settings_update_mcp_semantic_filter_settings_patch`  
  _Tags:_ Settings
- **`PATCH` `/update/sso_settings`** — Update Sso Settings `update_sso_settings_update_sso_settings_patch`  
  _Tags:_ SSO Settings
- **`PATCH` `/update/ui_settings`** — Update Ui Settings `update_ui_settings_update_ui_settings_patch`  
  _Tags:_ UI Settings
- **`PATCH` `/update/ui_theme_settings`** — Update Ui Theme Settings `update_ui_theme_settings_update_ui_theme_settings_patch`  
  _Tags:_ UI Theme Settings

## `upload` — Upload (logo)

- **`POST` `/upload/logo`** — Upload Logo `upload_logo_upload_logo_post`  
  _Tags:_ UI Theme Settings

## `fallback` — Fallbacks

- **`POST` `/fallback`** — Create Fallback `create_fallback_fallback_post`  
  _Tags:_ Fallback Management
- **`GET` `/fallback/{model}`** — Get Fallback `get_fallback_fallback__model__get`  
  _Tags:_ Fallback Management
- **`DELETE` `/fallback/{model}`** — Delete Fallback `delete_fallback_fallback__model__delete`  
  _Tags:_ Fallback Management

## `config` — Config

- **`GET` `/config/cost_discount_config`** — Get Cost Discount Config `get_cost_discount_config_config_cost_discount_config_get`  
  _Tags:_ Cost Tracking
- **`PATCH` `/config/cost_discount_config`** — Update Cost Discount Config `update_cost_discount_config_config_cost_discount_config_patch`  
  _Tags:_ Cost Tracking
- **`GET` `/config/cost_margin_config`** — Get Cost Margin Config `get_cost_margin_config_config_cost_margin_config_get`  
  _Tags:_ Cost Tracking
- **`PATCH` `/config/cost_margin_config`** — Update Cost Margin Config `update_cost_margin_config_config_cost_margin_config_patch`  
  _Tags:_ Cost Tracking
- **`GET` `/config/pass_through_endpoint`** — Get Pass Through Endpoints `get_pass_through_endpoints_config_pass_through_endpoint_get`
- **`POST` `/config/pass_through_endpoint`** — Create Pass Through Endpoints `create_pass_through_endpoints_config_pass_through_endpoint_post`
- **`DELETE` `/config/pass_through_endpoint`** — Delete Pass Through Endpoints `delete_pass_through_endpoints_config_pass_through_endpoint_delete`
- **`GET` `/config/pass_through_endpoint/team/{team_id}`** — Get Pass Through Endpoints `get_pass_through_endpoints_config_pass_through_endpoint_team__team_id__get`
- **`POST` `/config/pass_through_endpoint/{endpoint_id}`** — Update Pass Through Endpoints `update_pass_through_endpoints_config_pass_through_endpoint__endpoint_id__post`

## `config_overrides` — Config overrides

- **`GET` `/config_overrides/hashicorp_vault`** — Get Hashicorp Vault Config `get_hashicorp_vault_config_config_overrides_hashicorp_vault_get`  
  _Tags:_ Config Overrides
- **`POST` `/config_overrides/hashicorp_vault`** — Update Hashicorp Vault Config `update_hashicorp_vault_config_config_overrides_hashicorp_vault_post`  
  _Tags:_ Config Overrides
- **`DELETE` `/config_overrides/hashicorp_vault`** — Delete Hashicorp Vault Config `delete_hashicorp_vault_config_config_overrides_hashicorp_vault_delete`  
  _Tags:_ Config Overrides
- **`POST` `/config_overrides/hashicorp_vault/test_connection`** — Test Hashicorp Vault Connection `test_hashicorp_vault_connection_config_overrides_hashicorp_vault_test_connection_post`  
  _Tags:_ Config Overrides

## `settings` — Settings

- **`GET` `/settings`** — Active Callbacks `active_callbacks_settings_get`  
  _Tags:_ health

## `litellm` — litellm/ (UI config)

- **`GET` `/litellm/.well-known/litellm-ui-config`** — Get Ui Config `get_ui_config_litellm__well_known_litellm_ui_config_get`

## `public` — Public

- **`GET` `/public/agent_hub`** — Get Agents `get_agents_public_agent_hub_get`  
  _Tags:_ [beta] Agents, public
- **`GET` `/public/agents/fields`** — Get Agent Fields `get_agent_fields_public_agents_fields_get`  
  _Tags:_ public, [beta] Agents
- **`GET` `/public/endpoints`** — Get Supported Endpoints `get_supported_endpoints_public_endpoints_get`  
  _Tags:_ public
- **`GET` `/public/litellm_blog_posts`** — Get Litellm Blog Posts `get_litellm_blog_posts_public_litellm_blog_posts_get`  
  _Tags:_ public
- **`GET` `/public/litellm_model_cost_map`** — Get Litellm Model Cost Map `get_litellm_model_cost_map_public_litellm_model_cost_map_get`  
  _Tags:_ public, model management
- **`GET` `/public/mcp_hub`** — Get Mcp Servers `get_mcp_servers_public_mcp_hub_get`  
  _Tags:_ [beta] MCP, public
- **`GET` `/public/model_hub`** — Public Model Hub `public_model_hub_public_model_hub_get`  
  _Tags:_ public, model management
- **`GET` `/public/model_hub/info`** — Public Model Hub Info `public_model_hub_info_public_model_hub_info_get`  
  _Tags:_ public, model management
- **`GET` `/public/providers`** — Get Supported Providers `get_supported_providers_public_providers_get`  
  _Tags:_ public, providers
- **`GET` `/public/providers/fields`** — Get Provider Fields `get_provider_fields_public_providers_fields_get`  
  _Tags:_ public, providers

## `Provider Pass-through — openai` — Provider Pass-through · OpenAI

- **`POST` `/openai/deployments/{model}/chat/completions`** — Chat Completion `chat_completion_openai_deployments__model__chat_completions_post`  
  _Tags:_ chat/completions
- **`POST` `/openai/deployments/{model}/completions`** — Completion `completion_openai_deployments__model__completions_post`  
  _Tags:_ completions
- **`POST` `/openai/deployments/{model}/embeddings`** — Embeddings `embeddings_openai_deployments__model__embeddings_post`  
  _Tags:_ embeddings
- **`POST` `/openai/deployments/{model}/images/edits`** — Image Edit Api `image_edit_api_openai_deployments__model__images_edits_post`  
  _Tags:_ images
- **`POST` `/openai/deployments/{model}/images/generations`** — Image Generation `image_generation_openai_deployments__model__images_generations_post`  
  _Tags:_ images
- **`POST` `/openai/v1/realtime/calls`** — Proxy Realtime Calls `proxy_realtime_calls_openai_v1_realtime_calls_post`  
  _Tags:_ realtime
- **`POST` `/openai/v1/realtime/client_secrets`** — Create Realtime Client Secret `create_realtime_client_secret_openai_v1_realtime_client_secrets_post`  
  _Tags:_ realtime
- **`POST` `/openai/v1/responses`** — Responses Api `responses_api_openai_v1_responses_post`  
  _Tags:_ responses
- **`POST` `/openai/v1/responses/compact`** — Compact Response `compact_response_openai_v1_responses_compact_post`  
  _Tags:_ responses
- **`GET` `/openai/v1/responses/{response_id}`** — Get Response `get_response_openai_v1_responses__response_id__get`  
  _Tags:_ responses
- **`DELETE` `/openai/v1/responses/{response_id}`** — Delete Response `delete_response_openai_v1_responses__response_id__delete`  
  _Tags:_ responses
- **`POST` `/openai/v1/responses/{response_id}/cancel`** — Cancel Response `cancel_response_openai_v1_responses__response_id__cancel_post`  
  _Tags:_ responses
- **`GET` `/openai/v1/responses/{response_id}/input_items`** — Get Response Input Items `get_response_input_items_openai_v1_responses__response_id__input_items_get`  
  _Tags:_ responses
- **`GET` `/openai/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`POST` `/openai/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`PUT` `/openai/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`DELETE` `/openai/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`PATCH` `/openai/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through

## `Provider Pass-through — openai_passthrough` — Provider Pass-through · OpenAI (alias)

- **`GET` `/openai_passthrough/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai_passthrough__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`POST` `/openai_passthrough/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai_passthrough__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`PUT` `/openai_passthrough/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai_passthrough__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`DELETE` `/openai_passthrough/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai_passthrough__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through
- **`PATCH` `/openai_passthrough/{endpoint}`** — Openai Proxy Route `openai_proxy_route_openai_passthrough__endpoint__get`  
  _Tags:_ OpenAI Pass-through, pass-through

## `Provider Pass-through — anthropic` — Provider Pass-through · Anthropic

- **`GET` `/anthropic/{endpoint}`** — Anthropic Proxy Route `anthropic_proxy_route_anthropic__endpoint__get`  
  _Tags:_ Anthropic Pass-through, pass-through
- **`POST` `/anthropic/{endpoint}`** — Anthropic Proxy Route `anthropic_proxy_route_anthropic__endpoint__get`  
  _Tags:_ Anthropic Pass-through, pass-through
- **`PUT` `/anthropic/{endpoint}`** — Anthropic Proxy Route `anthropic_proxy_route_anthropic__endpoint__get`  
  _Tags:_ Anthropic Pass-through, pass-through
- **`DELETE` `/anthropic/{endpoint}`** — Anthropic Proxy Route `anthropic_proxy_route_anthropic__endpoint__get`  
  _Tags:_ Anthropic Pass-through, pass-through
- **`PATCH` `/anthropic/{endpoint}`** — Anthropic Proxy Route `anthropic_proxy_route_anthropic__endpoint__get`  
  _Tags:_ Anthropic Pass-through, pass-through

## `Provider Pass-through — bedrock` — Provider Pass-through · Bedrock

- **`GET` `/bedrock/{endpoint}`** — Bedrock Proxy Route `bedrock_proxy_route_bedrock__endpoint__get`  
  _Tags:_ Bedrock Pass-through, pass-through
- **`POST` `/bedrock/{endpoint}`** — Bedrock Proxy Route `bedrock_proxy_route_bedrock__endpoint__get`  
  _Tags:_ Bedrock Pass-through, pass-through
- **`PUT` `/bedrock/{endpoint}`** — Bedrock Proxy Route `bedrock_proxy_route_bedrock__endpoint__get`  
  _Tags:_ Bedrock Pass-through, pass-through
- **`DELETE` `/bedrock/{endpoint}`** — Bedrock Proxy Route `bedrock_proxy_route_bedrock__endpoint__get`  
  _Tags:_ Bedrock Pass-through, pass-through
- **`PATCH` `/bedrock/{endpoint}`** — Bedrock Proxy Route `bedrock_proxy_route_bedrock__endpoint__get`  
  _Tags:_ Bedrock Pass-through, pass-through

## `Provider Pass-through — vertex_ai` — Provider Pass-through · Vertex AI

- **`GET` `/vertex_ai/discovery/{endpoint}`** — Vertex Discovery Proxy Route `vertex_discovery_proxy_route_vertex_ai_discovery__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`POST` `/vertex_ai/discovery/{endpoint}`** — Vertex Discovery Proxy Route `vertex_discovery_proxy_route_vertex_ai_discovery__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`PUT` `/vertex_ai/discovery/{endpoint}`** — Vertex Discovery Proxy Route `vertex_discovery_proxy_route_vertex_ai_discovery__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`DELETE` `/vertex_ai/discovery/{endpoint}`** — Vertex Discovery Proxy Route `vertex_discovery_proxy_route_vertex_ai_discovery__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`PATCH` `/vertex_ai/discovery/{endpoint}`** — Vertex Discovery Proxy Route `vertex_discovery_proxy_route_vertex_ai_discovery__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`GET` `/vertex_ai/live`** — WebSocket: vertex_ai_live_passthrough_endpoint `websocket_vertex_ai_live_passthrough_endpoint`  
  _Tags:_ WebSocket
- **`GET` `/vertex_ai/{endpoint}`** — Vertex Proxy Route `vertex_proxy_route_vertex_ai__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`POST` `/vertex_ai/{endpoint}`** — Vertex Proxy Route `vertex_proxy_route_vertex_ai__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`PUT` `/vertex_ai/{endpoint}`** — Vertex Proxy Route `vertex_proxy_route_vertex_ai__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`DELETE` `/vertex_ai/{endpoint}`** — Vertex Proxy Route `vertex_proxy_route_vertex_ai__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through
- **`PATCH` `/vertex_ai/{endpoint}`** — Vertex Proxy Route `vertex_proxy_route_vertex_ai__endpoint__get`  
  _Tags:_ Vertex AI Pass-through, pass-through

## `Provider Pass-through — gemini` — Provider Pass-through · Gemini

- **`GET` `/gemini/{endpoint}`** — Gemini Proxy Route `gemini_proxy_route_gemini__endpoint__get`  
  _Tags:_ Google AI Studio Pass-through, pass-through
- **`POST` `/gemini/{endpoint}`** — Gemini Proxy Route `gemini_proxy_route_gemini__endpoint__get`  
  _Tags:_ Google AI Studio Pass-through, pass-through
- **`PUT` `/gemini/{endpoint}`** — Gemini Proxy Route `gemini_proxy_route_gemini__endpoint__get`  
  _Tags:_ Google AI Studio Pass-through, pass-through
- **`DELETE` `/gemini/{endpoint}`** — Gemini Proxy Route `gemini_proxy_route_gemini__endpoint__get`  
  _Tags:_ Google AI Studio Pass-through, pass-through
- **`PATCH` `/gemini/{endpoint}`** — Gemini Proxy Route `gemini_proxy_route_gemini__endpoint__get`  
  _Tags:_ Google AI Studio Pass-through, pass-through

## `Provider Pass-through — mistral` — Provider Pass-through · Mistral

- **`GET` `/mistral/{endpoint}`** — Mistral Proxy Route `mistral_proxy_route_mistral__endpoint__get`  
  _Tags:_ Mistral Pass-through, pass-through
- **`POST` `/mistral/{endpoint}`** — Mistral Proxy Route `mistral_proxy_route_mistral__endpoint__get`  
  _Tags:_ Mistral Pass-through, pass-through
- **`PUT` `/mistral/{endpoint}`** — Mistral Proxy Route `mistral_proxy_route_mistral__endpoint__get`  
  _Tags:_ Mistral Pass-through, pass-through
- **`DELETE` `/mistral/{endpoint}`** — Mistral Proxy Route `mistral_proxy_route_mistral__endpoint__get`  
  _Tags:_ Mistral Pass-through, pass-through
- **`PATCH` `/mistral/{endpoint}`** — Mistral Proxy Route `mistral_proxy_route_mistral__endpoint__get`  
  _Tags:_ Mistral Pass-through, pass-through

## `Provider Pass-through — cohere` — Provider Pass-through · Cohere

- **`GET` `/cohere/{endpoint}`** — Cohere Proxy Route `cohere_proxy_route_cohere__endpoint__get`  
  _Tags:_ Cohere Pass-through, pass-through
- **`POST` `/cohere/{endpoint}`** — Cohere Proxy Route `cohere_proxy_route_cohere__endpoint__get`  
  _Tags:_ Cohere Pass-through, pass-through
- **`PUT` `/cohere/{endpoint}`** — Cohere Proxy Route `cohere_proxy_route_cohere__endpoint__get`  
  _Tags:_ Cohere Pass-through, pass-through
- **`DELETE` `/cohere/{endpoint}`** — Cohere Proxy Route `cohere_proxy_route_cohere__endpoint__get`  
  _Tags:_ Cohere Pass-through, pass-through
- **`PATCH` `/cohere/{endpoint}`** — Cohere Proxy Route `cohere_proxy_route_cohere__endpoint__get`  
  _Tags:_ Cohere Pass-through, pass-through

## `Provider Pass-through — assemblyai` — Provider Pass-through · AssemblyAI

- **`GET` `/assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI Pass-through, pass-through
- **`POST` `/assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI Pass-through, pass-through
- **`PUT` `/assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI Pass-through, pass-through
- **`DELETE` `/assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI Pass-through, pass-through
- **`PATCH` `/assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI Pass-through, pass-through

## `Provider Pass-through — eu.assemblyai` — Provider Pass-through · AssemblyAI (EU)

- **`GET` `/eu.assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_eu_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI EU Pass-through, pass-through
- **`POST` `/eu.assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_eu_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI EU Pass-through, pass-through
- **`PUT` `/eu.assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_eu_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI EU Pass-through, pass-through
- **`DELETE` `/eu.assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_eu_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI EU Pass-through, pass-through
- **`PATCH` `/eu.assemblyai/{endpoint}`** — Assemblyai Proxy Route `assemblyai_proxy_route_eu_assemblyai__endpoint__get`  
  _Tags:_ AssemblyAI EU Pass-through, pass-through

## `Provider Pass-through — azure` — Provider Pass-through · Azure

- **`GET` `/azure/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure__endpoint__get`  
  _Tags:_ Azure Pass-through, pass-through
- **`POST` `/azure/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure__endpoint__get`  
  _Tags:_ Azure Pass-through, pass-through
- **`PUT` `/azure/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure__endpoint__get`  
  _Tags:_ Azure Pass-through, pass-through
- **`DELETE` `/azure/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure__endpoint__get`  
  _Tags:_ Azure Pass-through, pass-through
- **`PATCH` `/azure/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure__endpoint__get`  
  _Tags:_ Azure Pass-through, pass-through

## `Provider Pass-through — azure_ai` — Provider Pass-through · Azure AI

- **`GET` `/azure_ai/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure_ai__endpoint__get`  
  _Tags:_ Azure AI Pass-through, pass-through
- **`POST` `/azure_ai/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure_ai__endpoint__get`  
  _Tags:_ Azure AI Pass-through, pass-through
- **`PUT` `/azure_ai/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure_ai__endpoint__get`  
  _Tags:_ Azure AI Pass-through, pass-through
- **`DELETE` `/azure_ai/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure_ai__endpoint__get`  
  _Tags:_ Azure AI Pass-through, pass-through
- **`PATCH` `/azure_ai/{endpoint}`** — Azure Proxy Route `azure_proxy_route_azure_ai__endpoint__get`  
  _Tags:_ Azure AI Pass-through, pass-through

## `Provider Pass-through — vllm` — Provider Pass-through · vLLM

- **`GET` `/vllm/{endpoint}`** — Vllm Proxy Route `vllm_proxy_route_vllm__endpoint__get`  
  _Tags:_ VLLM Pass-through, pass-through
- **`POST` `/vllm/{endpoint}`** — Vllm Proxy Route `vllm_proxy_route_vllm__endpoint__get`  
  _Tags:_ VLLM Pass-through, pass-through
- **`PUT` `/vllm/{endpoint}`** — Vllm Proxy Route `vllm_proxy_route_vllm__endpoint__get`  
  _Tags:_ VLLM Pass-through, pass-through
- **`DELETE` `/vllm/{endpoint}`** — Vllm Proxy Route `vllm_proxy_route_vllm__endpoint__get`  
  _Tags:_ VLLM Pass-through, pass-through
- **`PATCH` `/vllm/{endpoint}`** — Vllm Proxy Route `vllm_proxy_route_vllm__endpoint__get`  
  _Tags:_ VLLM Pass-through, pass-through

## `Provider Pass-through — cursor` — Provider Pass-through · Cursor

- **`POST` `/cursor/chat/completions`** — Cursor Chat Completions `cursor_chat_completions_cursor_chat_completions_post`  
  _Tags:_ responses
- **`GET` `/cursor/{endpoint}`** — Cursor Proxy Route `cursor_proxy_route_cursor__endpoint__get`  
  _Tags:_ Cursor Pass-through, pass-through
- **`POST` `/cursor/{endpoint}`** — Cursor Proxy Route `cursor_proxy_route_cursor__endpoint__get`  
  _Tags:_ Cursor Pass-through, pass-through
- **`PUT` `/cursor/{endpoint}`** — Cursor Proxy Route `cursor_proxy_route_cursor__endpoint__get`  
  _Tags:_ Cursor Pass-through, pass-through
- **`DELETE` `/cursor/{endpoint}`** — Cursor Proxy Route `cursor_proxy_route_cursor__endpoint__get`  
  _Tags:_ Cursor Pass-through, pass-through
- **`PATCH` `/cursor/{endpoint}`** — Cursor Proxy Route `cursor_proxy_route_cursor__endpoint__get`  
  _Tags:_ Cursor Pass-through, pass-through

## `Provider Pass-through — langfuse` — Provider Pass-through · Langfuse

- **`GET` `/langfuse/{endpoint}`** — Langfuse Proxy Route `langfuse_proxy_route_langfuse__endpoint__get`  
  _Tags:_ Langfuse Pass-through, pass-through
- **`POST` `/langfuse/{endpoint}`** — Langfuse Proxy Route `langfuse_proxy_route_langfuse__endpoint__get`  
  _Tags:_ Langfuse Pass-through, pass-through
- **`PUT` `/langfuse/{endpoint}`** — Langfuse Proxy Route `langfuse_proxy_route_langfuse__endpoint__get`  
  _Tags:_ Langfuse Pass-through, pass-through
- **`DELETE` `/langfuse/{endpoint}`** — Langfuse Proxy Route `langfuse_proxy_route_langfuse__endpoint__get`  
  _Tags:_ Langfuse Pass-through, pass-through
- **`PATCH` `/langfuse/{endpoint}`** — Langfuse Proxy Route `langfuse_proxy_route_langfuse__endpoint__get`  
  _Tags:_ Langfuse Pass-through, pass-through

## `MCP — dynamic routes` — MCP — dynamic per-server routes

- **`GET` `/{mcp_server_name}/authorize`** — Authorize `authorize__mcp_server_name__authorize_get`  
  _Tags:_ mcp
- **`GET` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`POST` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`PUT` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`DELETE` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`PATCH` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`HEAD` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`OPTIONS` `/{mcp_server_name}/mcp`** — Dynamic Mcp Route `dynamic_mcp_route__mcp_server_name__mcp_get`
- **`POST` `/{mcp_server_name}/register`** — Register Client `register_client__mcp_server_name__register_post`  
  _Tags:_ mcp
- **`POST` `/{mcp_server_name}/token`** — Token Endpoint `token_endpoint__mcp_server_name__token_post`  
  _Tags:_ mcp

## `test` — Test endpoints

- **`GET` `/test`** — Test Endpoint `test_endpoint_test_get`  
  _Tags:_ health

## `utils` — Utilities

- **`POST` `/utils/dotprompt_json_converter`** — Convert Prompt File To Json `convert_prompt_file_to_json_utils_dotprompt_json_converter_post`  
  _Tags:_ prompts, utils
- **`GET` `/utils/supported_openai_params`** — Supported Openai Params `supported_openai_params_utils_supported_openai_params_get`  
  _Tags:_ llm utils
- **`POST` `/utils/test_policies_and_guardrails`** — Test Policies And Guardrails `test_policies_and_guardrails_utils_test_policies_and_guardrails_post`  
  _Tags:_ utils
- **`POST` `/utils/token_counter`** — Token Counter `token_counter_utils_token_counter_post`  
  _Tags:_ llm utils
- **`POST` `/utils/transform_request`** — Transform Request `transform_request_utils_transform_request_post`  
  _Tags:_ llm utils

## `debug` — Debug

- **`GET` `/debug/asyncio-tasks`** — Get Active Tasks Stats `get_active_tasks_stats_debug_asyncio_tasks_get`

## `routes` — Routes introspection

- **`GET` `/routes`** — Get Routes `get_routes_routes_get`

## `compliance` — Compliance

- **`POST` `/compliance/eu-ai-act`** — Check Eu Ai Act Compliance `check_eu_ai_act_compliance_compliance_eu_ai_act_post`  
  _Tags:_ compliance
- **`POST` `/compliance/gdpr`** — Check Gdpr Compliance `check_gdpr_compliance_compliance_gdpr_post`  
  _Tags:_ compliance

## `register` — OAuth client registration

- **`POST` `/register`** — Register Client `register_client_register_post`  
  _Tags:_ mcp

## `token` — OAuth token

- **`POST` `/token`** — Token Endpoint `token_endpoint_token_post`  
  _Tags:_ mcp

## `authorize` — OAuth authorize

- **`GET` `/authorize`** — Authorize `authorize_authorize_get`  
  _Tags:_ mcp

## `OAuth / SCIM / OIDC` — OAuth / SCIM / OIDC

- **`GET` `/scim/v2`** — Get Scim Base `get_scim_base_scim_v2_get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/Groups`** — Get Groups `get_groups_scim_v2_Groups_get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`POST` `/scim/v2/Groups`** — Create Group `create_group_scim_v2_Groups_post`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/Groups/{group_id}`** — Get Group `get_group_scim_v2_Groups__group_id__get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`PUT` `/scim/v2/Groups/{group_id}`** — Update Group `update_group_scim_v2_Groups__group_id__put`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`DELETE` `/scim/v2/Groups/{group_id}`** — Delete Group `delete_group_scim_v2_Groups__group_id__delete`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`PATCH` `/scim/v2/Groups/{group_id}`** — Patch Group `patch_group_scim_v2_Groups__group_id__patch`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/ResourceTypes`** — Get Resource Types `get_resource_types_scim_v2_ResourceTypes_get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/ResourceTypes/{resource_type_id}`** — Get Resource Type `get_resource_type_scim_v2_ResourceTypes__resource_type_id__get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/Schemas`** — Get Schemas `get_schemas_scim_v2_Schemas_get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/Schemas/{schema_id}`** — Get Schema `get_schema_scim_v2_Schemas__schema_id__get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/ServiceProviderConfig`** — Get Service Provider Config `get_service_provider_config_scim_v2_ServiceProviderConfig_get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/Users`** — Get Users `get_users_scim_v2_Users_get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`POST` `/scim/v2/Users`** — Create User `create_user_scim_v2_Users_post`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`GET` `/scim/v2/Users/{user_id}`** — Get User `get_user_scim_v2_Users__user_id__get`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`PUT` `/scim/v2/Users/{user_id}`** — Update User `update_user_scim_v2_Users__user_id__put`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`DELETE` `/scim/v2/Users/{user_id}`** — Delete User `delete_user_scim_v2_Users__user_id__delete`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)
- **`PATCH` `/scim/v2/Users/{user_id}`** — Patch User `patch_user_scim_v2_Users__user_id__patch`  
  _Tags:_ ✨ SCIM v2 (Enterprise Only)

## `` — 

- **`GET` `/`** — Home `home__get`

## `Claude Code Plugins` — Claude Code Plugins

- **`GET` `/claude-code/marketplace.json`** — Get Marketplace `get_marketplace_claude_code_marketplace_json_get`  
  _Tags:_ Claude Code Marketplace
- **`GET` `/claude-code/plugins`** — List Plugins `list_plugins_claude_code_plugins_get`  
  _Tags:_ Claude Code Marketplace
- **`POST` `/claude-code/plugins`** — Register Plugin `register_plugin_claude_code_plugins_post`  
  _Tags:_ Claude Code Marketplace
- **`GET` `/claude-code/plugins/{plugin_name}`** — Get Plugin `get_plugin_claude_code_plugins__plugin_name__get`  
  _Tags:_ Claude Code Marketplace
- **`DELETE` `/claude-code/plugins/{plugin_name}`** — Delete Plugin `delete_plugin_claude_code_plugins__plugin_name__delete`  
  _Tags:_ Claude Code Marketplace
- **`POST` `/claude-code/plugins/{plugin_name}/disable`** — Disable Plugin `disable_plugin_claude_code_plugins__plugin_name__disable_post`  
  _Tags:_ Claude Code Marketplace
- **`POST` `/claude-code/plugins/{plugin_name}/enable`** — Enable Plugin `enable_plugin_claude_code_plugins__plugin_name__enable_post`  
  _Tags:_ Claude Code Marketplace

## `active` — active

- **`GET` `/active/callbacks`** — Active Callbacks `active_callbacks_active_callbacks_get`  
  _Tags:_ health

## `agent` — agent

- **`GET` `/agent/daily/activity`** — Get Agent Daily Activity `get_agent_daily_activity_agent_daily_activity_get`  
  _Tags:_ Agent Management

## `cloudzero` — cloudzero

- **`DELETE` `/cloudzero/delete`** — Delete Cloudzero Settings `delete_cloudzero_settings_cloudzero_delete_delete`  
  _Tags:_ CloudZero
- **`POST` `/cloudzero/dry-run`** — Cloudzero Dry Run Export `cloudzero_dry_run_export_cloudzero_dry_run_post`  
  _Tags:_ CloudZero
- **`POST` `/cloudzero/export`** — Cloudzero Export `cloudzero_export_cloudzero_export_post`  
  _Tags:_ CloudZero
- **`POST` `/cloudzero/init`** — Init Cloudzero Settings `init_cloudzero_settings_cloudzero_init_post`  
  _Tags:_ CloudZero
- **`GET` `/cloudzero/settings`** — Get Cloudzero Settings `get_cloudzero_settings_cloudzero_settings_get`  
  _Tags:_ CloudZero
- **`PUT` `/cloudzero/settings`** — Update Cloudzero Settings `update_cloudzero_settings_cloudzero_settings_put`  
  _Tags:_ CloudZero

## `email` — email

- **`GET` `/email/event_settings`** — Get Email Event Settings `get_email_event_settings_email_event_settings_get`  
  _Tags:_ email management
- **`PATCH` `/email/event_settings`** — Update Event Settings `update_event_settings_email_event_settings_patch`  
  _Tags:_ email management
- **`POST` `/email/event_settings/reset`** — Reset Event Settings `reset_event_settings_email_event_settings_reset_post`  
  _Tags:_ email management

## `engines` — engines

- **`POST` `/engines/{model}/chat/completions`** — Chat Completion `chat_completion_engines__model__chat_completions_post`  
  _Tags:_ chat/completions
- **`POST` `/engines/{model}/completions`** — Completion `completion_engines__model__completions_post`  
  _Tags:_ completions
- **`POST` `/engines/{model}/embeddings`** — Embeddings `embeddings_engines__model__embeddings_post`  
  _Tags:_ embeddings

## `in_product_nudges` — in_product_nudges

- **`GET` `/in_product_nudges`** — Get In Product Nudges `get_in_product_nudges_in_product_nudges_get`  
  _Tags:_ UI Settings

## `milvus` — milvus

- **`GET` `/milvus/{endpoint}`** — Milvus Proxy Route `milvus_proxy_route_milvus__endpoint__get`  
  _Tags:_ Milvus Pass-through, pass-through
- **`POST` `/milvus/{endpoint}`** — Milvus Proxy Route `milvus_proxy_route_milvus__endpoint__get`  
  _Tags:_ Milvus Pass-through, pass-through
- **`PUT` `/milvus/{endpoint}`** — Milvus Proxy Route `milvus_proxy_route_milvus__endpoint__get`  
  _Tags:_ Milvus Pass-through, pass-through
- **`DELETE` `/milvus/{endpoint}`** — Milvus Proxy Route `milvus_proxy_route_milvus__endpoint__get`  
  _Tags:_ Milvus Pass-through, pass-through
- **`PATCH` `/milvus/{endpoint}`** — Milvus Proxy Route `milvus_proxy_route_milvus__endpoint__get`  
  _Tags:_ Milvus Pass-through, pass-through

## `model` — model

- **`POST` `/model/delete`** — Delete Model `delete_model_model_delete_post`  
  _Tags:_ model management
- **`GET` `/model/info`** — Model Info V1 `model_info_v1_model_info_get`  
  _Tags:_ model management
- **`POST` `/model/new`** — Add New Model `add_new_model_model_new_post`  
  _Tags:_ model management
- **`POST` `/model/update`** — Update Model `update_model_model_update_post`  
  _Tags:_ model management
- **`PATCH` `/model/{model_id}/update`** — Patch Model `patch_model_model__model_id__update_patch`  
  _Tags:_ model management

## `model_group` — model_group

- **`GET` `/model_group/info`** — Model Group Info `model_group_info_model_group_info_get`  
  _Tags:_ model management
- **`POST` `/model_group/make_public`** — Update Public Model Groups `update_public_model_groups_model_group_make_public_post`  
  _Tags:_ model management

## `model_hub` — model_hub

- **`POST` `/model_hub/update_useful_links`** — Update Useful Links `update_useful_links_model_hub_update_useful_links_post`  
  _Tags:_ model management

## `moderations` — moderations

- **`POST` `/moderations`** — Moderations `moderations_moderations_post`  
  _Tags:_ moderations

## `robots.txt` — robots.txt

- **`GET` `/robots.txt`** — Get Robots `get_robots_robots_txt_get`

## `usage` — usage

- **`POST` `/usage/ai/chat`** — Usage Ai Chat `usage_ai_chat_usage_ai_chat_post`  
  _Tags:_ Budget & Spend Tracking

## `vantage` — vantage

- **`DELETE` `/vantage/delete`** — Delete Vantage Settings `delete_vantage_settings_vantage_delete_delete`  
  _Tags:_ Vantage
- **`POST` `/vantage/dry-run`** — Vantage Dry Run Export `vantage_dry_run_export_vantage_dry_run_post`  
  _Tags:_ Vantage
- **`POST` `/vantage/export`** — Vantage Export `vantage_export_vantage_export_post`  
  _Tags:_ Vantage
- **`POST` `/vantage/init`** — Init Vantage Settings `init_vantage_settings_vantage_init_post`  
  _Tags:_ Vantage
- **`GET` `/vantage/settings`** — Get Vantage Settings `get_vantage_settings_vantage_settings_get`  
  _Tags:_ Vantage
- **`PUT` `/vantage/settings`** — Update Vantage Settings `update_vantage_settings_vantage_settings_put`  
  _Tags:_ Vantage

## `{provider}` — {provider}

- **`GET` `/{provider}/v1/batches`** — List Batches `list_batches__provider__v1_batches_get`  
  _Tags:_ batch
- **`POST` `/{provider}/v1/batches`** — Create Batch `create_batch__provider__v1_batches_post`  
  _Tags:_ batch
- **`GET` `/{provider}/v1/batches/{batch_id}`** — Retrieve Batch `retrieve_batch__provider__v1_batches__batch_id__get`  
  _Tags:_ batch
- **`POST` `/{provider}/v1/batches/{batch_id}/cancel`** — Cancel Batch `cancel_batch__provider__v1_batches__batch_id__cancel_post`  
  _Tags:_ batch
- **`GET` `/{provider}/v1/files`** — List Files `list_files__provider__v1_files_get`  
  _Tags:_ files
- **`POST` `/{provider}/v1/files`** — Create File `create_file__provider__v1_files_post`  
  _Tags:_ files
- **`GET` `/{provider}/v1/files/{file_id}`** — Get File `get_file__provider__v1_files__file_id__get`  
  _Tags:_ files
- **`DELETE` `/{provider}/v1/files/{file_id}`** — Delete File `delete_file__provider__v1_files__file_id__delete`  
  _Tags:_ files
- **`GET` `/{provider}/v1/files/{file_id}/content`** — Get File Content `get_file_content__provider__v1_files__file_id__content_get`  
  _Tags:_ files
