import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

// The end-to-end suite (test/e2e.mjs) runs this same dev server against a
// throwaway state folder — its own D1, KV and rate limits — and adds the
// variables it needs (a mock control plane). Unset, nothing changes.
const e2eState = process.env.MALIPETEK_E2E_STATE;
const e2eVars = process.env.MALIPETEK_E2E_VARS ? (JSON.parse(process.env.MALIPETEK_E2E_VARS) as Record<string, string>) : null;

// flue() must come before cloudflare(): it prepares the generated Worker
// entry and the merged wrangler config that the Cloudflare plugin consumes.
const plugins = [flue({ providers: ['openrouter'] })];
const flueConfig = flueWorkerConfig();

export default defineConfig({
  plugins: [
    ...plugins,
    cloudflare({
      config: (config) => {
        flueConfig(config);
        if (e2eVars) config.vars = { ...(config.vars ?? {}), ...e2eVars };
      },
      ...(e2eState ? { persistState: { path: e2eState } } : {}),
    }),
  ],
});
