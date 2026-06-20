# Forge AI-392.4 — Tool-Call & Structured-Output Contract

**Sub-plan:** 4 of 5
**Issue:** [Forge AI-392](/Forge AI/issues/Forge AI-392)
**Owner:** Senior Engineer
**Rev:** v0.1 — 2026-06-20 (draft, awaiting Board approval)
**Companion:** [`LITELLM_ABSTRACTION.md`](./LITELLM_ABSTRACTION.md) · [`OPENAI_COMPAT_ADAPTER.md`](./OPENAI_COMPAT_ADAPTER.md)

---

## 0. Scope

This artefact specifies the **canonical tool-call and structured-output schema** every provider must support, so the rest of Forge AI — and especially the typed-artifact generator ([Forge AI-389](/Forge AI/issues/Forge AI-389)) — is provider-agnostic.

**In scope:** canonical `ToolSpec`, canonical structured-output `JSONSchema`, the per-provider adapter transformation rules, the validation strategy, the prompt-injection boundary between tool outputs and instructions.
**Out of scope:** provider-specific SDKs (sub-plan 2), routing rules (sub-plan 3), the OpenAI-compat shim (sub-plan 5).

---

## 1. The promise

> Every provider in Forge AI's PAL must support the same canonical `ToolSpec` and the same canonical `JSONSchema` for structured output. The rest of the platform never sees provider-specific tool-call shapes.

The promise is enforced by:

1. **A conformance test suite** that runs against every provider adapter in CI (matrix: OpenAI, Anthropic, Gemini, OpenRouter, Bedrock, Azure OpenAI, Vertex AI). The suite is the contract; adapters that fail are blocked from merge.
2. **An adapter-transformation layer** that maps the canonical shape onto each provider's wire shape. The adapter is the only place that knows about provider-specific wrapping.
3. **A schema-validator** that runs on every model output when `responseSchema` is provided. Validation failures retry once with a corrective system message (sub-plan 2 §3) and otherwise fail loud.

---

## 2. Canonical `ToolSpec`

```ts
// packages/pal/src/tool-spec.ts — the only shape the rest of Forge AI sees

export interface ToolSpec {
  /** Stable, kebab-case identifier. Unique per tool. */
  readonly name: string;
  /** One-line description, used in the system prompt and the provider's tool registry. */
  readonly description: string;
  /** JSON-Schema (Draft 2020-12) for the tool's input. */
  readonly inputSchema: JSONSchema;
  /** JSON-Schema for the tool's output. The PAL validates tool outputs against this. */
  readonly outputSchema: JSONSchema;
  /** Tool-class metadata for the agent loop. */
  readonly category: "read" | "write" | "compute" | "external";
  /** Whether the tool requires human-in-the-loop approval before invocation. */
  readonly requiresApproval: boolean;
  /** Optional scoped-credential tag. The broker hands out the right key. */
  readonly credentialTag?: string;
}
```

**Naming:** `name` is kebab-case, stable across versions. Renaming a tool is a breaking change to the typed-artifact contract (Forge AI-389); it requires a major version bump.

**Schema:** JSON-Schema Draft 2020-12. The PAL canonicalises every provider's variant before sending.

---

## 3. Canonical structured-output `JSONSchema`

```ts
export interface JSONSchema {
  /** Draft version, always "2020-12" in the canonical form. */
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly properties?: Readonly<Record<string, JSONSchema>>;
  readonly required?: ReadonlyArray<string>;
  readonly items?: JSONSchema;
  readonly enum?: ReadonlyArray<string | number>;
  readonly description?: string;
  readonly additionalProperties?: boolean | JSONSchema;
}
```

The PAL supports the subset of JSON-Schema 2020-12 that all seven providers support. Specifically:

- ✅ `type`, `properties`, `required`, `items`, `enum`, `description`
- ✅ `$ref` (resolved at adapter time)
- ✅ `oneOf`, `anyOf`, `allOf` (resolved with `discriminator`)
- ⚠ `format` — only `date-time`, `email`, `uri` are universally honoured; other formats are advisory
- ❌ `$dynamicRef` — not supported; canonicalised away before send

