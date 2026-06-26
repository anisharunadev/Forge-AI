/**
 * Governance Center v2 — Type definitions for the enterprise AI control plane.
 *
 * Covers: policies, guardrails (pre-tool / post-tool / content), compliance
 * standards (ISO 27000, SOC2, GDPR, etc.), LiteLLM control, audit log.
 *
 * All data is mocked locally; the page renders fully without backend calls.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type PolicyStatus = 'strict' | 'advisory' | 'off';
export type PolicyScope = 'org' | 'project' | 'resource';
export type PolicyType = 'content' | 'tool' | 'data' | 'custom';
export type Decision = 'allow' | 'warn' | 'block' | 'redact';
export type GuardrailStage = 'pre-tool' | 'post-tool' | 'content';
export type StandardStatus = 'compliant' | 'partial' | 'non-compliant' | 'not-applicable';
export type EvidenceType = 'audit-log' | 'policy' | 'run' | 'config' | 'document';

// ─── Policies ────────────────────────────────────────────────────────────────

export interface PolicyRule {
  readonly id: string;
  readonly field: string;
  readonly operator: 'contains' | 'equals' | 'matches' | 'in' | 'gt' | 'lt';
  readonly value: string;
}

export interface PolicyDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: PolicyStatus;
  readonly scope: PolicyScope;
  readonly type: PolicyType;
  readonly rules: ReadonlyArray<PolicyRule>;
  readonly action: Decision;
  readonly severity: Severity;
  readonly appliesTo: {
    readonly workflows: 'all' | ReadonlyArray<string>;
    readonly agents: 'all' | ReadonlyArray<string>;
    readonly commands: 'all' | ReadonlyArray<string>;
  };
  readonly exceptions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly condition: string;
    readonly expiresAt?: string;
  }>;
  readonly naturalLanguage: string;
  readonly violations: number;
  readonly lastModified: string;
  readonly modifiedBy: string;
  readonly createdAt: string;
}

// ─── Guardrails ──────────────────────────────────────────────────────────────

export interface GuardrailConfig {
  readonly id: string;
  readonly stage: GuardrailStage;
  readonly name: string;
  readonly description: string;
  readonly icon: string; // lucide icon name
  readonly color: 'rose' | 'amber' | 'cyan' | 'emerald' | 'violet' | 'indigo';
  readonly enabled: boolean;
  readonly priority: number;
  readonly settings: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly type: 'text' | 'number' | 'select' | 'toggle' | 'list';
    readonly value: string | number | boolean | ReadonlyArray<string>;
    readonly options?: ReadonlyArray<string>;
  }>;
  readonly stats: {
    readonly firedToday: number;
    readonly blockedToday: number;
    readonly redactedToday: number;
    readonly trendDelta: number;
  };
}

// ─── Standards ───────────────────────────────────────────────────────────────

export interface StandardControl {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly requirement: string;
  readonly status: StandardStatus;
  readonly evidence: ReadonlyArray<string>; // evidence IDs
  readonly notes?: string;
}

export interface StandardEvidence {
  readonly id: string;
  readonly timestamp: string;
  readonly source: 'audit-log' | 'policy-enforcement' | 'run-history' | 'config-snapshot';
  readonly description: string;
  readonly downloadUrl?: string;
  readonly controlId: string;
}

export interface StandardException {
  readonly id: string;
  readonly controlId: string;
  readonly justification: string;
  readonly approver: string;
  readonly approvedAt: string;
  readonly expiresAt?: string;
}

export interface ComplianceStandard {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly icon: string;
  readonly color: string;
  readonly scope: 'org' | 'industry' | 'region';
  readonly controls: ReadonlyArray<StandardControl>;
  readonly evidence: ReadonlyArray<StandardEvidence>;
  readonly exceptions: ReadonlyArray<StandardException>;
  readonly loaded: boolean;
  readonly overallScore: number;
  readonly lastAssessed: string;
}

// ─── LLM Control (LiteLLM) ──────────────────────────────────────────────────

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly type: 'openai' | 'anthropic' | 'google' | 'aws-bedrock' | 'azure' | 'custom';
  readonly color: 'cyan' | 'emerald' | 'indigo' | 'amber' | 'rose' | 'violet';
  readonly apiKeyMasked: string;
  readonly lastTest: string;
  readonly requestCount: number;
  readonly spend: number;
  readonly errorRate: number;
  readonly enabled: boolean;
  readonly endpoint?: string;
}

export interface LlmModel {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly contextWindow: number;
  readonly inputCost: number; // per 1M tokens
  readonly outputCost: number;
  readonly enabled: boolean;
  readonly requestCount: number;
  readonly errorRate: number;
  readonly avgLatency: number;
}

export interface RateLimit {
  readonly id: string;
  readonly scope: 'user' | 'tenant' | 'team' | 'workflow' | 'agent';
  readonly target: string;
  readonly requestsPerMinute: number;
  readonly requestsPerDay: number;
  readonly tokensPerDay: number;
  readonly spendPerDay: number;
  readonly currentUsage: number; // 0-1 ratio
}

export interface SpendCap {
  readonly id: string;
  readonly scope: 'tenant' | 'team' | 'user';
  readonly target: string;
  readonly period: 'daily' | 'monthly' | 'yearly';
  readonly cap: number;
  readonly current: number;
  readonly alertThreshold: number; // 0-1
  readonly hardStop: boolean;
}

export interface RoutingRule {
  readonly id: string;
  readonly name: string;
  readonly condition: string;
  readonly model: string;
  readonly fallback?: string;
  readonly strategy: 'default' | 'cost-optimized' | 'latency-optimized' | 'fallback' | 'load-balance';
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: { readonly name: string; readonly id: string; readonly role: string };
  readonly action: 'prompt-sent' | 'tool-called' | 'response-received' | 'policy-evaluated';
  readonly policyId?: string;
  readonly guardrailId?: string;
  readonly decision: Decision;
  readonly severity: Severity;
  readonly reason: string;
  readonly affectedEntity: string;
  readonly tenantId: string;
  readonly projectId: string;
}

// ─── Live Activity ──────────────────────────────────────────────────────────

export interface LiveActivityEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly rule: string;
  readonly actor: string;
  readonly decision: Decision;
  readonly affectedRequest: string;
  readonly guardrailId?: string;
}

// ─── Test Cases (Playground) ───────────────────────────────────────────────

export interface PolicyTestCase {
  readonly id: string;
  readonly name: string;
  readonly category: 'pii' | 'secret' | 'jailbreak' | 'rate-limit' | 'topic';
  readonly prompt: string;
  readonly toolCall?: {
    readonly tool: string;
    readonly parameters: Record<string, string>;
  };
  readonly userContext: {
    readonly user: string;
    readonly tenant: string;
    readonly role: string;
  };
  readonly expectedDecision: Decision;
  readonly description: string;
}

// ─── KPI Summary (Overview) ─────────────────────────────────────────────────

export interface GovernanceKpis {
  readonly activePolicies: { readonly total: number; readonly strict: number; readonly advisory: number };
  readonly standards: { readonly met: number; readonly total: number; readonly percent: number };
  readonly guardrailsFiring: { readonly count24h: number; readonly delta: number };
  readonly llmSpend: { readonly today: number; readonly cap: number; readonly delta: number };
  readonly violations: { readonly unresolved: number; readonly critical: number; readonly high: number; readonly medium: number };
  readonly policyCoverage: { readonly workflows: { readonly covered: number; readonly total: number }; readonly agents: { readonly covered: number; readonly total: number }; readonly commands: { readonly covered: number; readonly total: number } };
  readonly complianceByStandard: ReadonlyArray<{ readonly id: string; readonly name: string; readonly score: number }>;
  readonly llmUsageByModel: ReadonlyArray<{ readonly model: string; readonly spend: number; readonly requests: number; readonly color: string }>;
  readonly topViolations: ReadonlyArray<{ readonly policyId: string; readonly policyName: string; readonly count: number; readonly trend: 'up' | 'down' | 'flat' }>;
  readonly recentChanges: ReadonlyArray<{
    readonly id: string;
    readonly timestamp: string;
    readonly type: 'created' | 'updated' | 'deleted' | 'enforced';
    readonly subject: string;
    readonly actor: string;
  }>;
  readonly guardrailStatus: 'all-active' | 'warning' | 'critical';
  readonly guardrailStatusCount: number;
  readonly totalComplianceScore: number;
}