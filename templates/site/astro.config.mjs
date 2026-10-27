import { defineConfig } from 'astro/config';

// Static output only: the built site is uploaded to our own hosting
// (malipetek.online) as immutable files. No SSR, no adapter.
export default defineConfig({ output: 'static' });
