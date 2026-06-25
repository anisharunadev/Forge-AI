'use client';

/**
 * GuardrailSelector — multi-select picker for the Steward to assign
 * LiteLLM guardrails to a tenant.
 *
 * The catalog is fetched from `GET /admin/llm-gateway/guardrails`
 * (added by a follow-up endpoint). For now the selector is wired
 * with a static catalog stub so the UI shape is stable; the seam
 * here is the same as the live endpoint (id, name, description).
 *
 * UX:
 *   - Selected items appear as chips on top of the catalog grid.
 *   - Each card in the grid is a toggle (click to add/remove).
 *   - Save is a separate action so the Steward can review the
 *     intended state before committing.
 */

import * as React from 'react';
import { ShieldCheck, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Catalog (placeholder — replaced by the live endpoint in a follow-up)
// ---------------------------------------------------------------------------

export interface GuardrailDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

const PLACEHOLDER_CATALOG: ReadonlyArray<GuardrailDescriptor> = [
  {
    id: 'pii',
    name: 'PII redaction',
    description: 'Strips emails, phone numbers, and SSNs from prompts and responses.',
  },
  {
    id: 'content_safety',
    name: 'Content safety',
    description: 'Blocks prompts or completions that violate the safety policy.',
  },
  {
    id: 'prompt_injection',
    name: 'Prompt-injection defense',
    description: 'Detects and rejects instruction-override attempts.',
  },
  {
    id: 'jailbreak',
    name: 'Jailbreak guard',
    description: 'Rejects known jailbreak patterns before they reach the model.',
  },
  {
    id: 'secrets',
    name: 'Secret redaction',
    description: 'Masks API keys, tokens, and credentials in model I/O.',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GuardrailSelectorProps {
  readonly tenantId: string;
  /** Initial assigned ids — used to seed local state on mount. */
  readonly initialAssigned: ReadonlyArray<string>;
  /** Optional save callback (override default in tests / stories). */
  readonly onSave?: (ids: ReadonlyArray<string>) => Promise<void>;
  /** Optional catalog override (tests / stories). */
  readonly catalog?: ReadonlyArray<GuardrailDescriptor>;
}

export function GuardrailSelector({
  tenantId,
  initialAssigned,
  onSave,
  catalog = PLACEHOLDER_CATALOG,
}: GuardrailSelectorProps) {
  const [selected, setSelected] = React.useState<ReadonlyArray<string>>(
    initialAssigned,
  );
  const [saving, setSaving] = React.useState(false);
  const { toast } = useToast();

  const toggle = (id: string) => {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (onSave) {
        await onSave(selected);
      } else {
        // Default behavior: optimistically confirm. The live wiring
        // arrives when `POST /admin/llm-gateway/tenants/{id}/guardrails`
        // lands (Phase B follow-up).
        await new Promise((r) => setTimeout(r, 250));
      }
      toast({
        title: 'Guardrails updated',
        description: `${selected.length} guardrail(s) assigned to ${tenantId}.`,
      });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="guardrail-selector">
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((id) => {
            const item = catalog.find((g) => g.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs"
                data-testid={`guardrail-chip-${id}`}
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {item?.name ?? id}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="ml-0.5 inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${item?.name ?? id}`}
                  data-testid={`guardrail-chip-remove-${id}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        data-testid="guardrail-catalog"
      >
        {catalog.map((g) => {
          const isOn = selected.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              className={cn(
                'flex items-start justify-between gap-2 rounded-md border p-3 text-left transition-colors',
                isOn
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-border bg-card hover:border-foreground/30',
              )}
              aria-pressed={isOn}
              data-testid={`guardrail-card-${g.id}`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {g.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {g.description}
                </span>
              </div>
              <span
                className={cn(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px]',
                  isOn
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-border bg-background text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {isOn ? '✓' : <Plus className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button
          onClick={handleSave}
          disabled={saving}
          data-testid="guardrail-save"
        >
          {saving ? 'Saving…' : 'Save guardrails'}
        </Button>
      </div>
    </div>
  );
}

// Re-export the placeholder catalog so the dashboard can list
// "available guardrails" without duplicating the array.
export { PLACEHOLDER_CATALOG as GUARDRAIL_CATALOG };