If a caller needs an unsupported feature, the PAL raises a `SchemaNotSupported` error at call time, not at provider time. The error is an audit event.

---

## 4. Per-provider transformation

Each adapter maps the canonical shape to its provider's wire shape:

### 4.1 OpenAI

```jsonc
// Canonical ToolSpec → OpenAI tool shape
{
  "type": "function",
  "function": {
    "name": "<ToolSpec.name>",
    "description": "<ToolSpec.description>",
    "parameters": <ToolSpec.inputSchema>,          // JSON-Schema
    "strict": true                                // OpenAI structured-outputs mode
  }
}
```

Structured output:

```jsonc
// OpenAI response_format with json_schema enforcement
{
  "type": "json_schema",
  "json_schema": {
    "name": "<schemaName>",
    "schema": <JSONSchema>,
    "strict": true
  }
}
```

### 4.2 Anthropic

```jsonc
// Canonical ToolSpec → Anthropic tool shape
{
  "name": "<ToolSpec.name>",
  "description": "<ToolSpec.description>",
  "input_schema": <ToolSpec.inputSchema>          // JSON-Schema
}
```

Structured output: Anthropic has no native `response_format`. We use **tool-use to a `final_answer` tool** with `input_schema` = the desired JSON-Schema. The PAL treats the tool's invocation as the structured output. This is the documented and reliable pattern.

### 4.3 Gemini

```jsonc
// Canonical ToolSpec → Gemini functionDeclaration
{
  "name": "<ToolSpec.name>",
  "description": "<ToolSpec.description>",
  "parameters": <ToolSpec.inputSchema>            // OpenAPI 3.0 subset of JSON-Schema
}
```

Structured output: `responseSchema` (a subset of JSON-Schema; Gemini enforces it). The PAL pre-validates the schema against Gemini's accepted subset; unsupported keywords raise `SchemaNotSupported`.

### 4.4 OpenRouter

OpenAI-compatible. Same transformation as §4.1. Note: model behaviour depends on the underlying model; the PAL surfaces a `provider_warning` audit event when a model declines to honour `strict: true`.

### 4.5 Bedrock

Per-model surface. The PAL routes to Bedrock's `InvokeModel` API. For Anthropic-on-Bedrock, the transformation matches §4.2; for Mistral / Llama / Cohere on Bedrock, the adapter maintains a per-model mapping table.

Structured output: model-dependent. Where the underlying model supports structured output, the PAL uses it; otherwise it falls back to tool-use-as-structured-output (§4.2 pattern).

### 4.6 Azure OpenAI

OpenAI-compatible. Same transformation as §4.1, plus Azure-specific deployment-name handling.

### 4.7 Vertex AI

Gemini-compatible. Same transformation as §4.3, plus GCP project / region wiring through the Forge AI-126 broker.

---

## 5. Tool-call loop semantics

```ts
// packages/pal/src/run-with-tools.ts — conceptual

export async function runWithTools(req: RunWithToolsRequest): Promise<ProviderCallResponse<unknown>> {
  let transcript = initialMessages(req);
  for (let step = 0; step < (req.maxSteps ?? 10); step += 1) {
    const turn = await pal.complete({
      ...req,
      tools: req.tools,
      responseSchema: undefined,                   // tool-use, not structured-out
      user: transcript,
    });
    transcript = appendAssistantTurn(transcript, turn);

    if (turn.value.kind === "final_answer") {
      return turn;                                  // structured output returned
    }
    if (turn.value.kind === "tool_use") {
      const tool = resolveTool(turn.value.name, req.tools);
      if (tool.requiresApproval && !req.approved?.includes(turn.value.id)) {
        return await pal.haltForApproval(req, turn);  // halt-and-ask per Forge AI-5 §5.2
      }
      const toolOutput = await invokeTool(tool, turn.value.input);   // isolated process
      transcript = appendToolResult(transcript, turn.value.id, toolOutput);
      continue;
    }
    throw new Error(`unexpected turn kind: ${turn.value.kind}`);
  }
  throw new Error("max steps exceeded");
}
```

