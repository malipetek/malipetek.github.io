export type Project = {
  slug: string;
  title: string;
  status: string;
  type: "software" | "service" | "platform" | "tool";
  outcome: string;
  problem: string;
  built: string;
  stack: string[];
  judgment: string;
  tags: string[];
  diagram: string[];
  cta: {
    label: string;
    href: string;
    note: string;
  };
  searchIntent: string[];
  faq: {
    question: string;
    answer: string;
  }[];
};

export const projects: Project[] = [
  {
    slug: "convexer",
    title: "Convexer",
    status: "Prototype / infrastructure product",
    type: "tool",
    outcome:
      "A self-hosted control plane for running multiple Convex app backends on one VPS.",
    problem:
      "Convex is fast to build with, but running many app bundles privately needs lifecycle, routing, database, backup, and rollback discipline.",
    built:
      "Instance lifecycle flows, Docker services, Traefik routing, PostgreSQL browsing/backups, Better Auth sidecars, health checks, image updates, operational dashboards, and Playwright coverage.",
    stack: [
      "TypeScript",
      "Node.js",
      "Docker",
      "Traefik",
      "PostgreSQL",
      "Better Auth",
      "Playwright",
    ],
    judgment:
      "Keeps the platform cheap and inspectable while adding the boring pieces that make the system usable after the demo.",
    tags: ["Convex", "Infra", "Self-hosted", "Developer tools"],
    diagram: ["App bundles", "Convex services", "Traefik + Docker", "PostgreSQL + backups"],
    cta: {
      label: "Request demo",
      href: "/chat?intent=convexer-demo",
      note: "Best for teams evaluating self-hosted Convex or private backend orchestration.",
    },
    searchIntent: [
      "self-hosted Convex control plane",
      "Convex deployment management",
      "Docker backend orchestration for Convex apps",
    ],
    faq: [
      {
        question: "What is Convexer?",
        answer:
          "Convexer is a self-hosted control plane for managing multiple Convex app backends on one VPS, including Docker services, routing, PostgreSQL, auth sidecars, backups, and rollback-oriented operations.",
      },
      {
        question: "Who is Convexer for?",
        answer:
          "Convexer is for builders and small teams who want Convex-style development speed with more control over hosting, operational visibility, backups, and infrastructure cost.",
      },
    ],
  },
  {
    slug: "gptflare",
    title: "GPTflare / Platform Control Plane",
    status: "Experimental platform",
    type: "platform",
    outcome:
      "A Cloudflare Worker control plane for AI-generated static sites backed by GitHub and Cloudflare.",
    problem:
      "AI site generation is easy to demo and hard to operate: tenants, previews, domains, GitHub repos, editor access, and production approvals all need a real system.",
    built:
      "D1 records for accounts, drafts, sites, credentials, domains, and entitlements; GitHub repo provisioning; Astro + Keystatic template seeding; Workers Builds; preview-to-production approvals; editor routing; and Custom GPT setup surfaces.",
    stack: [
      "Cloudflare Workers",
      "D1",
      "KV",
      "GitHub API",
      "Astro",
      "Keystatic",
      "Wrangler",
    ],
    judgment:
      "Turns an AI demo into a maintainable workflow with clear ownership, preview gates, and deployable tenant artifacts.",
    tags: ["AI", "Cloudflare", "GitHub", "Astro"],
    diagram: ["Custom GPT", "Worker control plane", "GitHub repos", "Preview + production"],
    cta: {
      label: "Build your site now",
      href: "/chat?intent=gptflare-site",
      note: "Start with a paid scope pass for an AI-assisted site workflow or Cloudflare/GitHub control plane.",
    },
    searchIntent: [
      "AI static site builder",
      "Cloudflare Worker site generator",
      "Custom GPT website builder",
      "GitHub backed CMS with Astro and Keystatic",
    ],
    faq: [
      {
        question: "What does GPTflare do?",
        answer:
          "GPTflare is a Cloudflare and GitHub control plane for AI-generated static sites. It handles tenant records, drafts, previews, GitHub repositories, Astro/Keystatic templates, deployment, and production approval flow.",
      },
      {
        question: "Is GPTflare just a prompt wrapper?",
        answer:
          "No. The value is the operational layer after generation: site records, repository provisioning, preview gates, editor routing, domain flow, and deployable production output.",
      },
    ],
  },
  {
    slug: "tapu-rental-management",
    title: "TAPU Rental Management",
    status: "Private product prototype",
    type: "software",
    outcome:
      "An iOS + Convex rental and asset management product with real-time operational workflows.",
    problem:
      "Rental/service workflows need more than listings: approvals, provider steps, chat context, notifications, process state, and mobile-first execution.",
    built:
      "SwiftUI app flows, Convex backend logic, real-time subscriptions, marketplace and service-provider flows, process actions, approval workflows, chat archive behavior, process reference cards, push notifications, and WhatsApp integration work.",
    stack: [
      "SwiftUI",
      "Convex",
      "Convex Swift SDK",
      "Better Auth",
      "TypeScript",
      "OpenAI",
      "WhatsApp",
    ],
    judgment:
      "Models the workflow as a living product system instead of a static CRUD app.",
    tags: ["SwiftUI", "Convex", "Mobile", "Workflow"],
    diagram: ["iOS app", "Convex realtime", "Process approvals", "Messages + notifications"],
    cta: {
      label: "Discuss a prototype",
      href: "/chat?intent=swiftui-convex-prototype",
      note: "Useful if you need a real mobile workflow with backend state, approvals, and messaging.",
    },
    searchIntent: [
      "SwiftUI Convex prototype",
      "rental management app development",
      "real-time mobile workflow app",
    ],
    faq: [
      {
        question: "What kind of product is TAPU?",
        answer:
          "TAPU is a private iOS and Convex rental management prototype focused on process state, provider flows, approvals, real-time updates, messaging, and notifications.",
      },
      {
        question: "What does TAPU prove?",
        answer:
          "TAPU proves end-to-end mobile product engineering: SwiftUI interface, Convex backend logic, workflow modeling, push notifications, agent messaging, and integration work.",
      },
    ],
  },
  {
    slug: "uygulamali-felsefe",
    title: "Uygulamali Felsefe Publishing Platform",
    status: "Live publishing system",
    type: "platform",
    outcome:
      "A multilingual Astro + Keystatic publishing platform deployed through Cloudflare.",
    problem:
      "A serious publishing organization needed multilingual content, catalog pages, translation-aware routes, PDF downloads, and an editor workflow that non-developers could actually use.",
    built:
      "Astro content models, Keystatic/GitHub-backed editing, locale routing, article/page/catalog collections, SEO fields, PDF download flows, language switcher fixes, Cloudflare Pages/Workers SSR, and production editor routing.",
    stack: ["Astro", "Keystatic", "MDX", "Cloudflare Pages", "Workers", "GitHub App"],
    judgment:
      "Uses Git-backed publishing where it helps, while keeping the public site fast and maintainable.",
    tags: ["Publishing", "Astro", "Cloudflare", "Content"],
    diagram: ["Editors", "Keystatic + GitHub", "Astro content", "Cloudflare deployment"],
    cta: {
      label: "Scope a publishing system",
      href: "/services/svelte-astro-product-development",
      note: "For editorial teams, catalogs, multilingual sites, and Git-backed content workflows.",
    },
    searchIntent: [
      "Astro Keystatic publishing platform",
      "multilingual publishing system",
      "Cloudflare Pages editorial CMS",
    ],
    faq: [
      {
        question: "What is the Uygulamali Felsefe platform?",
        answer:
          "It is a multilingual Astro and Keystatic publishing system with GitHub-backed editing, article and catalog content models, locale routing, PDF downloads, and Cloudflare deployment.",
      },
      {
        question: "Why use Astro and Keystatic for publishing?",
        answer:
          "Astro keeps the public site fast and static-friendly, while Keystatic gives editors a structured Git-backed workflow without turning the site into a heavy CMS deployment.",
      },
    ],
  },
  {
    slug: "deepturkishnews3",
    title: "DeepTurkishNews3",
    status: "Experimental media platform",
    type: "platform",
    outcome:
      "An AI-assisted Turkish news platform with Astro frontend, Convex backend, dashboards, studio components, and publishing workflows.",
    problem:
      "AI-assisted news work needs editorial surfaces, backend state, deployment flow, streaming reliability, and publishing infrastructure that can be iterated quickly.",
    built:
      "Astro site, Convex backend, Cloudflare deployment, dashboard/studio components, content workflows, WebSocket/FFmpeg streaming reliability work, EBML/WebM restart handling, broadcaster flows, and operational deployment tooling.",
    stack: ["Astro", "Convex", "TypeScript", "Cloudflare", "FFmpeg", "WebSocket"],
    judgment:
      "Treats media generation, editorial control, and deployment as one product workflow.",
    tags: ["AI", "Publishing", "Convex", "Streaming"],
    diagram: ["Studio", "Convex backend", "Astro site", "Cloudflare publish"],
    cta: {
      label: "Explore media workflows",
      href: "/chat?intent=ai-publishing-workflow",
      note: "For AI-assisted publishing, editorial dashboards, and operational media workflows.",
    },
    searchIntent: [
      "AI news publishing platform",
      "Convex publishing dashboard",
      "Astro media workflow",
    ],
    faq: [
      {
        question: "What is DeepTurkishNews3?",
        answer:
          "DeepTurkishNews3 is an AI-assisted news and media platform with an Astro site, Convex backend, dashboard and studio components, Cloudflare deployment, and publishing workflows.",
      },
      {
        question: "What problem does DeepTurkishNews3 solve?",
        answer:
          "It explores how AI-generated or AI-assisted media can still have editorial workflow, backend state, operational dashboards, streaming reliability, and controlled publishing.",
      },
    ],
  },
  {
    slug: "liquivelte-v4",
    title: "Liquivelte v4",
    status: "Open-source compiler experiment",
    type: "tool",
    outcome:
      "A compiler path for Shopify Liquid SSR with Svelte hydration from `.liquivelte` files.",
    problem:
      "Shopify themes need Liquid to remain the runtime source of truth, but modern component authoring and hydration still matter.",
    built:
      "Tokenizer, parser, scope and expression modules, runtime helpers, Vite plugin, fixtures, Vitest contract tests, and Liquid/Svelte hydration rules around loops, scope, component boundaries, and trace data.",
    stack: ["TypeScript", "Svelte", "Liquid", "Vite", "Vitest", "Shopify"],
    judgment:
      "Keeps Shopify/e-commerce as a technical rescue lane while showing compiler-level product engineering beyond theme work.",
    tags: ["Svelte", "Compiler", "Shopify", "Open source"],
    diagram: ["Liquid source", "Compiler passes", "Svelte hydration", "Theme runtime"],
    cta: {
      label: "Try compiler direction",
      href: "/services/shopify-app-integration-development",
      note: "For Shopify app, theme, Liquid, and Svelte integration work where a normal theme edit is not enough.",
    },
    searchIntent: [
      "Svelte Shopify Liquid compiler",
      "Shopify Liquid hydration",
      "Svelte Shopify theme tooling",
    ],
    faq: [
      {
        question: "What is Liquivelte v4?",
        answer:
          "Liquivelte v4 is a compiler experiment for Shopify themes that keeps Liquid as the SSR runtime while generating Svelte hydration code from `.liquivelte` files.",
      },
      {
        question: "Is Liquivelte only Shopify theme work?",
        answer:
          "No. It is compiler and runtime design applied to Shopify constraints: parsing, scoping, expression handling, hydration boundaries, fixtures, and contract tests.",
      },
    ],
  },
  {
    slug: "shopify-workflow-app",
    title: "Shopify Workflow App",
    status: "Upcoming Shopify app",
    type: "software",
    outcome:
      "A focused Shopify app lane for storefront, catalog, workflow, and integration problems that need a product, not one-off theme patches.",
    problem:
      "Many Shopify teams have recurring workflow pain hidden inside theme edits, spreadsheets, admin workarounds, and brittle app stacks.",
    built:
      "The app lane is being shaped from years of Shopify Plus, Liquid, custom app, migration, catalog, wholesale, and workflow rescue work.",
    stack: ["Shopify", "Liquid", "Node.js", "Webhooks", "Polaris", "Cloudflare"],
    judgment:
      "Keeps Shopify in the lower technical rescue lane while turning repeat problems into installable product surfaces.",
    tags: ["Shopify", "E-commerce", "App", "Integrations"],
    diagram: ["Storefront/admin pain", "App workflow", "Webhooks + data", "Repeatable install"],
    cta: {
      label: "Request install link",
      href: "/chat?intent=shopify-app-install",
      note: "Not a fake live install button: request access or ask about the first app/service fit.",
    },
    searchIntent: [
      "Shopify custom workflow app",
      "Shopify integration rescue",
      "Shopify app development for catalog workflows",
    ],
    faq: [
      {
        question: "What kind of Shopify app is planned?",
        answer:
          "The Shopify app lane is for recurring workflow and integration problems: catalog handling, storefront/admin friction, wholesale logic, data cleanup, and operational glue that should become an installable product.",
      },
      {
        question: "Can Muhammet build private Shopify apps too?",
        answer:
          "Yes. Shopify remains a technical rescue and integration lane, especially when a private app, webhook workflow, migration, or admin surface is more appropriate than another theme patch.",
      },
    ],
  },
];

export const products = projects;
export const featuredProducts = products.slice(0, 6);
export const featuredProjects = featuredProducts;
