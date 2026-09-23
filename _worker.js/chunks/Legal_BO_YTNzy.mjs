globalThis.process ??= {}; globalThis.process.env ??= {};
import { b as createAstro, c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, e as renderSlot } from './astro/server_BwhXqllw.mjs';
import { $ as $$Base } from './Base_D6ZN1X-D.mjs';

const $$Astro = createAstro("https://malipetek.dev");
const $$Legal = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Legal;
  const { frontmatter = {} } = Astro2.props;
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": frontmatter.title ? `${frontmatter.title} \u2014 malipetek` : "malipetek", "description": frontmatter.description, "current": frontmatter.current }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<article class="prose legal"> ${renderSlot($$result2, $$slots["default"])} </article> ` })}`;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/layouts/Legal.astro", void 0);

export { $$Legal as $ };