Key rules:

- **`requiresApproval` tools halt the run.** A `write` or `external` tool that the tenant has flagged as approval-required is surfaced to the orchestrator, which surfaces it to a human. The PAL never auto-approves.
- **Tool invocation is in an isolated process.** The tool runs in a separate process with its own scope; failures are contained.
- **Tool output is data, not instruction.** Tool output is wrapped in `<untrusted source="tool" id="...">...</untrusted>` markers when fed back to the model on the next turn.

---

## 6. Structured-output validation

When `responseSchema` is set:

1. The model emits text.
2. The PAL parses the text as JSON.
3. The PAL validates against `responseSchema` (JSON-Schema 2020-12).
4. On validation failure, the PAL retries **once** with a corrective system message ("The previous response did not validate against the schema. Specifically: <error>. Emit valid JSON.").
5. On second failure, the PAL raises `SchemaValidationError` and emits an `llm.schema.invalid` audit event.

The validation uses the same JSON-Schema library the rest of Forge AI uses (per `workspace/memory/coding.md` §2 — TypeScript-first). The conformance suite (sub-plan 4 §1) is the safety net; in production, schema drift between model and validator is rare.

---

## 7. Prompt-injection boundary (Forge AI-5 §5.2)

The contract enforces three rules that cross-cut sub-plan 2 §7:

1. **Tool output is wrapped in untrusted-boundary markers** when fed back to the model. The PAL does this in `runWithTools`.
2. **Tool outputs may not contain tool-call instructions.** A tool that returns content shaped like a tool call (`{"name": "...", "input": {...}}`) is rejected before being passed to the model. The PAL parses tool output defensively.
3. **The model may not pass quoted user content as a tool-call argument unless the tool's `inputSchema` explicitly types it.** This is enforced by JSON-Schema validation on the model's tool-call arguments.

These three rules are the boundary between "data the model sees" and "instructions the model acts on." The Security stage reviews the conformance suite (§1) for boundary violations.

---

## 8. Reconciliation with Forge AI-389 (typed-artifact generation)

The typed-artifact generator is a PAL consumer. It produces structured artefacts (ADR drafts, ERDs, API specs, sequence diagrams) that must validate against the canonical `JSONSchema`. The PAL's contract guarantees:

- The same schema definition works on any provider.
- Validation failures are surfaced to the generator with enough context to retry or escalate.
- Cost is captured per artefact, not per call, via the audit events the PAL emits.

The conformance suite (§1) includes a Forge AI-389 fixture: a representative typed-artifact generation request that must validate identically across all seven providers.

---

## 9. Acceptance criteria

- [x] Canonical `ToolSpec` shape specified.
- [x] Canonical `JSONSchema` shape specified (Draft 2020-12).
- [x] Per-provider transformation rules documented for all seven providers.
- [x] Tool-call loop semantics specified, including `requiresApproval` halt-and-ask.
- [x] Structured-output validation strategy specified (parse → validate → retry once → fail).
- [x] Prompt-injection boundary rules documented.
- [x] Forge AI-389 reconciliation explicit.
- [ ] Board approval via `request_confirmation` on Forge AI-392.

---

## 10. Open questions for the Board

1. **JSON-Schema subset.** Confirm we ship the conservative subset (§3) and raise `SchemaNotSupported` for the rest, rather than attempting full Draft 2020-12 across all providers.
2. **Anthropic structured-output pattern.** Confirm the `final_answer` tool pattern is the right V1 choice (vs. JSON-mode + extraction).
3. **`requiresApproval` default.** Confirm "write" + "external" tools default to `requiresApproval: true`, and "read" + "compute" default to `false`.
4. **Conformance suite ownership.** Confirm the QA stage owns the conformance suite (per Forge AI-19 QA playbook); the PAL team owns the adapter implementations.
5. **Gemini schema subset drift.** Confirm the PAL refuses Gemini calls with unsupported schema features rather than silently degrading to JSON-mode-with-extraction.