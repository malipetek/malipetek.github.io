globalThis.process ??= {}; globalThis.process.env ??= {};
import { W as createComponent, a8 as renderComponent, ag as renderTemplate } from '../../chunks/astro/server_Bh8xyALw.mjs';
export { renderers } from '../../renderers.mjs';

const prerender = false;
const $$KeystaticAstroPage = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Keystatic", null, { "client:only": "react", "client:component-hydration": "only", "client:component-path": "/home/runner/work/malipetek.github.io/malipetek.github.io/node_modules/.pnpm/@keystatic+astro@5.1.0_@keystatic+core@0.5.50_@react-spectrum+provider@3.11.1_react-dom@19.2._njosf2cdxm5wdoic2xmpuerh54/node_modules/@keystatic/astro/internal/keystatic-page.js", "client:component-export": "Keystatic" })}`;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/node_modules/.pnpm/@keystatic+astro@5.1.0_@keystatic+core@0.5.50_@react-spectrum+provider@3.11.1_react-dom@19.2._njosf2cdxm5wdoic2xmpuerh54/node_modules/@keystatic/astro/internal/keystatic-astro-page.astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/node_modules/.pnpm/@keystatic+astro@5.1.0_@keystatic+core@0.5.50_@react-spectrum+provider@3.11.1_react-dom@19.2._njosf2cdxm5wdoic2xmpuerh54/node_modules/@keystatic/astro/internal/keystatic-astro-page.astro";
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
