import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

// flue() must come before cloudflare(): it prepares the generated Worker
// entry and the merged wrangler config that the Cloudflare plugin consumes.
export default defineConfig({
  plugins: [flue({ providers: ['openrouter'] }), cloudflare({ config: flueWorkerConfig() })],
});
