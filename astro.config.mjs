import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import markdoc from '@astrojs/markdoc';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import cloudflare from '@astrojs/cloudflare';

// The site runs on Cloudflare Workers: SSR serves /keystatic (and any dynamic
// route) while prerendered pages stay static. Keystatic edits commit straight
// to GitHub via its OAuth flow — the secrets are Worker env vars.
export default defineConfig({
  site: 'https://malipetek.dev',
  output: 'server',
  adapter: cloudflare(),
  // The old /chat page is gone; the intercom lives at /#talk.
  redirects: {
    '/chat': '/#talk',
  },
  integrations: [sitemap(), markdoc(), react(), keystatic()],
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
    },
  },
});
