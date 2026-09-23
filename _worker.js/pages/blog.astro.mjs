globalThis.process ??= {}; globalThis.process.env ??= {};
import { c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, d as addAttribute } from '../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../chunks/Base_D6ZN1X-D.mjs';
import { g as getPosts, f as fmtDate, r as readMinutes } from '../chunks/posts_DWy9uhym.mjs';
/* empty css                                 */
export { renderers } from '../renderers.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const posts = await getPosts();
  const groups = [];
  for (const post of posts) {
    const year = post.data.date.getFullYear();
    let group = groups.at(-1);
    if (!group || group.year !== year) {
      group = { year, posts: [] };
      groups.push(group);
    }
    group.posts.push(post);
  }
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Writing \u2014 malipetek", "description": "Real fixes and technical writing from the desk of malipetek.", "current": "/blog", "data-astro-cid-5tznm7mj": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<header class="page-head" data-astro-cid-5tznm7mj> <h1 data-astro-cid-5tznm7mj>Writing</h1> <p class="lede" data-astro-cid-5tznm7mj>${posts.length} entries, mostly fixes for problems I hit myself.</p> </header> <div class="years" data-astro-cid-5tznm7mj> ${groups.map((group) => renderTemplate`<section class="year-group" data-astro-cid-5tznm7mj> <h2 class="year" data-astro-cid-5tznm7mj> ${group.year} <span class="year-count" aria-hidden="true" data-astro-cid-5tznm7mj>${group.posts.length}</span> </h2> <ul class="post-list" data-astro-cid-5tznm7mj> ${group.posts.map((p) => renderTemplate`<li data-astro-cid-5tznm7mj> <a class="post-link"${addAttribute(`/blog/${p.id}`, "href")} data-astro-cid-5tznm7mj>${p.data.title}</a> ${p.data.summary && renderTemplate`<span class="post-summary" data-astro-cid-5tznm7mj>${p.data.summary}</span>`} <span class="post-meta" data-astro-cid-5tznm7mj>${fmtDate(p.data.date)} · ${p.data.category} · ${readMinutes(p.body)} min</span> </li>`)} </ul> </section>`)} </div> ` })} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/blog/index.astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/blog/index.astro";
const $$url = "/blog";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
