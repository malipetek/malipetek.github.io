export type Service = {
  slug: string;
  title: string;
  shortTitle: string;
  summary: string;
  answer: string;
  bestFor: string[];
  deliverables: string[];
  proof: string[];
  relatedProducts: string[];
  keywords: string[];
  faq: {
    question: string;
    answer: string;
  }[];
};

export const services: Service[] = [
  {
    slug: "ai-workflow-development",
    title: "AI Workflow and Agent Product Development",
    shortTitle: "AI workflows",
    summary:
      "Design and build AI-assisted workflows that survive real users: retrieval, routing, UI, backend state, observability, and handoff after the demo.",
    answer:
      "AI workflow development means turning a model demo into a maintainable product workflow. The useful work is usually around data shape, UI states, tool calls, permissions, retries, evaluation, deployment, and operational follow-up.",
    bestFor: [
      "Founders with an AI-assisted MVP that works in demos but breaks in daily use.",
      "Teams adding agents, chat, or workflow automation to an existing product.",
      "Studios that need a practical engineer to connect model behavior to product operations.",
    ],
    deliverables: [
      "Paid discovery and workflow map",
      "Prototype with real UI and backend state",
      "Agent/tool routing and integration layer",
      "Deployment and operational notes",
    ],
    proof: ["GPTflare", "DeepTurkishNews3", "Portfolio chatbot stack"],
    relatedProducts: ["gptflare", "deepturkishnews3"],
    keywords: [
      "AI workflow developer",
      "agent product engineer",
      "AI MVP rescue",
      "custom GPT workflow development",
    ],
    faq: [
      {
        question: "What is AI workflow development?",
        answer:
          "AI workflow development is the product engineering around an AI feature: UI, backend state, tool calls, retrieval, permissions, deployment, dashboards, and operational handoff after the model response.",
      },
      {
        question: "When should a team hire an AI workflow engineer?",
        answer:
          "Hire an AI workflow engineer when a demo works but the product needs reliability, routing, data ownership, user-facing state, integrations, and a way to operate the system after launch.",
      },
    ],
  },
  {
    slug: "agentic-commerce-consulting",
    title: "Agentic Commerce and Agent-Ready Product Consulting",
    shortTitle: "Agentic commerce",
    summary:
      "Prepare Shopify, SaaS, and workflow-heavy products for AI-agent discovery, comparison, install, checkout, support, and Agentic Commerce Protocol readiness.",
    answer:
      "Agentic commerce consulting means making a product or service understandable and operable by AI agents: crawlable product pages, structured data, clear commercial boundaries, machine-readable policy files, checkout or quote flows, and ACP-style implementation planning where it fits.",
    bestFor: [
      "Shopify app or service builders who want agents to understand what can be installed, tried, quoted, or purchased.",
      "SaaS and workflow products preparing for agent-mediated discovery, evaluation, and checkout.",
      "Teams that need a practical readiness pass before implementing Agentic Commerce Protocol endpoints.",
    ],
    deliverables: [
      "Agent-readiness audit for product, service, checkout, and support flows",
      "agents.txt, llms.txt, schema, sitemap, and product/service page improvements",
      "Product data model for agent discovery, comparison, and action routing",
      "ACP feasibility, checkout boundary, and implementation scope",
    ],
    proof: ["GPTflare", "Shopify Workflow App", "Malipetek.dev Astro fork"],
    relatedProducts: ["gptflare", "shopify-workflow-app"],
    keywords: [
      "agentic commerce consultant",
      "Agentic Commerce Protocol implementation",
      "agents.txt consultant",
      "AI agent commerce readiness",
      "Shopify agentic commerce",
    ],
    faq: [
      {
        question: "What is agentic commerce consulting?",
        answer:
          "Agentic commerce consulting prepares a product or service for AI agents that discover, compare, recommend, install, quote, or purchase on behalf of people. The work usually includes structured product data, crawlable pages, schema, policies, checkout boundaries, APIs, and operational handoff.",
      },
      {
        question: "Can agents buy or install from this site today?",
        answer:
          "Not autonomously. This site exposes agent-readable discovery files and clear contact routes, but paid discovery is still the commercial entry point for architecture, scope, implementation, or agentic commerce integration work.",
      },
      {
        question: "Can Muhammet help implement Agentic Commerce Protocol?",
        answer:
          "Yes. The right first step is a paid readiness pass: review product data, checkout or quote flows, payment boundaries, authentication, support operations, and whether ACP endpoints make sense for the product stage.",
      },
    ],
  },
  {
    slug: "cloudflare-convex-platforms",
    title: "Cloudflare and Convex Platform Engineering",
    shortTitle: "Cloudflare / Convex platforms",
    summary:
      "Build low-cost platform systems with Cloudflare Workers/D1/Pages, Convex, GitHub provisioning, dashboards, deploy flows, and backend operations.",
    answer:
      "Cloudflare and Convex platform engineering is useful when a small team needs fast product iteration without a heavy infrastructure bill. The work includes Workers, D1, Pages, Convex, GitHub automation, auth, dashboards, deployment, and rollback-aware operations.",
    bestFor: [
      "Startups building control planes, dashboards, and real-time product backends.",
      "AI builders who need provisioning, preview, approval, and deployment workflows.",
      "Teams that want infrastructure simple enough to reason about and strong enough to run.",
    ],
    deliverables: [
      "Cloudflare Worker or Convex backend architecture",
      "D1/Convex data model and workflow state",
      "GitHub-backed provisioning and deploy flows",
      "Admin dashboard, logs, and operational paths",
    ],
    proof: ["Convexer", "GPTflare", "DeepTurkishNews3"],
    relatedProducts: ["convexer", "gptflare", "deepturkishnews3"],
    keywords: [
      "Cloudflare Workers developer",
      "Convex developer",
      "Cloudflare D1 platform engineer",
      "fractional platform engineer",
    ],
    faq: [
      {
        question: "What can be built with Cloudflare Workers and Convex?",
        answer:
          "Cloudflare Workers and Convex are a strong fit for dashboards, AI workflow backends, real-time product state, publishing platforms, control planes, internal tools, and low-cost product infrastructure.",
      },
      {
        question: "Why use Cloudflare and Convex for early products?",
        answer:
          "They keep the operating model small: fast TypeScript development, simple deployment, good enough backend primitives, and low infrastructure overhead for small teams.",
      },
    ],
  },
  {
    slug: "svelte-astro-product-development",
    title: "Svelte and Astro Product Development",
    shortTitle: "Svelte / Astro systems",
    summary:
      "Build fast product surfaces, publishing systems, docs, catalogs, and content workflows with Astro, Svelte, Keystatic, and Cloudflare deployment.",
    answer:
      "Svelte and Astro product development is best for fast, readable product surfaces where content, workflow, and deployment matter. Astro is strong for static and publishing pages; Svelte is strong for interactive product surfaces.",
    bestFor: [
      "Publishing teams that need fast editorial workflows.",
      "Product teams that need a sharp marketing/product site with real technical content.",
      "Builders who want agent-updatable structured content instead of a heavy CMS.",
    ],
    deliverables: [
      "Astro or Svelte product surface",
      "Structured Markdown/MDX/content collections",
      "Keystatic or GitHub-backed editor workflow",
      "Cloudflare Pages/Workers deployment",
    ],
    proof: ["Uygulamali Felsefe Publishing Platform", "DeepTurkishNews3", "Malipetek.dev Astro fork"],
    relatedProducts: ["uygulamali-felsefe", "deepturkishnews3"],
    keywords: [
      "Astro developer",
      "Svelte developer",
      "Keystatic publishing platform",
      "Cloudflare Pages Astro site",
    ],
    faq: [
      {
        question: "When should a team use Astro?",
        answer:
          "Use Astro when the product needs fast static pages, content collections, docs, publishing, SEO, and simple deployment without forcing every page into a client-side app model.",
      },
      {
        question: "When should a team use Svelte?",
        answer:
          "Use Svelte when the product has real interaction, state, components, dashboards, or embedded tool surfaces that need to stay small and understandable.",
      },
    ],
  },
  {
    slug: "swiftui-convex-prototypes",
    title: "SwiftUI and Convex Product Prototypes",
    shortTitle: "SwiftUI prototypes",
    summary:
      "Prototype iOS products with SwiftUI, Convex real-time backend state, auth, process flows, messaging, push notifications, and automation scripts.",
    answer:
      "SwiftUI and Convex are a practical pairing for early mobile products because the app can move quickly while backend state, subscriptions, approvals, and messaging stay real.",
    bestFor: [
      "Founders testing a mobile-first workflow.",
      "Teams that need a prototype connected to a real backend.",
      "Products with approvals, state changes, chat, notifications, or provider workflows.",
    ],
    deliverables: [
      "SwiftUI prototype or MVP surface",
      "Convex data model and subscriptions",
      "Process actions, messaging, and notifications",
      "Simulator/device automation scripts",
    ],
    proof: ["TAPU Rental Management"],
    relatedProducts: ["tapu-rental-management"],
    keywords: [
      "SwiftUI prototype developer",
      "Convex Swift app",
      "iOS MVP developer",
      "real-time mobile app prototype",
    ],
    faq: [
      {
        question: "Can a SwiftUI prototype use a real backend?",
        answer:
          "Yes. A SwiftUI prototype can use Convex for real-time backend state, subscriptions, auth-adjacent workflows, process approvals, messaging, and notifications from the beginning.",
      },
      {
        question: "What makes a mobile prototype useful?",
        answer:
          "A useful mobile prototype proves the workflow, not just screens. It should include backend state, realistic actions, errors, messaging, notifications, and enough operational behavior to test the product idea.",
      },
    ],
  },
  {
    slug: "shopify-app-integration-development",
    title: "Shopify App, Integration, and Technical Rescue",
    shortTitle: "Shopify app and rescue",
    summary:
      "Build or rescue Shopify apps, Liquid/Svelte theme tooling, catalog workflows, migrations, wholesale logic, webhooks, and storefront/admin integrations.",
    answer:
      "Shopify technical rescue is for cases where a theme patch is no longer enough. The work may become a private app, public app, migration script, webhook workflow, admin surface, or integration between Shopify and the rest of the business.",
    bestFor: [
      "Stores with recurring workflow pain inside theme edits or spreadsheets.",
      "Agencies that need senior help on Shopify Plus, Liquid, app, or integration work.",
      "E-commerce teams planning private apps, public apps, migrations, or custom catalog logic.",
    ],
    deliverables: [
      "Shopify app or private workflow architecture",
      "Liquid/theme rescue or Svelte/Liquid tooling",
      "Webhook and API integration work",
      "Catalog, wholesale, migration, or admin workflow implementation",
    ],
    proof: ["Liquivelte v4", "Shopify Workflow App", "TRUTH Istanbul client work"],
    relatedProducts: ["shopify-workflow-app", "liquivelte-v4"],
    keywords: [
      "Shopify app developer",
      "Shopify integration developer",
      "Shopify technical rescue",
      "Shopify Liquid Svelte developer",
    ],
    faq: [
      {
        question: "When does a Shopify problem need an app instead of a theme edit?",
        answer:
          "A Shopify problem usually needs an app when the workflow depends on backend state, webhooks, admin actions, custom pricing, migrations, repeated data sync, or business logic that should not live inside theme code.",
      },
      {
        question: "Can Shopify rescue work include legacy systems?",
        answer:
          "Yes. Shopify rescue work often includes legacy data, Lightspeed, Magento, WooCommerce, BigCommerce, custom APIs, old storefront code, and migration logic.",
      },
    ],
  },
  {
    slug: "technical-rescue",
    title: "Technical Rescue for Fragile MVPs",
    shortTitle: "Technical rescue",
    summary:
      "Stabilize fragile MVPs by clarifying architecture, fixing deployment paths, removing accidental complexity, and turning demos into maintainable product systems.",
    answer:
      "Technical rescue means making a fragile MVP understandable, shippable, and operable. The goal is not a rewrite by default; the goal is to find the smallest honest path to a system people can use.",
    bestFor: [
      "Founders with AI-assisted or contractor-built MVPs that are hard to trust.",
      "Teams with unclear deployment, data, auth, or integration boundaries.",
      "Agencies that need a reliable senior contractor to stabilize a client build.",
    ],
    deliverables: [
      "Paid discovery and technical triage",
      "Critical-path fix list",
      "Deployment, data, and integration cleanup",
      "Prototype-to-production scope",
    ],
    proof: ["Convexer", "GPTflare", "TRUTH Istanbul client work", "Liquivelte v4"],
    relatedProducts: ["convexer", "gptflare", "liquivelte-v4"],
    keywords: [
      "technical rescue for MVP",
      "AI MVP rescue",
      "fractional product engineer",
      "startup technical cleanup",
    ],
    faq: [
      {
        question: "What is technical rescue for an MVP?",
        answer:
          "Technical rescue is a focused pass on a fragile product to clarify architecture, fix the highest-risk workflows, stabilize deployment, reduce accidental complexity, and identify what should be built next.",
      },
      {
        question: "Does technical rescue always mean a rewrite?",
        answer:
          "No. A rewrite is often the most expensive answer. Technical rescue starts by finding the smallest reliable path: fix, isolate, replace, document, or rebuild only the parts that are truly blocking the product.",
      },
    ],
  },
];
