// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://docs.forge-ai.dev',
  integrations: [
    starlight({
      title: 'Forge AI',
      description:
        'Forge AI — the enterprise-grade SDLC agent from Knackforge. Documentation for agents, installation, self-hosting, integrations, architecture, and API reference.',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      social: {
        github: 'https://github.com/forge-ai/forge',
        slack: 'https://forge-ai.dev/slack',
      },
      editLink: {
        baseUrl: 'https://github.com/forge-ai/forge/edit/main/docs-site/',
      },
      sidebar: [
        {
          label: 'Overview',
          items: [
            { label: 'What is Forge AI?', slug: 'what-is-fora' },
            { label: 'Quickstart', slug: 'quickstart' },
            { label: 'Key features', slug: 'features' },
          ],
        },
        {
          label: 'Installation',
          items: [
            { label: 'Overview', slug: 'installation' },
            { label: 'Prerequisites', slug: 'installation/prerequisites' },
            { label: 'Dev setup', slug: 'installation/dev-setup' },
            { label: 'Production deploy', slug: 'installation/production' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Overview', slug: 'self-host' },
            { label: 'AWS reference architecture', slug: 'self-host/aws' },
            { label: 'Kubernetes (EKS)', slug: 'self-host/kubernetes' },
            { label: 'Environment variables', slug: 'self-host/environment' },
          ],
        },
        {
          label: 'Agents',
          items: [
            { label: 'Overview', slug: 'agents' },
            { label: 'Master Orchestrator', slug: 'agents/master-orchestrator' },
            { label: 'BA (Ideation)', slug: 'agents/ba' },
            { label: 'Architect', slug: 'agents/architect' },
            { label: 'Developer', slug: 'agents/developer' },
            { label: 'QA', slug: 'agents/qa' },
            { label: 'Security', slug: 'agents/security' },
            { label: 'DevOps', slug: 'agents/devops' },
            { label: 'Documentation', slug: 'agents/documentation' },
            { label: 'Memory', slug: 'agents/memory' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', slug: 'architecture' },
            { label: 'Staged workflow', slug: 'architecture/staged-workflow' },
            { label: 'Knowledge Layer', slug: 'architecture/knowledge-layer' },
            { label: 'Multi-tenancy', slug: 'architecture/multi-tenancy' },
            { label: 'Audit log', slug: 'architecture/audit' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'Overview', slug: 'integrations' },
            { label: 'Jira', slug: 'integrations/jira' },
            { label: 'GitHub', slug: 'integrations/github' },
            { label: 'Confluence', slug: 'integrations/confluence' },
            { label: 'SonarQube', slug: 'integrations/sonarqube' },
            { label: 'Figma', slug: 'integrations/figma' },
            { label: 'AWS', slug: 'integrations/aws' },
            { label: 'Slack / Teams', slug: 'integrations/slack' },
          ],
        },
        {
          label: 'API reference',
          items: [
            { label: 'Overview', slug: 'api' },
            { label: 'OpenAPI 3.1', slug: 'api/openapi' },
          ],
        },
        {
          label: 'Security',
          items: [
            { label: 'Overview', slug: 'security' },
            { label: 'Threat model', slug: 'security/threat-model' },
            { label: 'Identity & access', slug: 'security/iam' },
            { label: 'Secrets', slug: 'security/secrets' },
            { label: 'Compliance', slug: 'security/compliance' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Glossary', slug: 'reference/glossary' },
            { label: 'Architecture decisions', slug: 'reference/adr' },
          ],
        },
      ],
      customCss: ['./src/styles/global.css'],
      components: {
        Header: './src/components/Header.astro',
        Footer: './src/components/Footer.astro',
      },
    }),
    mdx(),
    sitemap(),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark-dimmed',
      wrap: true,
    },
  },
  vite: {
    server: {
      watch: {
        // Don't watch the parent monorepo's node_modules
        ignored: ['**/node_modules/**', '**/dist/**'],
      },
    },
  },
});
