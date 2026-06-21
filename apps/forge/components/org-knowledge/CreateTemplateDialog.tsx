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
  TEMPLATE_KIND_LABEL,
  type Template,
  type TemplateKind,
} from '@/lib/org-knowledge/data';

const KINDS: ReadonlyArray<TemplateKind> = [
  'prd',
  'adr',
  'contract',
  'task',
  'risk',
  'security',
];

export interface CreateTemplateDialogProps {
  onCreate?: (input: { title: string; kind: TemplateKind; description: string; preview: string }) => void;
}

export function CreateTemplateDialog({ onCreate }: CreateTemplateDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [kind, setKind] = React.useState<TemplateKind>('prd');
  const [description, setDescription] = React.useState('');
  const [preview, setPreview] = React.useState('');

  const canSubmit =
    title.trim().length > 0 && description.trim().length > 0 && preview.trim().length > 0;

  const reset = () => {
    setTitle('');
    setKind('prd');
    setDescription('');
    setPreview('');
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
        <Button data-testid="create-template-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            Templates are reusable scaffolds for common org documents.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onCreate?.({
              title: title.trim(),
              kind,
              description: description.trim(),
              preview: preview.trim(),
            });
            setOpen(false);
            reset();
          }}
          className="space-y-3"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-title">Title</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-kind">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as TemplateKind)}>
              <SelectTrigger id="tpl-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TEMPLATE_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-description">Description</Label>
            <Input
              id="tpl-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-preview">Preview (markdown / body)</Label>
            <textarea
              id="tpl-preview"
              rows={5}
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="create-template-submit"
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type { Template };
