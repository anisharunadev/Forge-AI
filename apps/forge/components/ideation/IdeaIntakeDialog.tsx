'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface IdeaIntakeInput {
  title: string;
  summary: string;
  owner: string;
  tags: string;
}

export interface IdeaIntakeDialogProps {
  onCreate?: (input: IdeaIntakeInput) => void;
}

export function IdeaIntakeDialog({ onCreate }: IdeaIntakeDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [owner, setOwner] = React.useState('');
  const [tags, setTags] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate?.({ title, summary, owner, tags });
    setTitle('');
    setSummary('');
    setOwner('');
    setTags('');
    setOpen(false);
  };

  const canSubmit = title.trim().length > 0 && summary.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="idea-intake-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Idea
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="idea-intake-dialog">
        <DialogHeader>
          <DialogTitle>Submit a new idea</DialogTitle>
          <DialogDescription>
            Ideas enter the intake pipeline and are scored before they can move
            into discovery.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="idea-title">Title</Label>
            <Input
              id="idea-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cost-aware agent routing"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idea-summary">Summary</Label>
            <Input
              id="idea-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One sentence describing the idea"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idea-owner">Owner</Label>
            <Input
              id="idea-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="e.g. Priya Shah"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idea-tags">Tags (comma-separated)</Label>
            <Input
              id="idea-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="ai, cost, dev"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit} data-testid="idea-intake-submit">
              Submit for scoring
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
