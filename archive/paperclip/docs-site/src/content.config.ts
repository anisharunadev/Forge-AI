import { defineCollection, z } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // Extend the default Starlight docs schema with the Forge AI Knowledge Layer
    // freshness contract fields. Every generated page must carry these so the
    // doc index in workspace/project/docs.md can validate a re-run.
    schema: docsSchema({
      extend: z.object({
        last_generated_at: z.coerce.string(),
        source_sha: z.string(),
        source_path: z.string().optional(),
        generator: z.string().default("readme"),
        approval_required: z.boolean().default(false),
      }),
    }),
  }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
