# Forge Agent Composition (Phase 2)

> Spec: `docs/goals/step-76.md` §"Composition: agent = skill + tools + guardrails + policies + chat"

## Agent config

```yaml
AgentConfig {
  skill_ids:        [Skill A, Skill B]
  tool_policy:      { allowed_tools, denied_tools, requires_approval }
  guardrail_refs:   [G1, G2]                # direct refs (deprecated path)
  policy_refs:      [P1, P2]                # primary path
  mcp_servers:      [M1, M2]
  model:            openai/gpt-4o
  chat_config:      { temperature, max_tokens, ... }
}
```

## Request-time pipeline

```
1. resolvePolicies(agent, context)         → effective policies
2. resolveGuardrails(policies)              → ordered guardrail list
3. loadSkills(skill_ids)                    → skill bodies
4. discoverTools(mcp_servers + tool_policy) → tool palette (OpenAI format)
5. transformRequest(skills, request)        → merged request
6. applyGuardrails('pre_call_input')        → sanitized input
7. applyGuardrails('pre_call_llm')          → classified input
8. chatCompletion(merged_request)           → model output
9. applyGuardrails('post_call_output')      → sanitized output
10. on tool_call:
     a. requires_approval? → pause stream + UI prompt
     b. auth expired?      → MCPAuthExpired → reauth flow
     c. dispatch to MCP    → /v1/mcp/call
     d. append {role:tool, tool_call_id, content}
     e. goto 8 (until finish_reason ∈ {stop, length} or max_iter)
11. applyGuardrails('during_call') per chunk (streaming)
12. recordSpend + audit (forge.tools.invoked, forge.guardrails.applied, ...)
```

## Composition rules

- Multiple policies compose per F7: priority > scope > recency > deny-over-allow.
- Multiple skills concatenate prompts in order; tool conflicts resolved later-wins.
- Tool policy is the union of per-policy `allowed_tools` / `denied_tools`; the chat loop checks both before each dispatch.
- Guardrails are evaluated pre-call (block/mask) and post-call (block/mask); during_call per chunk.

## Errors raised

- `GuardrailViolation` (422) — pre/post-call block.
- `MCPAuthExpired` (401), `MCPToolTimeout` (504), `ToolApprovalRequired` (409).
- `PolicyResolutionError` (422) — invalid resolve context.
- `SkillRenderError` (422) — broken Jinja at save time.