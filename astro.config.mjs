import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://malipetek.dev',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
    },
  },
});
