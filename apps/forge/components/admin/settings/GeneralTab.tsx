'use client';

/**
 * Settings — General tab.
 *
 * Project information form: name, slug, description, default branch,
 * visibility. Edits are saved via `useUpdateProject`, which
 * invalidates the project query key on success and triggers a
 * settings-scoped audit row on the server.
 *
 * The form is hydrated from `useProject()`; the form's default
 * values re-sync when the fetched project changes (so external
 * changes are reflected without losing in-progress edits).
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@/components/forms';
import { SectionCard } from '@/components/shell';

import { useProject, useUpdateProject } from '@/lib/hooks/useSettings';
import { projectUpdateSchema, type ProjectUpdateForm } from '@/lib/settings/schemas';

export function GeneralTab() {
  const projectQuery = useProject();
  const updateProject = useUpdateProject();
  const { toast } = useToast();

  const project = projectQuery.data;

  const form = useZodForm<typeof projectUpdateSchema, ProjectUpdateForm>(projectUpdateSchema, {
    defaultValues: {
      name: project?.name ?? '',
      slug: project?.slug ?? '',
      description: project?.description ?? '',
      defaultBranch: project?.defaultBranch ?? 'main',
      visibility: project?.visibility ?? 'private',
    },
  });

  // Re-sync defaults when the fetched project changes (covers
  // first-time hydration + any external change).
  React.useEffect(() => {
    if (!project) return;
    form.reset({
      name: project.name,
      slug: project.slug,
      description: project.description ?? '',
      defaultBranch: project.defaultBranch,
      visibility: project.visibility,
    });
  }, [project, form]);

  const onSubmit = form.handleSubmit(async (values: ProjectUpdateForm) => {
    try {
      await updateProject.mutateAsync({
        name: values.name,
        slug: values.slug,
        description: values.description || null,
        defaultBranch: values.defaultBranch,
        visibility: values.visibility,
      });
      toast({
        title: 'Project updated',
        description: 'Your changes were saved and recorded in the audit log.',
        variant: 'default',
      });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  });

  if (projectQuery.isLoading) {
    return (
      <SectionCard title="Project" description="Loading project details…">
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </SectionCard>
    );
  }

  if (projectQuery.error) {
    return (
      <SectionCard
        title="Project"
        description="We could not load the project details."
      >
        <p className="text-sm text-muted-foreground">
          {projectQuery.error.message}. The backend endpoint for project
          info lands with sub-plan A; this tab will populate once it
          ships.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Project"
      description="Identity and defaults shown across the workspace."
      headerRight={
        <Button
          type="submit"
          form="general-project-form"
          disabled={updateProject.isPending}
          data-testid="general-save"
        >
          {updateProject.isPending ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <Form {...form}>
        <form
          id="general-project-form"
          onSubmit={onSubmit}
          className="grid gap-4 sm:grid-cols-2"
          data-testid="general-form"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Forge Demo"
                    data-testid="general-name"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input
                    placeholder="forge-demo"
                    data-testid="general-slug"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Used in URLs and CLI commands. Lowercase only.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="visibility"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Visibility</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger data-testid="general-visibility">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultBranch"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default branch</FormLabel>
                <FormControl>
                  <Input
                    placeholder="main"
                    data-testid="general-default-branch"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="What is this project for?"
                    className="min-h-24"
                    data-testid="general-description"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </SectionCard>
  );
}
