'use client';

import * as React from 'react';
import { Play, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { evaluateLogic, sampleInputFor } from '@/lib/org-knowledge/evaluate';
import {
  POLICY_EFFECT_LABEL,
  type Policy,
  type PolicyEffect,
} from '@/lib/org-knowledge/data';

const EFFECTS: ReadonlyArray<PolicyEffect> = ['allow', 'deny', 'require-approval', 'notify'];

export interface PolicyEditorProps {
  policy: Policy | null;
  onSave?: (next: Policy) => void;
}

export function PolicyEditor({ policy, onSave }: PolicyEditorProps) {
  const [draft, setDraft] = React.useState<Policy | null>(policy);
  const [logicText, setLogicText] = React.useState('');
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    matched: boolean;
    effect: PolicyEffect;
  } | null>(null);
  const [sampleJson, setSampleJson] = React.useState('');

  React.useEffect(() => {
    setDraft(policy);
    setLogicText(policy ? JSON.stringify(policy.logic, null, 2) : '');
    setResult(null);
    setParseError(null);
    setSampleJson('');
  }, [policy]);

  if (!draft) {
    return (
      <div
        className="card flex h-64 items-center justify-center text-sm text-forge-300"
        data-testid="policy-editor-empty"
      >
        Select a policy to edit.
      </div>
    );
  }

  const handleRunEval = () => {
    try {
      const parsed = JSON.parse(logicText) as Record<string, unknown>;
      setParseError(null);
      const sample = sampleInputFor(draft.scope, sampleJson);
      const matched = evaluateLogic(parsed, sample);
      setResult({ matched, effect: matched ? draft.effect : 'allow' });
    } catch (err) {
      setParseError((err as Error).message);
      setResult(null);
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(logicText) as Record<string, unknown>;
      onSave?.({ ...draft, logic: parsed });
      setParseError(null);
    } catch (err) {
      setParseError((err as Error).message);
    }
  };

  return (
    <article
      className="card space-y-4"
      data-testid="policy-editor"
      data-policy-id={draft.id}
    >
      <header className="space-y-1">
        <h3 className="text-lg font-semibold text-forge-50">{draft.title}</h3>
        <p className="text-[10px] text-forge-300">
          owner {draft.owner} · updated {draft.updatedAt}
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="policy-title">Title</Label>
          <Input
            id="policy-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="policy-effect">Effect</Label>
          <Select
            value={draft.effect}
            onValueChange={(v) => setDraft({ ...draft, effect: v as PolicyEffect })}
          >
            <SelectTrigger id="policy-effect">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFECTS.map((e) => (
                <SelectItem key={e} value={e}>
                  {POLICY_EFFECT_LABEL[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 md:col-span-2">
          <Label htmlFor="policy-scope">Scope (human-readable)</Label>
          <Input
            id="policy-scope"
            value={draft.scope}
            onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="policy-logic">JSONLogic</Label>
        <textarea
          id="policy-logic"
          value={logicText}
          onChange={(e) => setLogicText(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="policy-logic"
        />
        {parseError ? (
          <p
            className="text-[10px] text-rose-300"
            data-testid="policy-parse-error"
          >
            parse error: {parseError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="policy-sample">Sample input (JSON, optional)</Label>
        <textarea
          id="policy-sample"
          rows={4}
          placeholder="{} — leave empty for the curated sample"
          value={sampleJson}
          onChange={(e) => setSampleJson(e.target.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="policy-sample"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRunEval}
          data-testid="policy-eval"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          Run evaluation
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          data-testid="policy-save"
        >
          <Save className="h-3 w-3" aria-hidden="true" />
          Save policy
        </Button>
        {result ? (
          <span
            className={
              result.matched
                ? 'rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300'
                : 'rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300'
            }
            data-testid="policy-eval-result"
            data-matched={String(result.matched)}
          >
            {result.matched
              ? `matches → ${POLICY_EFFECT_LABEL[result.effect]}`
              : 'no match → allow'}
          </span>
        ) : null}
      </div>
    </article>
  );
}
