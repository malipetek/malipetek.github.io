import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import markdoc from '@astrojs/markdoc';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';

// Keystatic needs Node APIs and React for its admin UI, which cannot exist in a
// static build. Mount it (and React) only while the dev server is running so
// `pnpm build` keeps emitting a plain static `dist/` with no `/keystatic` route.
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  site: 'https://malipetek.dev',
  // The old /chat page is gone; the intercom lives at /#talk. Astro emits a
  // static meta-refresh page for this redirect (no server runtime needed).
  redirects: {
    '/chat': '/#talk',
  },
  integrations: [
    sitemap(),
    markdoc(),
    ...(isDev ? [react(), keystatic()] : []),
  ],
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
    },
  },
});
