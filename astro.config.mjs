import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import markdoc from "@astrojs/markdoc";
import react from "@astrojs/react";
import keystatic from "@keystatic/astro";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://malipetek.dev",
  output: "hybrid",
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  integrations: [
    react(),
    markdoc(),
    sitemap({
      filter: (page) => {
        const pathname = decodeURIComponent(new URL(page).pathname);
        return pathname !== "/projects/" && !pathname.includes(" ");
      },
    }),
    keystatic(),
  ],
});
