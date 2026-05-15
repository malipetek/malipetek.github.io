import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://malipetek.dev",
  output: "static",
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = decodeURIComponent(new URL(page).pathname);
        return pathname !== "/projects/" && !pathname.includes(" ");
      },
    }),
  ],
});
