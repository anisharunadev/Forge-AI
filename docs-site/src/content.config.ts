// docs-site/src/content.config.ts
//
// Astro 5 + Starlight 0.30 require content collections to be declared
// explicitly. We use Starlight's own `docsSchema` so that the
// default frontmatter fields (title, description, draft, sidebar,
// hero, …) keep their Zod defaults — most importantly `draft`,
// which defaults to `false`. Without that default, Starlight's
// internal production filter (`data.draft === false`) would
// exclude every markdown file in `src/content/docs/` from the
// production build.

import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
};
