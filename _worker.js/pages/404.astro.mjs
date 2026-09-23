globalThis.process ??= {}; globalThis.process.env ??= {};
import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../chunks/Base_D6ZN1X-D.mjs';
/* empty css                               */
export { renderers } from '../renderers.mjs';

const $$404 = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Not found \u2014 malipetek", "description": "Nothing on this shelf.", "current": "/404", "data-astro-cid-zetdm5md": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="notfound" data-astro-cid-zetdm5md> <p class="notfound-code" data-astro-cid-zetdm5md>404</p> <h1 data-astro-cid-zetdm5md>Nothing on this shelf.</h1> <p class="lede" data-astro-cid-zetdm5md>
Whatever was here either never existed or got deleted to prove a point about rewriting.
</p> <p class="notfound-actions" data-astro-cid-zetdm5md> <a class="btn btn--solid" href="/" data-astro-cid-zetdm5md>← Back to the shelf</a> <a class="btn" href="/blog" data-astro-cid-zetdm5md>Read something instead</a> </p> </div> ` })} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/404.astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/404.astro";
const $$url = "/404";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$404,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
