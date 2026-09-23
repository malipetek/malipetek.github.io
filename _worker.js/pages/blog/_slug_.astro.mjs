globalThis.process ??= {}; globalThis.process.env ??= {};
import { b as createAstro, c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, d as addAttribute } from '../../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../../chunks/Base_D6ZN1X-D.mjs';
import { g as getPosts, f as fmtDate, r as readMinutes } from '../../chunks/posts_DWy9uhym.mjs';
import { r as renderEntry } from '../../chunks/_astro_content_D_8YSN97.mjs';
/* empty css                                     */
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro("https://malipetek.dev");
async function getStaticPaths() {
  const posts = await getPosts();
  return posts.map((post, i) => ({
    params: { slug: post.id },
    props: { post, prev: posts[i + 1], next: posts[i - 1] }
  }));
}
const $$slug = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$slug;
  const { post, prev, next } = Astro2.props;
  const { Content } = await renderEntry(post);
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": `${post.data.title} \u2014 malipetek`, "description": post.data.summary, "current": "/blog", "type": "article", "data-astro-cid-4sn4zg3r": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<article class="entry" data-astro-cid-4sn4zg3r> <header class="entry-head" data-astro-cid-4sn4zg3r> <p class="post-meta" data-astro-cid-4sn4zg3r>${fmtDate(post.data.date)} · ${post.data.category} · ${readMinutes(post.body)} min</p> <h1 data-astro-cid-4sn4zg3r>${post.data.title}</h1> ${post.data.summary && renderTemplate`<p class="entry-lede" data-astro-cid-4sn4zg3r>${post.data.summary}</p>`} </header> <div class="prose" data-astro-cid-4sn4zg3r> ${renderComponent($$result2, "Content", Content, { "data-astro-cid-4sn4zg3r": true })} </div> <nav class="entry-nav" aria-label="More writing" data-astro-cid-4sn4zg3r> ${prev && renderTemplate`<a${addAttribute(`/blog/${prev.id}`, "href")} data-astro-cid-4sn4zg3r>← ${prev.data.title}</a>`} ${next && renderTemplate`<a class="entry-next"${addAttribute(`/blog/${next.id}`, "href")} data-astro-cid-4sn4zg3r>${next.data.title} →</a>`} </nav> </article> ` })} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/blog/[slug].astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/blog/[slug].astro";
const $$url = "/blog/[slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$slug,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
