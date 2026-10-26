# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (user's choice after a reverted attempt — the revert was about design quality, not the stack). Static build deployed to GitHub Pages at malipetek.dev (CNAME). No server runtime; all dynamic behavior is client-side or hits external services.

## Users


Business owners who need software work done and do not want to manage a development team: a fix, a feature, a small tool, an integration. Not specifically Shopify merchants. Peers and readers from the dev community still come for the blog; they are the second audience now, not the first.

## Product Purpose


Muhammet Ali Petek's site, and the front door of his one-person contracting service. A visitor should understand in one glance what is on offer: self-serve software work, built by an AI agent, approved before and reviewed after by Ali. Success is a business owner opening a ticket. The shelf, the blog and the work record are the proof that a real developer is behind it.

## Positioning


Self-serve software contracting: human-approved, agent-built. The client sends a request (portal, email or chat), Ali approves it, an AI agent builds it in a sealed copy of the project, Ali checks it before anything ships, as closely as the client asked. Price is metered, not tiered: Ali's measured time at $100/hour, billed by the second, plus the AI run at cost with no markup (`src/lib/pricing.js`). The client picks an attention level (Autopilot, Checked, Hands-on) and may set a budget; a job the agent finishes nearly unattended costs a minute or two of time. What gets built runs serverless, so there are no servers to patch or resize. The canonical wording lives in `src/lib/offer.js`.

Voice stays dry, self-aware, plain. The honest framing is the selling point: "the agent types, I decide". Never "AI-powered", never "revolutionary", no invented prices or results. Written for business owners, so no jargon the reader has to look up.

## Capabilities and Constraints

- Blog: ~7 existing real posts to migrate (Shopify/Partytown, several Linux Mint fixes, Svelte hydration, CSS toggleables). Markdown-authored, code-heavy.
- AI chatbot: required feature. Backend intentionally undecided — an existing Flowise instance (flowise.malipetek.dev) + Directus contact flow + Turnstile exists and works, but the user wants to rethink it after approving the design. Sketch uses a mock/local responder.
- Experience timeline data exists (Customily, TRUTH NYC, PAX Digital, Bemeir LLC).
- Legal/utility pages exist (privacy-policy, terms-of-service, pdfextractor/*) and must keep working.
- Static hosting: no server endpoints of its own.
- HARD CONSTRAINT: must not look like generic AI output. Previous attempt was reverted as "AI slop — too generic" (gradient hero, cookie-cutter sections, no personality).

## Brand Commitments


Name: Muhammet Ali Petek / malipetek. Portrait: /me.webp. GitHub: github.com/malipetek. Works serverless-first and keeps tools simple and cheap. The earlier Svelte-centred stack story is retired: do not lead with frameworks. Self-deprecating humor is on-brand; marketing-speak is off-brand.

## Evidence on Hand

Real blog posts in `src/routes/blog/**`, real experience entries, `static/me.webp` portrait, assorted real screenshots (gpt_exp.jpg, attributes.jpg, debugger.jpg, link-comparison.jpg). No testimonials — do not fabricate.

## Product Principles

- Personality is the feature; template polish is the enemy.
- Content leads, chrome recedes — the site should feel hand-made, not generated.
- Cheap, simple, open-source ethos applies to the site itself.
- Prove, don't claim: show real work, real posts, real stack.

## Direction history (brand commitment)

- v1: "The Field Notebook" (seed 09a1ce4b) — REJECTED by user after build: too hard to read, too much wasted space. Do not re-propose paper/notebook/handwriting surfaces.
- v2: "The Spec Sheet" (seed 4cba959f, reroll 1, safer register) — CHOSEN. Dense technical-document world: ruled tables, numbered sections, doc header block, cobalt links only. User preference recorded: readable, information-dense, no decorative chrome.
