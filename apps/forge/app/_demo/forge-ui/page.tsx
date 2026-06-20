"use client";

import { useState } from "react";
import { ThemeProvider } from "@fora/forge-ui/tokens";
import {
  Button,
  Input,
  Label,
  Badge,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@fora/forge-ui/primitives";
import {
  SkipLink,
  LiveRegionProvider,
  VisuallyHidden,
} from "@fora/forge-ui/a11y";
import "@fora/forge-ui/styles.css";

/**
 * Demo route for FORA-393-F1. Exercises every primitive that ships in the
 * foundation layer (Button / Input / Label / Badge / Dialog / Select), the
 * SkipLink, the VisuallyHidden helper, and the ThemeProvider. The axe-core
 * Playwright spec at packages/forge-ui/playwright/a11y.spec.ts targets this
 * route via /_demo/forge-ui.
 */
export default function ForgeUIDemoPage() {
  const [open, setOpen] = useState(false);

  return (
    <ThemeProvider persona="pm">
      <LiveRegionProvider>
        <SkipLink targetId="forge-main" />

        <main
          id="forge-main"
          tabIndex={-1}
          className="mx-auto max-w-3xl space-y-8 p-8 focus:outline-none"
          data-testid="forge-ui-demo"
        >
          <header className="space-y-2">
            <h1 className="text-display-2 font-semibold text-ink-default">
              FORA Design System
            </h1>
            <p className="text-body text-ink-muted">
              KnackForge brand overlay · dark + light themes · WCAG 2.2 AA.
            </p>
          </header>

          <section aria-labelledby="buttons-h" className="space-y-3">
            <h2 id="buttons-h" className="text-heading-2 font-semibold">
              Buttons
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="link">Link</Button>
              <Button size="icon" aria-label="More actions">
                <span aria-hidden="true">⋯</span>
              </Button>
            </div>
          </section>

          <section aria-labelledby="badges-h" className="space-y-3">
            <h2 id="badges-h" className="text-heading-2 font-semibold">
              Status badges
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">draft</Badge>
              <Badge tone="primary">in review</Badge>
              <Badge tone="success">accepted</Badge>
              <Badge tone="warn">warn</Badge>
              <Badge tone="danger">critical</Badge>
              <Badge tone="accent">accent</Badge>
            </div>
          </section>

          <section aria-labelledby="form-h" className="space-y-3">
            <h2 id="form-h" className="text-heading-2 font-semibold">
              Form
            </h2>
            <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Your name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role">Role</Label>
                <Select name="role">
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pm">Product Manager</SelectItem>
                    <SelectItem value="eng-lead">Engineering Lead</SelectItem>
                    <SelectItem value="cto">CTO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit">Save</Button>
            </form>
          </section>

          <section aria-labelledby="dialog-h" className="space-y-3">
            <h2 id="dialog-h" className="text-heading-2 font-semibold">
              Dialog
            </h2>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm deployment</DialogTitle>
                  <DialogDescription>
                    Deploying to <strong>production</strong>. This action rotates the
                    active fleet.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <Button variant="danger" onClick={() => setOpen(false)}>
                    Deploy
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>

          <section aria-labelledby="a11y-h" className="space-y-3">
            <h2 id="a11y-h" className="text-heading-2 font-semibold">
              Accessibility helpers
            </h2>
            <p className="text-body text-ink-default">
              Press Tab to see the{" "}
              <VisuallyHidden>visually hidden helper text</VisuallyHidden>
              focusable skip link at the top of the page. The{" "}
              <VisuallyHidden>two ARIA live regions</VisuallyHidden> announce
              status updates to screen readers.
            </p>
          </section>
        </main>
      </LiveRegionProvider>
    </ThemeProvider>
  );
}