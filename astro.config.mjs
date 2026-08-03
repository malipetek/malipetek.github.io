import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import markdoc from "@astrojs/markdoc";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://malipetek.dev",
  output: "static",
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  integrations: [
    react(),
    markdoc(),
  ],
});
