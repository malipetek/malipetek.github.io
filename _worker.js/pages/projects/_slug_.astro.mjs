globalThis.process ??= {}; globalThis.process.env ??= {};
import { b as createAstro, c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, d as addAttribute } from '../../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../../chunks/Base_D6ZN1X-D.mjs';
import { r as renderEntry, g as getCollection } from '../../chunks/_astro_content_D_8YSN97.mjs';
/* empty css                                     */
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro("https://malipetek.dev");
async function getStaticPaths() {
  const projects = await getCollection("projects");
  return projects.map((project) => ({
    params: { slug: project.id },
    props: { project }
  }));
}
const $$slug = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$slug;
  const { project } = Astro2.props;
  const { Content } = await renderEntry(project);
  const KIND = {
    "shopify-app": "Shopify app",
    game: "Game",
    tool: "Tool",
    experiment: "Experiment"
  };
  const STATUS = { live: "Live", beta: "Beta", archived: "Archived", wip: "Work in progress" };
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": `${project.data.title} \u2014 malipetek`, "description": project.data.tagline, "current": "/projects", "data-astro-cid-ovxcmftc": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<article class="project" data-astro-cid-ovxcmftc> <p class="project-back" data-astro-cid-ovxcmftc><a href="/#shelf" data-astro-cid-ovxcmftc>← Back to the shelf</a></p> <header class="project-head" data-astro-cid-ovxcmftc> <p class="project-meta" data-astro-cid-ovxcmftc> ${KIND[project.data.kind]} ${project.data.year ? ` \xB7 ${project.data.year}` : ""} · ${STATUS[project.data.status]} </p> <h1 data-astro-cid-ovxcmftc>${project.data.title}</h1> <p class="lede" data-astro-cid-ovxcmftc>${project.data.tagline}</p> ${project.data.links.length > 0 && renderTemplate`<div class="project-links" data-astro-cid-ovxcmftc> ${project.data.links.map((l) => renderTemplate`<a class="btn"${addAttribute(l.url, "href")} data-astro-cid-ovxcmftc>${l.label}</a>`)} </div>`} </header> ${project.data.cover ? renderTemplate`<img class="project-cover"${addAttribute(project.data.cover, "src")}${addAttribute(`${project.data.title} cover`, "alt")} data-astro-cid-ovxcmftc>` : renderTemplate`<div class="project-cover project-cover--empty" aria-hidden="true" data-astro-cid-ovxcmftc> <span data-astro-cid-ovxcmftc>${project.data.title.replace(/^\[placeholder\]\s*/i, "").trim().charAt(0).toUpperCase()}</span> </div>`} <div class="prose project-body" data-astro-cid-ovxcmftc> ${renderComponent($$result2, "Content", Content, { "data-astro-cid-ovxcmftc": true })} </div> </article> ` })} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/projects/[slug].astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/projects/[slug].astro";
const $$url = "/projects/[slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$slug,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
