import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const pages = [
  {
    name: "homepage service section",
    path: join(root, "dist", "index.html"),
  },
  {
    name: "services index",
    path: join(root, "dist", "services", "index.html"),
  },
];

const expectedServicePrices = [
  ["AI Workflow and Agent Product Development", "Packages from $249 USD"],
  ["Agentic Commerce and Agent-Ready Product Implementation", "Packages from $229 USD"],
  ["Cloudflare and Convex Platform Engineering", "Packages from $199 USD"],
  ["Svelte and Astro Product Development", "Packages from $179 USD"],
  ["SwiftUI and Convex Product Prototypes", "Packages from $469 USD"],
  ["Shopify App, Integration, and Technical Rescue", "Packages from $359 USD"],
  ["Technical Rescue for Fragile MVPs", "Packages from $399 USD"],
];

for (const page of pages) {
  const html = readFileSync(page.path, "utf8");

  for (const [title, priceLabel] of expectedServicePrices) {
    assert.ok(
      html.includes(title),
      `${page.name} should include the ${title} service listing`
    );
    assert.ok(
      html.includes(priceLabel),
      `${page.name} should include ${priceLabel} for ${title}`
    );
  }
}

