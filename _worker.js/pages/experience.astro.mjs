globalThis.process ??= {}; globalThis.process.env ??= {};
import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, d as addAttribute } from '../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../chunks/Base_D6ZN1X-D.mjs';
import { J as JOBS } from '../chunks/experience_BiPl1z5G.mjs';
/* empty css                                      */
export { renderers } from '../renderers.mjs';

const $$Experience = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Work \u2014 malipetek", "description": "Where the time went, 2017 to present.", "current": "/experience", "data-astro-cid-ajxctdaq": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<header class="page-head" data-astro-cid-ajxctdaq> <h1 data-astro-cid-ajxctdaq>Work</h1> <p class="lede" data-astro-cid-ajxctdaq>2017 to present. Every row is real; the gaps are called burnout and hiking.</p> </header> <ol class="jobs" data-astro-cid-ajxctdaq> ${JOBS.map((j) => renderTemplate`<li class="job" data-astro-cid-ajxctdaq> <p class="job-years" data-astro-cid-ajxctdaq>${j.years}</p> <div class="job-main" data-astro-cid-ajxctdaq> <h2 class="job-name" data-astro-cid-ajxctdaq>${j.link ? renderTemplate`<a${addAttribute(j.link, "href")} data-astro-cid-ajxctdaq>${j.name}</a>` : j.name}</h2> <p class="job-where" data-astro-cid-ajxctdaq>${j.where}</p> <p class="job-blurb" data-astro-cid-ajxctdaq>${j.blurb}</p> <p class="job-tags" data-astro-cid-ajxctdaq>${j.tags.join(" \xB7 ")}</p> </div> </li>`)} </ol> <p class="muted jobs-note" data-astro-cid-ajxctdaq>
Agencies billed, specifics under NDA. The long TRUTH note lives at
<a href="/experience/truth" data-astro-cid-ajxctdaq>TRUTH NYC</a>.
</p> ` })} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/experience.astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/experience.astro";
const $$url = "/experience";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Experience,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
