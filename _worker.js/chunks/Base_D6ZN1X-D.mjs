globalThis.process ??= {}; globalThis.process.env ??= {};
import { b as createAstro, c as createComponent, d as addAttribute, n as renderHead, a as renderTemplate, e as renderSlot } from './astro/server_BwhXqllw.mjs';
/* empty css                                  */

const $$Astro = createAstro("https://malipetek.dev");
const $$Base = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Base;
  const {
    title = "M. Ali Petek",
    description = "M. Ali Petek builds Shopify apps, small games, and the tools he wishes existed.",
    current = Astro2.url.pathname,
    type = "website",
    image = "/me.webp",
    imageAlt = "Muhammet Ali Petek"
  } = Astro2.props;
  const canonical = new URL(Astro2.url.pathname, Astro2.site);
  const ogImage = new URL(image, Astro2.site);
  const nav = [
    { href: "/", label: "Shelf" },
    { href: "/blog", label: "Writing" },
    { href: "/experience", label: "Work" },
    { href: "/#talk", label: "Talk" }
  ];
  const isCurrent = (href) => href === "/" ? current === "/" : current.startsWith(href);
  return renderTemplate`<html lang="en" data-astro-cid-5hce7sga> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description"${addAttribute(description, "content")}><meta name="theme-color" content="#efebe3"><link rel="canonical"${addAttribute(canonical.href, "href")}><meta property="og:type"${addAttribute(type, "content")}><meta property="og:site_name" content="M. Ali Petek"><meta property="og:locale" content="en"><meta property="og:title"${addAttribute(title, "content")}><meta property="og:description"${addAttribute(description, "content")}><meta property="og:url"${addAttribute(canonical.href, "content")}><meta property="og:image"${addAttribute(ogImage.href, "content")}><meta property="og:image:alt"${addAttribute(imageAlt, "content")}><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title"${addAttribute(title, "content")}><meta name="twitter:description"${addAttribute(description, "content")}><meta name="twitter:image"${addAttribute(ogImage.href, "content")}><link rel="icon" href="/me.webp"><link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/source-serif-4-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="sitemap" href="/sitemap-index.xml">${renderHead()}</head> <body data-astro-cid-5hce7sga> <a class="skip-link" href="#main" data-astro-cid-5hce7sga>Skip to content</a> <header class="site-head" data-astro-cid-5hce7sga> <div class="wrap site-head-inner" data-astro-cid-5hce7sga> <a class="wordmark" href="/" data-astro-cid-5hce7sga>malipetek</a> <nav class="site-nav" aria-label="Primary" data-astro-cid-5hce7sga> ${nav.map((item) => renderTemplate`<a${addAttribute(item.href, "href")}${addAttribute(isCurrent(item.href) ? "page" : void 0, "aria-current")} data-astro-cid-5hce7sga> ${item.label} </a>`)} </nav> </div> </header> <main id="main" class="wrap" data-astro-cid-5hce7sga> ${renderSlot($$result, $$slots["default"])} </main> <footer class="site-foot" data-astro-cid-5hce7sga> <div class="wrap site-foot-inner" data-astro-cid-5hce7sga> <a href="mailto:malipetek@gmail.com" data-astro-cid-5hce7sga>malipetek@gmail.com</a> <a href="https://github.com/malipetek" data-astro-cid-5hce7sga>github.com/malipetek</a> <span data-astro-cid-5hce7sga>Built with Astro, hosted on Cloudflare</span> </div> </footer> </body></html>`;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/layouts/Base.astro", void 0);

export { $$Base as $ };
