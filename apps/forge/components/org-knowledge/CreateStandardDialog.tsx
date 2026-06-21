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
  CATEGORY_LABEL,
  type Standard,
  type StandardCategory,
} from '@/lib/org-knowledge/data';

const CATEGORIES: ReadonlyArray<StandardCategory> = [
  'architecture',
  'security',
  'quality',
  'operations',
  'documentation',
];

export interface CreateStandardDialogProps {
  onCreate?: (input: { title: string; category: StandardCategory; body: string }) => void;
}

export function CreateStandardDialog({ onCreate }: CreateStandardDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState<StandardCategory>('architecture');
  const [body, setBody] = React.useState('');

  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  const reset = () => {
    setTitle('');
    setCategory('architecture');
    setBody('');
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
        <Button data-testid="create-standard-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Standard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New standard</DialogTitle>
          <DialogDescription>
            Standards begin in <code>draft</code> state and progress through
            review before becoming <code>approved</code>.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onCreate?.({ title: title.trim(), category, body: body.trim() });
            setOpen(false);
            reset();
          }}
          className="space-y-3"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="std-title">Title</Label>
            <Input
              id="std-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="std-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as StandardCategory)}
            >
              <SelectTrigger id="std-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="std-body">Body</Label>
            <textarea
              id="std-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="create-standard-submit"
            >
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Re-export the Standard type so consumers don't have to import it from
// mock-data directly when they only need the input shape.
export type { Standard };
