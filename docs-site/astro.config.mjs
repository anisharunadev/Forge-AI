import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Forge AI',
      description: 'Enterprise SDLC Agent Operating System — orchestrate agents, knowledge, governance, and delivery workflows.',
      logo: { src: './src/assets/logo.svg', alt: 'Forge AI' },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/forge-ai/forge-ai' },
      ],
      // The order below mirrors the app's navigation: Start Here → Workspace →
      // Centers → Lifecycle → Guides → Concepts → Reference.
      // Use `autogenerate` for directory contents (safer for the build); list
      // single-file slugs explicitly where the directory is mixed.
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { slug: 'start-here/quickstart' },
            { slug: 'start-here/what-is-forge' },
            { slug: 'start-here/why-forge' },
            { slug: 'start-here/architecture-tour' },
          ],
        },
        {
          label: 'Workspace',
          items: [
            { slug: 'workspace/dashboard' },
            { slug: 'workspace/co-pilot' },
          ],
        },
        {
          label: 'Centers',
          items: [{ autogenerate: { directory: 'centers' } }],
        },
        {
          label: 'Lifecycle',
          items: [{ autogenerate: { directory: 'lifecycle' } }],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Concepts',
          items: [{ autogenerate: { directory: 'concepts' } }],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/forge-commands' },
            { slug: 'reference/api' },
            { slug: 'reference/openapi' },
            { slug: 'reference/audit-codes' },
            { slug: 'reference/events' },
            { slug: 'reference/mcp-servers' },
            { slug: 'reference/glossary' },
          ],
        },
        {
          label: 'Forge Commands',
          items: [{ autogenerate: { directory: 'commands' } }],
        },
        {
          label: 'Architecture',
          collapsed: true,
          items: [{ autogenerate: { directory: 'architecture' } }],
        },
        {
          label: 'Operations',
          collapsed: true,
          items: [{ autogenerate: { directory: 'operations' } }],
        },
        {
          label: 'Integration',
          collapsed: true,
          items: [{ autogenerate: { directory: 'integration' } }],
        },
      ],
      components: {
        Header: './src/components/Header.astro',
        Footer: './src/components/Footer.astro',
      },
      customCss: ['./src/styles/custom.css'],
      editLink: {
        baseUrl: 'https://github.com/forge-ai/forge-ai/edit/main/docs-site/',
      },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      markdown: {
        headingLinks: true,
      },
    }),
  ],
  site: 'https://docs.forge-ai.com',
});
