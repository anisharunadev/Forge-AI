'use client';

import * as React from 'react';
import {
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Sparkles,
  Eraser,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToneBadge, decisionTone } from '../shared/severity-badge';
import { TEST_CASES, POLICIES, GUARDRAILS } from '@/lib/governance-v2';
import type { Decision } from '@/lib/governance-v2';
import { cn } from '@/lib/utils';

type TestResult = {
  decision: Decision;
  rulesFired: ReadonlyArray<{ id: string; name: string; at: string }>;
  redactedContent: string;
  suggestedRewrite?: string;
  logs: ReadonlyArray<{ timestamp: string; level: 'info' | 'warn' | 'block'; message: string }>;
};

const ICONS: Record<Decision, React.ComponentType<{ className?: string }>> = {
  allow: CheckCircle2,
  warn: AlertTriangle,
  block: XCircle,
  redact: Lock,
};

function redactPii(text: string): { redacted: string; matches: ReadonlyArray<{ pattern: string; original: string }> } {
  const matches: Array<{ pattern: string; original: string }> = [];
  let redacted = text;
  const patterns: ReadonlyArray<{ re: RegExp; name: string }> = [
    { re: /\b\d{3}-\d{2}-\d{4}\b/g, name: 'SSN' },
    { re: /\b[A-Z][a-z]+@[a-z]+\.[a-z]+\b/g, name: 'Email' },
    { re: /\b\d{16}\b/g, name: 'Credit Card' },
    { re: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub Token' },
    { re: /sk-[a-zA-Z0-9]{32,}/g, name: 'API Key' },
  ];
  for (const { re, name } of patterns) {
    redacted = redacted.replace(re, (m) => {
      matches.push({ pattern: name, original: m });
      return `[REDACTED:${name}]`;
    });
  }
  return { redacted, matches };
}

function runTest(prompt: string, category: string): TestResult {
  // Simulated evaluation against mocked policies
  const lower = prompt.toLowerCase();
  const logs: TestResult['logs'] = [];

  // Secret detection
  if (/ghp_|sk-|akia/i.test(prompt)) {
    return {
      decision: 'block',
      rulesFired: [
        { id: 'gr-secret-detect', name: 'Secret Detection', at: 'pre-tool' },
        { id: 'pol-secret-detect', name: 'Secret Detection', at: 'pre-tool' },
      ],
      redactedContent: prompt,
      suggestedRewrite: 'Use environment variables to inject secrets. Do not pass credentials in prompt text.',
      logs: [
        { timestamp: '14:23:18.001', level: 'info', message: 'Pre-tool evaluation started' },
        { timestamp: '14:23:18.012', level: 'block', message: 'gr-secret-detect MATCHED: GitHub Token detected in prompt' },
        { timestamp: '14:23:18.013', level: 'block', message: 'pol-secret-detect MATCHED: rule r2 (ghp_*) → BLOCK' },
        { timestamp: '14:23:18.014', level: 'block', message: 'Request blocked. 2 rules fired.' },
      ],
    };
  }

  // Jailbreak
  if (/ignore.*previous|you are now|developer mode|jailbroken/i.test(lower)) {
    return {
      decision: 'block',
      rulesFired: [
        { id: 'gr-jailbreak-detect', name: 'Jailbreak Detection', at: 'pre-tool' },
        { id: 'pol-jailbreak', name: 'Jailbreak Detection', at: 'pre-tool' },
      ],
      redactedContent: prompt,
      suggestedRewrite: 'Prompts that attempt to override system instructions are not permitted. Rephrase your request.',
      logs: [
        { timestamp: '14:23:18.001', level: 'info', message: 'Pre-tool evaluation started' },
        { timestamp: '14:23:18.008', level: 'warn', message: 'gr-jailbreak-detect: classifier confidence 0.94' },
        { timestamp: '14:23:18.009', level: 'block', message: 'pol-jailbreak MATCHED: rule r1 (ignore previous) → BLOCK' },
        { timestamp: '14:23:18.010', level: 'block', message: 'Request blocked. 2 rules fired.' },
      ],
    };
  }

  // Rate limit
  if (category === 'rate-limit') {
    return {
      decision: 'warn',
      rulesFired: [
        { id: 'gr-rate-limit', name: 'Rate Limit', at: 'pre-tool' },
        { id: 'pol-rate-limit-user', name: 'User Rate Limit', at: 'pre-tool' },
      ],
      redactedContent: prompt,
      logs: [
        { timestamp: '14:23:18.001', level: 'info', message: 'Pre-tool evaluation started' },
        { timestamp: '14:23:18.005', level: 'warn', message: 'gr-rate-limit: 101/100 requests this hour for user pm-marketing' },
        { timestamp: '14:23:18.006', level: 'warn', message: 'pol-rate-limit-user MATCHED: rule r1 (>100) → WARN' },
        { timestamp: '14:23:18.007', level: 'info', message: 'Request allowed with warning.' },
      ],
    };
  }

  // Topic
  if (category === 'topic' || /competitor/i.test(lower)) {
    return {
      decision: 'warn',
      rulesFired: [
        { id: 'gr-topic-block', name: 'Topic Restriction', at: 'content' },
        { id: 'pol-topic-block', name: 'Topic Blocker', at: 'content' },
      ],
      redactedContent: prompt,
      logs: [
        { timestamp: '14:23:18.001', level: 'info', message: 'Pre-tool evaluation started' },
        { timestamp: '14:23:18.009', level: 'warn', message: 'gr-topic-block: competitor name detected (soft mode)' },
        { timestamp: '14:23:18.010', level: 'warn', message: 'pol-topic-block MATCHED: rule r1 → WARN' },
        { timestamp: '14:23:18.011', level: 'info', message: 'Request allowed with warning.' },
      ],
    };
  }

  // PII redaction
  const { redacted, matches } = redactPii(prompt);
  if (matches.length > 0) {
    return {
      decision: 'redact',
      rulesFired: [
        { id: 'gr-pii-detect', name: 'PII Detection', at: 'pre-tool' },
        { id: 'pol-pii-redact', name: 'PII Redaction', at: 'pre-tool' },
      ],
      redactedContent: redacted,
      logs: [
        { timestamp: '14:23:18.001', level: 'info', message: 'Pre-tool evaluation started' },
        ...matches.map<{ timestamp: string; level: 'info' | 'warn' | 'block'; message: string }>((m, i) => ({
          timestamp: `14:23:18.00${i + 2}`,
          level: 'warn',
          message: `gr-pii-detect: matched ${m.pattern} at position ${prompt.indexOf(m.original)}`,
        })),
        { timestamp: '14:23:18.011', level: 'warn', message: 'pol-pii-redact MATCHED: 2 patterns → REDACT' },
        { timestamp: '14:23:18.012', level: 'info', message: `Request allowed, ${matches.length} PII items redacted.` },
      ],
    };
  }

  // Default allow
  return {
    decision: 'allow',
    rulesFired: [],
    redactedContent: prompt,
    logs: [
      { timestamp: '14:23:18.001', level: 'info', message: 'Pre-tool evaluation started' },
      { timestamp: '14:23:18.005', level: 'info', message: 'No policies matched' },
      { timestamp: '14:23:18.006', level: 'info', message: 'Request allowed.' },
    ],
  };
}

export function TestTab() {
  const [selectedCaseId, setSelectedCaseId] = React.useState(TEST_CASES[0]?.id ?? '');
  const [prompt, setPrompt] = React.useState(TEST_CASES[0]?.prompt ?? '');
  const [userContext, setUserContext] = React.useState(TEST_CASES[0]?.userContext ?? { user: '', tenant: '', role: '' });
  const [result, setResult] = React.useState<TestResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const handleSelectCase = (id: string) => {
    setSelectedCaseId(id);
    const tc = TEST_CASES.find((t) => t.id === id);
    if (tc) {
      setPrompt(tc.prompt);
      setUserContext(tc.userContext);
      setResult(null);
    }
  };

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    await new Promise((r) => setTimeout(r, 600));
    const tc = TEST_CASES.find((t) => t.id === selectedCaseId);
    setResult(runTest(prompt, tc?.category ?? 'pii'));
    setRunning(false);
  };

  const DecisionIcon = result ? ICONS[result.decision] : null;

  return (
    <div className="space-y-4" data-testid="test-tab">
      {/* Pre-loaded test cases */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3" data-testid="test-cases">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Pre-loaded test cases:</span>
        {TEST_CASES.map((tc) => (
          <button
            key={tc.id}
            type="button"
            onClick={() => handleSelectCase(tc.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] transition-colors',
              selectedCaseId === tc.id
                ? 'border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                : 'border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]',
            )}
            data-testid={`test-case-${tc.id}`}
          >
            {tc.name}
          </button>
        ))}
      </div>

      {/* Split view */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* LEFT — Input */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-testid="test-input">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">Test input</h3>
            <Button size="sm" onClick={handleRun} disabled={running} data-testid="test-run">
              {running ? <Sparkles className="h-3.5 w-3.5 animate-pulse" /> : <Play className="h-3.5 w-3.5" />}
              {running ? 'Running…' : 'Run test'}
            </Button>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Sample prompt</label>
            <Textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="font-mono text-[12px]"
              data-testid="test-prompt"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">User</label>
              <input
                value={userContext.user}
                onChange={(e) => setUserContext({ ...userContext, user: e.target.value })}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--fg-primary)]"
                data-testid="test-user"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Tenant</label>
              <input
                value={userContext.tenant}
                onChange={(e) => setUserContext({ ...userContext, tenant: e.target.value })}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--fg-primary)]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Role</label>
              <input
                value={userContext.role}
                onChange={(e) => setUserContext({ ...userContext, role: e.target.value })}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--fg-primary)]"
              />
            </div>
          </div>
        </div>

        {/* RIGHT — Output */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-testid="test-output">
          <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">Test output</h3>
          {result ? (
            <>
              <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3" data-testid="test-decision">
                {DecisionIcon ? (
                  <DecisionIcon
                    className={cn(
                      'h-5 w-5',
                      result.decision === 'allow' ? 'text-[var(--accent-emerald)]'
                      : result.decision === 'warn' ? 'text-[var(--accent-amber)]'
                      : result.decision === 'block' ? 'text-[var(--accent-rose)]'
                      : 'text-[var(--accent-cyan)]',
                    )}
                    aria-hidden
                  />
                ) : null}
                <div className="flex-1">
                  <p className="text-[12px] font-medium text-[var(--fg-primary)]">
                    Decision: <ToneBadge tone={decisionTone(result.decision)}>{result.decision.toUpperCase()}</ToneBadge>
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                    {result.rulesFired.length} rule{result.rulesFired.length !== 1 ? 's' : ''} fired
                  </p>
                </div>
              </div>

              {result.rulesFired.length > 0 ? (
                <div className="space-y-1">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Rules fired</h4>
                  {result.rulesFired.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded bg-[var(--bg-inset)] px-2 py-1.5">
                      <span className="text-[11px] font-medium text-[var(--fg-primary)]">{r.name}</span>
                      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{r.id} · {r.at}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {result.decision === 'redact' && result.redactedContent !== prompt ? (
                <div className="space-y-1">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Redacted content</h4>
                  <div className="rounded border border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/5 p-2 font-mono text-[11px] leading-relaxed">
                    {result.redactedContent.split(/(\[REDACTED:[^\]]+\])/).map((part, i) =>
                      part.startsWith('[REDACTED:') ? (
                        <span key={i} className="rounded bg-[var(--accent-rose)]/20 px-1 text-[var(--accent-rose)]">{part}</span>
                      ) : (
                        <span key={i}>{part}</span>
                      ),
                    )}
                  </div>
                </div>
              ) : null}

              {result.suggestedRewrite ? (
                <div className="rounded border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-amber)]">Suggested rewrite</p>
                  <p className="mt-1 text-[11px] text-[var(--fg-secondary)]">{result.suggestedRewrite}</p>
                </div>
              ) : null}

              <div className="space-y-1">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Logs</h4>
                <div className="scrollbar-thin max-h-32 overflow-y-auto rounded bg-[var(--bg-base)] p-2 font-mono text-[10px]">
                  {result.logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-[var(--fg-muted)]">{log.timestamp}</span>
                      <span className={cn(
                        'uppercase',
                        log.level === 'info' ? 'text-[var(--accent-cyan)]' : log.level === 'warn' ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-rose)]',
                      )}>[{log.level}]</span>
                      <span className="text-[var(--fg-secondary)]">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-[var(--border-subtle)] p-6 text-center">
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-[var(--fg-tertiary)]">Run a test to see results</p>
                <p className="text-[11px] text-[var(--fg-tertiary)]">Select a pre-loaded case or enter custom input</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}