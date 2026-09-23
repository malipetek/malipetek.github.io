globalThis.process ??= {}; globalThis.process.env ??= {};
import { c as createComponent, r as renderComponent, a as renderTemplate } from '../../chunks/astro/server_BwhXqllw.mjs';
export { renderers } from '../../renderers.mjs';

const prerender = false;
const $$KeystaticAstroPage = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Keystatic", null, { "client:only": "react", "client:component-hydration": "only", "client:component-path": "/home/runner/work/malipetek.github.io/malipetek.github.io/node_modules/.pnpm/@keystatic+astro@5.2.0_@keystatic+core@0.6.9_@keystar+ui@0.10.0_react-aria@3.50.0_react-dom@1_6jkmiibtrn5mkfwqipl2arpcza/node_modules/@keystatic/astro/internal/keystatic-page.js", "client:component-export": "Keystatic" })}`;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/node_modules/.pnpm/@keystatic+astro@5.2.0_@keystatic+core@0.6.9_@keystar+ui@0.10.0_react-aria@3.50.0_react-dom@1_6jkmiibtrn5mkfwqipl2arpcza/node_modules/@keystatic/astro/internal/keystatic-astro-page.astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/node_modules/.pnpm/@keystatic+astro@5.2.0_@keystatic+core@0.6.9_@keystar+ui@0.10.0_react-aria@3.50.0_react-dom@1_6jkmiibtrn5mkfwqipl2arpcza/node_modules/@keystatic/astro/internal/keystatic-astro-page.astro";
const $$url = undefined;

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
	__proto__: null,
	default: $$KeystaticAstroPage,
	file: $$file,
	prerender,
	url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
