# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (user's choice after a reverted attempt — the revert was about design quality, not the stack). Static build deployed to GitHub Pages at malipetek.dev (CNAME). No server runtime; all dynamic behavior is client-side or hits external services.

## Users

Peers and readers from the dev community (Linux, Shopify, Svelte, web-platform topics), plus curious visitors and potential collaborators who stumble onto the site. This is a personal home on the web, not a funnel.

## Product Purpose

Muhammet Ali Petek's personal site: a showcase of who he is and what he's built, plus a blog of real fixes and technical writing. Success is a visitor thinking "this person actually builds things" and enjoying the writing — not converting.

## Positioning

The site is the portfolio. Its craft and personality are themselves the demonstration. Voice is dry, self-aware, slightly absurd ("I sometimes just delete the modules I wrote to prove myself I can rewrite the thing", "Your favorite full stack JS developer"). Content is real solved problems, not thought-leadership.

## Capabilities and Constraints

- Blog: ~7 existing real posts to migrate (Shopify/Partytown, several Linux Mint fixes, Svelte hydration, CSS toggleables). Markdown-authored, code-heavy.
- AI chatbot: required feature. Backend intentionally undecided — an existing Flowise instance (flowise.malipetek.dev) + Directus contact flow + Turnstile exists and works, but the user wants to rethink it after approving the design. Sketch uses a mock/local responder.
- Experience timeline data exists (Customily, TRUTH NYC, PAX Digital, Bemeir LLC).
- Legal/utility pages exist (privacy-policy, terms-of-service, pdfextractor/*) and must keep working.
- Static hosting: no server endpoints of its own.
- HARD CONSTRAINT: must not look like generic AI output. Previous attempt was reverted as "AI slop — too generic" (gradient hero, cookie-cutter sections, no personality).

## Brand Commitments

Name: Muhammet Ali Petek / malipetek. Portrait: /me.webp. GitHub: github.com/malipetek. Confirmed loves: Svelte/SvelteKit, Directus, simple & cheap open-source tools. Self-deprecating humor is on-brand; marketing-speak is off-brand.

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
