// docs-site/src/content.config.ts
//
// Astro 5 + Starlight require content collections to be declared explicitly.
// We use Starlight's own `docsSchema` so the default frontmatter fields
// (title, description, draft, sidebar, hero, …) keep their Zod defaults —
// most importantly `draft`, which defaults to `false`.

import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
};
