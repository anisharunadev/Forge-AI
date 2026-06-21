import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Forge AI',
      description: 'Enterprise SDLC Agent Operating System — orchestrate agents, knowledge, governance, and delivery workflows.',
      logo: { src: './src/assets/logo.svg', alt: 'Forge AI' },
      social: {
        github: 'https://github.com/forge-ai/forge-ai',
      },
      sidebar: [
        { label: 'Start Here', autogenerate: { directory: 'start-here' } },
        { label: 'Concepts', autogenerate: { directory: 'concepts' } },
        { label: 'Forge Commands', autogenerate: { directory: 'commands' } },
        { label: 'Guides', autogenerate: { directory: 'guides' } },
        { label: 'Architecture', autogenerate: { directory: 'architecture' } },
        { label: 'Operations', autogenerate: { directory: 'operations' } },
        { label: 'Reference', autogenerate: { directory: 'reference' } },
      ],
      components: {
        Header: './src/components/Header.astro',
        Footer: './src/components/Footer.astro',
      },
      customCss: ['./src/styles/custom.css'],
    }),
  ],
  site: 'https://docs.forge-ai.com',
});
