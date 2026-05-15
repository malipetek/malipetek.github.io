export const site = {
  name: "Muhammet Ali Petek",
  url: "https://malipetek.dev",
  email: "malipetek@gmail.com",
  title:
    "Full-stack product engineer building AI-assisted products, Cloudflare/Convex platforms, Svelte/Astro apps, SwiftUI prototypes, and weird useful tools.",
  description:
    "Muhammet Ali Petek turns messy product and workflow ideas into shipped systems: UI, backend, agents, integrations, deployment, dashboards, and operational details after the demo.",
  sameAs: [
    "https://github.com/malipetek",
    "https://www.linkedin.com/in/malipetek",
  ],
};

export function absoluteUrl(path = "/") {
  return new URL(path, site.url).href;
}
