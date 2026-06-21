'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  POLICY_EFFECT_LABEL,
  type Policy,
  type PolicyEffect,
} from '@/lib/org-knowledge/data';

const EFFECTS: ReadonlyArray<PolicyEffect> = ['allow', 'deny', 'require-approval', 'notify'];

const DEFAULT_LOGIC = JSON.stringify({ '==': [{ var: 'actor.role' }, 'guest'] }, null, 2);

export interface CreatePolicyDialogProps {
  onCreate?: (input: { title: string; effect: PolicyEffect; scope: string; logic: Record<string, unknown> }) => void;
}

export function CreatePolicyDialog({ onCreate }: CreatePolicyDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [effect, setEffect] = React.useState<PolicyEffect>('deny');
  const [scope, setScope] = React.useState('');
  const [logicText, setLogicText] = React.useState(DEFAULT_LOGIC);
  const [parseError, setParseError] = React.useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && scope.trim().length > 0;

  const reset = () => {
    setTitle('');
    setEffect('deny');
    setScope('');
    setLogicText(DEFAULT_LOGIC);
    setParseError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const parsed = JSON.parse(logicText) as Record<string, unknown>;
      onCreate?.({ title: title.trim(), effect, scope: scope.trim(), logic: parsed });
      setOpen(false);
      reset();
    } catch (err) {
      setParseError((err as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="create-policy-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Policy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New policy</DialogTitle>
          <DialogDescription>
            Policies use JSONLogic to evaluate runtime events.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pol-title">Title</Label>
            <Input
              id="pol-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pol-effect">Effect</Label>
              <Select
                value={effect}
                onValueChange={(v) => setEffect(v as PolicyEffect)}
              >
                <SelectTrigger id="pol-effect">
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
            <div className="grid gap-1.5">
              <Label htmlFor="pol-scope">Scope</Label>
              <Input
                id="pol-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="actor.role == 'guest'"
                required
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pol-logic">JSONLogic</Label>
            <textarea
              id="pol-logic"
              rows={6}
              value={logicText}
              onChange={(e) => setLogicText(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {parseError ? (
              <p className="text-[10px] text-rose-300">{parseError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="create-policy-submit"
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type { Policy };
