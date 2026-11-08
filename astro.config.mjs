import { defineConfig } from 'astro/config';
import markdoc from '@astrojs/markdoc';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import cloudflare from '@astrojs/cloudflare';
import portalHeaders from './src/integrations/portalHeaders.mjs';

// The site runs on Cloudflare Workers: SSR serves the pages whose content is
// read at request time (the knowledgebase, the plugins, the host split) while
// prerendered pages stay static.
//
// There is no sitemap integration: the same build serves malipetek.dev and
// lab.malipetek.dev, and each host publishes only its own URLs. See
// src/pages/sitemap.xml.ts.
export default defineConfig({
  site: 'https://malipetek.dev',
  output: 'server',
  adapter: cloudflare({
    // Host redirects must run before a prerendered asset is served; middleware
    // alone cannot see those. See src/worker.ts.
    workerEntryPoint: { path: './src/worker.ts' },
  }),
  // The old /chat page is gone; the intercom lives at /#talk.
  redirects: {
    '/chat': '/#talk',
  },
  integrations: [markdoc(), react(), keystatic(), portalHeaders()],
  // A link is fetched while the pointer rests on it, so the page transition
  // starts on the click instead of waiting for the network.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
    },
  },
});
