import { site } from "./site";

export type StoreProduct = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  price: number;
  currency: "TRY";
  delivery: string;
  availability: string;
  serviceSlug: string;
  includes: string[];
  buyerFit: string[];
  requirements: string[];
  notIncluded: string[];
};

export const storeProducts: StoreProduct[] = [
  {
    slug: "ai-app-rescue-snapshot",
    title: "AI App Rescue Snapshot",
    category: "AI and MVP Repair",
    summary:
      "Fixed-scope review of one fragile AI app or workflow with a written fault map, priority fix list, and one concrete implementation path.",
    price: 9500,
    currency: "TRY",
    delivery: "3 business days after access and intake are complete",
    availability: "Remote delivery, worldwide",
    serviceSlug: "ai-workflow-development",
    includes: [
      "Review of one app, repo, workflow, or deployed demo",
      "Risk map for model behavior, data flow, permissions, UI states, and deployment",
      "Prioritized repair plan with the smallest useful next build step",
      "One async follow-up answer after delivery",
    ],
    buyerFit: [
      "AI demos that work in narrow cases but fail in real use",
      "Founders deciding whether to fix, rebuild, or stop a prototype",
      "Teams that need a senior product-engineering read before spending more",
    ],
    requirements: [
      "Repository or demo access",
      "Short written context about the current blocker",
      "One target outcome for the next two to six weeks",
    ],
    notIncluded: [
      "Full implementation",
      "Ongoing support",
      "Security audit or legal review",
    ],
  },
  {
    slug: "critical-mvp-fix-pass",
    title: "Critical MVP Fix Pass",
    category: "AI and MVP Repair",
    summary:
      "A bounded implementation pass for one blocking bug, deploy failure, broken integration, or product workflow that prevents a demo or sale.",
    price: 15000,
    currency: "TRY",
    delivery: "2 to 5 business days after scope confirmation",
    availability: "Remote delivery, worldwide",
    serviceSlug: "technical-rescue",
    includes: [
      "One critical issue selected before work begins",
      "Code fix or deploy/configuration repair within the agreed boundary",
      "Verification notes with what changed and how to retest",
      "Handoff note for the next engineering step",
    ],
    buyerFit: [
      "Founder MVPs that are blocked by one practical failure",
      "Small teams with a demo deadline",
      "Products where the next sale depends on one working path",
    ],
    requirements: [
      "Repository or deployment access",
      "Reproduction steps or a screen recording",
      "Approval for the exact file/deploy scope",
    ],
    notIncluded: [
      "Large rewrites",
      "Multiple unrelated bugs",
      "New feature development outside the selected blocker",
    ],
  },
  {
    slug: "agent-ready-product-data-pack",
    title: "Agent-Ready Product Data Pack",
    category: "Agentic Commerce",
    summary:
      "Implementation package for product/service schema, llms.txt, agents.txt, sitemap updates, and agent-readable commercial boundaries.",
    price: 8500,
    currency: "TRY",
    delivery: "3 business days after site access and product list are complete",
    availability: "Remote delivery, worldwide",
    serviceSlug: "agentic-commerce-consulting",
    includes: [
      "Structured product or service metadata for one site",
      "llms.txt and agents.txt updates",
      "Schema.org Offer, Service, Product, or ItemList markup where appropriate",
      "Checkout, quote, support, and policy boundary notes for AI-agent discovery",
    ],
    buyerFit: [
      "Small software or service sites that need clearer AI/search discovery",
      "Shopify, SaaS, and workflow products preparing for agent-mediated traffic",
      "Teams that need truthful public machine-readable docs",
    ],
    requirements: [
      "Product or service list with prices or quote rules",
      "Website repository access",
      "Approval for published public metadata",
    ],
    notIncluded: [
      "Payment gateway integration",
      "Autonomous delegated payment",
      "Unverified protocol claims",
    ],
  },
  {
    slug: "cloudflare-worker-deploy-repair",
    title: "Cloudflare Worker Deploy Repair",
    category: "Platform Delivery",
    summary:
      "A focused fix for one failing Cloudflare Worker, Pages-to-Workers migration, D1 binding, route, asset, or Wrangler deployment path.",
    price: 7500,
    currency: "TRY",
    delivery: "2 to 4 business days after access is complete",
    availability: "Remote delivery, worldwide",
    serviceSlug: "cloudflare-convex-platforms",
    includes: [
      "Review of one Cloudflare deployment path",
      "Wrangler, route, asset, binding, or build-script fix where needed",
      "Local build verification and deploy notes",
      "Rollback note or safe redeploy instruction",
    ],
    buyerFit: [
      "Sites stuck between Pages, Workers, and custom domains",
      "Small teams with broken Cloudflare deploys",
      "AI-generated projects that need a real production path",
    ],
    requirements: [
      "Repository access",
      "Cloudflare account access or deploy output",
      "Exact failing command, URL, or dashboard state",
    ],
    notIncluded: [
      "Long-term DevOps retainer",
      "New backend product build",
      "Account ownership transfer",
    ],
  },
  {
    slug: "astro-svelte-storefront-setup",
    title: "Astro/Svelte Service Storefront Setup",
    category: "Web Product Surface",
    summary:
      "A small storefront-style product/service catalog for a software business, with prices, package pages, policy links, and order routes.",
    price: 12000,
    currency: "TRY",
    delivery: "4 business days after content and access are complete",
    availability: "Remote delivery, worldwide",
    serviceSlug: "svelte-astro-product-development",
    includes: [
      "Store or service catalog page with categories and fixed prices",
      "Individual package pages with deliverables, delivery time, and purchase CTA",
      "Order request pages for each package",
      "Privacy, terms, delivery, and refund-policy links surfaced in the purchase flow",
    ],
    buyerFit: [
      "Solo software builders who need a clearer purchasable offer",
      "Payment-provider applications that need visible products and prices",
      "Existing Astro or Svelte sites that need a commercial surface quickly",
    ],
    requirements: [
      "Existing website repository",
      "At least three services or products to list",
      "Seller contact and policy details for publication",
    ],
    notIncluded: [
      "Payment-provider approval guarantee",
      "Payment gateway implementation",
      "Legal drafting beyond plain operational policy pages",
    ],
  },
  {
    slug: "shopify-workflow-fix-pack",
    title: "Shopify Workflow Fix Pack",
    category: "E-commerce Implementation",
    summary:
      "A bounded Shopify workflow implementation or repair package for Liquid, app, webhook, catalog, or integration issues.",
    price: 13500,
    currency: "TRY",
    delivery: "3 to 6 business days after access and issue selection",
    availability: "Remote delivery, worldwide",
    serviceSlug: "shopify-app-integration-development",
    includes: [
      "One selected Shopify workflow or integration problem",
      "Theme, app, webhook, catalog, or migration fix within agreed scope",
      "Before/after notes and retest steps",
      "Next-step recommendation if the issue needs a larger build",
    ],
    buyerFit: [
      "Stores with one painful manual workflow",
      "Agencies that need senior help on a scoped Shopify issue",
      "Teams deciding whether a theme patch should become an app",
    ],
    requirements: [
      "Store, theme, app, or repository access",
      "Written problem statement and expected behavior",
      "Approval for the exact production or staging boundary",
    ],
    notIncluded: [
      "Full public app launch",
      "Marketplace listing preparation",
      "Ongoing store management",
    ],
  },
  {
    slug: "swiftui-convex-prototype-starter",
    title: "SwiftUI + Convex Prototype Starter",
    category: "Mobile Prototype",
    summary:
      "Starter implementation for one SwiftUI product flow connected to Convex state, useful for proving a real mobile workflow quickly.",
    price: 17500,
    currency: "TRY",
    delivery: "5 to 8 business days after scope and access are complete",
    availability: "Remote delivery, worldwide",
    serviceSlug: "swiftui-convex-prototypes",
    includes: [
      "One SwiftUI flow with realistic states",
      "Convex schema/functions for the selected workflow",
      "Basic simulator verification notes",
      "Handoff notes for the next build step",
    ],
    buyerFit: [
      "Mobile-first founders validating a workflow",
      "Teams that need more than static Figma screens",
      "Products with approvals, state changes, messages, or operational steps",
    ],
    requirements: [
      "Xcode project or permission to scaffold a starter",
      "One selected workflow",
      "Apple platform target and demo device/simulator preference",
    ],
    notIncluded: [
      "App Store submission",
      "Production auth or billing",
      "Full product design system",
    ],
  },
  {
    slug: "technical-proof-page-pack",
    title: "Technical Proof Page Pack",
    category: "Web Product Surface",
    summary:
      "A compact proof-of-work page set for one product or service, including outcome, architecture, delivery boundary, and buyer CTA.",
    price: 6500,
    currency: "TRY",
    delivery: "2 business days after source material is complete",
    availability: "Remote delivery, worldwide",
    serviceSlug: "svelte-astro-product-development",
    includes: [
      "One public proof page for a product, service, or case study",
      "Architecture or workflow summary in plain language",
      "Buyer-fit section and CTA",
      "Schema and sitemap update where the site supports it",
    ],
    buyerFit: [
      "Builders with real work but weak commercial packaging",
      "Portfolio sites that need buyer-facing proof instead of generic claims",
      "Small software products that need a better sales surface",
    ],
    requirements: [
      "Source notes, screenshots, repo, or demo link",
      "Target buyer and desired CTA",
      "Website repository access",
    ],
    notIncluded: [
      "Logo or brand identity design",
      "Copy for unrelated pages",
      "Payment integration",
    ],
  },
];

export const featuredStoreProducts = storeProducts.slice(0, 4);

export function formatPrice(product: StoreProduct) {
  return `${new Intl.NumberFormat("en-US").format(product.price)} ${product.currency}`;
}

export function orderMailto(product: StoreProduct) {
  const subject = `Order request: ${product.title}`;
  const body = [
    `Hi ${site.name},`,
    "",
    `I want to buy: ${product.title}`,
    `Listed price: ${formatPrice(product)}`,
    `Delivery: ${product.delivery}`,
    "",
    "Buyer details:",
    "- Name:",
    "- Company:",
    "- Country:",
    "- Email:",
    "",
    "Project context:",
    "- Current site/app/repo:",
    "- What should be true after delivery:",
    "- Access or files I can provide:",
    "",
    "Please confirm availability, invoice/payment details, and start date.",
  ].join("\n");

  return `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
