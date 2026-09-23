globalThis.process ??= {}; globalThis.process.env ??= {};
import { b as createAstro, c as createComponent, m as maybeRenderHead, d as addAttribute, a as renderTemplate, f as renderScript, r as renderComponent } from '../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../chunks/Base_D6ZN1X-D.mjs';
/* empty css                                 */
import { g as getCollection } from '../chunks/_astro_content_D_8YSN97.mjs';
import { g as getPosts, f as fmtDate, r as readMinutes } from '../chunks/posts_DWy9uhym.mjs';
import { J as JOBS } from '../chunks/experience_BiPl1z5G.mjs';
export { renderers } from '../renderers.mjs';

const $$Astro = createAstro("https://malipetek.dev");
const $$Intercom = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Intercom;
  const {
    greeting,
    suggestions = [],
    email,
    availability = "limited"
  } = Astro2.props;
  const greetingAttr = greeting.replace(/\s+/g, " ").trim();
  const AVAILABILITY = {
    open: "Open to new work right now.",
    limited: "Limited availability \u2014 notes still get read.",
    closed: "Not taking new work right now \u2014 notes still get read."
  };
  const availabilityText = AVAILABILITY[availability] ?? AVAILABILITY.limited;
  return renderTemplate`${maybeRenderHead()}<section class="intercom" id="talk" data-intercom${addAttribute(greetingAttr, "data-greeting")} data-state="idle" aria-labelledby="intercom-title" data-astro-cid-lq4llses> <div class="intercom-inner" data-astro-cid-lq4llses> <div class="intercom-lead" data-astro-cid-lq4llses> <h2 class="intercom-title" id="intercom-title" data-astro-cid-lq4llses>Ring the bell.</h2> <button class="bell" type="button" data-bell aria-expanded="false" aria-controls="intercom-live" data-astro-cid-lq4llses> <svg class="bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-astro-cid-lq4llses> <path d="M6.2 9.4a5.8 5.8 0 0 1 11.6 0c0 3.6 1.2 5.1 1.9 5.9H4.3c.7-.8 1.9-2.3 1.9-5.9Z" data-astro-cid-lq4llses></path> <path d="M10.3 18.7a1.8 1.8 0 0 0 3.4 0" data-astro-cid-lq4llses></path> <path d="M12 3.6V2.4" data-astro-cid-lq4llses></path> </svg> <span class="sr-only" data-astro-cid-lq4llses>Ring the bell and start a conversation with Ali's assistant</span> </button> <p class="intercom-fallback" data-fallback data-astro-cid-lq4llses>
Rather email? <a${addAttribute(`mailto:${email}`, "href")} data-astro-cid-lq4llses>${email}</a> </p> </div> <div class="intercom-idle" data-idle data-astro-cid-lq4llses> ${suggestions.length > 0 && renderTemplate`<div class="idle-ask" data-astro-cid-lq4llses> <h3 class="idle-title" data-astro-cid-lq4llses>Things people ask</h3> <div class="idle-chips" data-astro-cid-lq4llses> ${suggestions.map((s) => renderTemplate`<button class="chat-chip" type="button" data-idle-chip data-astro-cid-lq4llses>${s}</button>`)} </div> </div>`} <p class="idle-availability" data-availability data-astro-cid-lq4llses> <span class="idle-dot" aria-hidden="true" data-astro-cid-lq4llses></span> <span data-astro-cid-lq4llses>${availabilityText}</span> </p> </div> <div class="intercom-live" id="intercom-live" data-live data-astro-cid-lq4llses> <div class="intercom-live-inner" data-astro-cid-lq4llses> <div class="chat-log" data-log role="log" aria-live="off" aria-label="Conversation with Ali's assistant" data-astro-cid-lq4llses></div> ${suggestions.length > 0 && renderTemplate`<div class="chat-suggestions" data-suggestions aria-label="Suggested questions" data-astro-cid-lq4llses> ${suggestions.map((s) => renderTemplate`<button class="chat-chip" type="button" data-chip data-astro-cid-lq4llses>${s}</button>`)} </div>`} <div class="composer" data-input data-astro-cid-lq4llses> <form class="chat-form" data-form data-astro-cid-lq4llses> <label class="sr-only" for="intercom-note" data-astro-cid-lq4llses>Message</label> <input id="intercom-note" type="text" name="note" placeholder="Write a note…" autocomplete="off" maxlength="500" data-note data-astro-cid-lq4llses> <button type="submit" class="send" data-send data-astro-cid-lq4llses>Send</button> </form> </div> <form class="handoff" data-handoff hidden data-astro-cid-lq4llses> <p class="handoff-title" data-astro-cid-lq4llses>Leave a note for Ali</p> <div class="field" data-astro-cid-lq4llses> <label for="handoff-email" data-astro-cid-lq4llses>Your email</label> <input id="handoff-email" type="email" name="email" required autocomplete="email" placeholder="you@example.com" data-handoff-email data-astro-cid-lq4llses> </div> <div class="field" data-astro-cid-lq4llses> <label for="handoff-summary" data-astro-cid-lq4llses>Anything else he should know?</label> <textarea id="handoff-summary" name="summary" rows="3" data-handoff-summary data-astro-cid-lq4llses></textarea> </div> <button type="submit" class="send send--wide" data-handoff-send data-astro-cid-lq4llses>Send to Ali</button> <p class="handoff-error" data-handoff-error hidden data-astro-cid-lq4llses></p> </form> <p class="sr-only" data-announce role="status" aria-live="polite" aria-atomic="true" data-astro-cid-lq4llses></p> </div> </div> </div> </section> ${renderScript($$result, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/components/Intercom.astro?astro&type=script&index=0&lang.ts")} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/components/Intercom.astro", void 0);

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const projects = (await getCollection("projects")).sort(
    (a, b) => a.data.order - b.data.order || (a.data.year ?? 0) - (b.data.year ?? 0)
  );
  const site = (await getCollection("site"))[0]?.data;
  const tagline = site?.tagline ?? "Full-stack developer. I build Shopify apps, small games, and the tools I wish existed.";
  const intercomGreeting = site?.intercomGreeting ?? "Ali's line. He's probably debugging something \u2014 I'm the assistant that knows his work. What are you building?";
  const intercomSuggestions = site?.intercomSuggestions ?? [];
  const email = site?.email ?? "malipetek@gmail.com";
  const availability = site?.availability ?? "limited";
  const posts = await getPosts();
  const latest = posts.slice(0, 5);
  const KIND = {
    "shopify-app": {
      label: "Shopify app",
      plural: "Shopify apps",
      color: "#95bf47"
    },
    game: { label: "Game", plural: "Games", color: "var(--orange)" },
    tool: { label: "Tool", plural: "Tools", color: "var(--ink)" },
    experiment: { label: "Experiment", plural: "Experiments", color: "#5b574f" }
  };
  const FILTERS = [
    { value: "all", label: "All" },
    { value: "shopify-app", label: "Shopify apps" },
    { value: "game", label: "Games" },
    { value: "tool", label: "Tools" },
    { value: "experiment", label: "Experiments" }
  ];
  const STATUS = {
    live: "Live",
    beta: "Beta",
    archived: "Archived",
    wip: "Work in progress"
  };
  const initial = (title) => title.replace(/^\[placeholder\]\s*/i, "").trim().charAt(0).toUpperCase();
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Muhammet Ali Petek \u2014 full-stack developer", "description": "Muhammet Ali Petek (malipetek) builds Shopify apps, small games, and the tools he wishes existed.", "current": "/", "data-astro-cid-j7pv25f6": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="masthead" data-astro-cid-j7pv25f6> <div class="masthead-inner" data-astro-cid-j7pv25f6> <h1 class="masthead-name" data-astro-cid-j7pv25f6>M. Ali<br data-astro-cid-j7pv25f6>Petek</h1> <img class="masthead-portrait" src="/me.webp" alt="Muhammet Ali Petek" width="360" height="360" loading="eager" data-astro-cid-j7pv25f6> <div class="masthead-body" data-astro-cid-j7pv25f6> <p class="masthead-lede" data-astro-cid-j7pv25f6>${tagline}</p> <div class="masthead-actions" data-astro-cid-j7pv25f6> <a class="btn" href="#shelf" data-astro-cid-j7pv25f6>See the shelf ↓</a> <a class="btn btn--solid" href="#talk" data-astro-cid-j7pv25f6>Talk to me →</a> </div> </div> </div> </section> <section class="shelf-section" id="shelf" data-astro-cid-j7pv25f6> <div class="block-head" data-astro-cid-j7pv25f6> <h2 data-astro-cid-j7pv25f6>The shelf</h2> </div> <div class="chips" role="group" aria-label="Filter projects" data-astro-cid-j7pv25f6> ${FILTERS.map((f) => renderTemplate`<button type="button" class="chip"${addAttribute(f.value, "data-filter")}${addAttribute(f.value === "all" ? "true" : "false", "aria-pressed")} data-astro-cid-j7pv25f6> ${f.label} </button>`)} </div> <ul class="shelf" data-shelf data-astro-cid-j7pv25f6> ${projects.map((p) => {
    const kind = KIND[p.data.kind];
    return renderTemplate`<li class="box"${addAttribute(p.data.kind, "data-kind")}${addAttribute(`--kind:${kind.color}`, "style")} data-astro-cid-j7pv25f6> <span class="box-band" aria-hidden="true" data-astro-cid-j7pv25f6></span> <a class="box-cover"${addAttribute(`/projects/${p.id}`, "href")} tabindex="-1" aria-hidden="true" data-astro-cid-j7pv25f6> ${p.data.cover ? renderTemplate`<img${addAttribute(p.data.cover, "src")} alt="" loading="lazy" data-astro-cid-j7pv25f6>` : renderTemplate`<span class="box-initial" data-astro-cid-j7pv25f6>${initial(p.data.title)}</span>`} </a> <div class="box-face" data-astro-cid-j7pv25f6> <a class="box-title"${addAttribute(`/projects/${p.id}`, "href")} data-astro-cid-j7pv25f6> ${p.data.title} </a> <p class="box-meta" data-astro-cid-j7pv25f6> ${kind.label} ${p.data.year ? ` \xB7 ${p.data.year}` : ""} </p> <p class="box-tagline" data-astro-cid-j7pv25f6>${p.data.tagline}</p> </div> <div class="box-foot" data-astro-cid-j7pv25f6> <p class="box-status" data-astro-cid-j7pv25f6>${STATUS[p.data.status]}</p> <div class="box-links" data-astro-cid-j7pv25f6> ${p.data.links.map((l) => renderTemplate`<a class="btn"${addAttribute(l.url, "href")} data-astro-cid-j7pv25f6> ${l.label} </a>`)} <a class="btn"${addAttribute(`/projects/${p.id}`, "href")} data-astro-cid-j7pv25f6>
Details
</a> </div> </div> </li>`;
  })} </ul> <p class="shelf-empty" data-shelf-empty hidden data-astro-cid-j7pv25f6>
Nothing on this shelf with that label.
</p> </section> <section class="block" id="writing" data-astro-cid-j7pv25f6> <div class="block-head" data-astro-cid-j7pv25f6> <h2 data-astro-cid-j7pv25f6>Writing</h2> <a href="/blog" data-astro-cid-j7pv25f6>All writing →</a> </div> <ul class="post-list" data-astro-cid-j7pv25f6> ${latest.map((p) => renderTemplate`<li data-astro-cid-j7pv25f6> <a class="post-link"${addAttribute(`/blog/${p.id}`, "href")} data-astro-cid-j7pv25f6> ${p.data.title} </a> <span class="post-meta" data-astro-cid-j7pv25f6> ${fmtDate(p.data.date)} · ${p.data.category} · ${readMinutes(p.body)}${" "}
min
</span> </li>`)} </ul> </section> <section class="block" id="work" data-astro-cid-j7pv25f6> <div class="block-head" data-astro-cid-j7pv25f6> <h2 data-astro-cid-j7pv25f6>Where I've worked</h2> <a href="/experience" data-astro-cid-j7pv25f6>Full record →</a> </div> <ol class="timeline" data-timeline data-astro-cid-j7pv25f6> ${JOBS.map((j) => renderTemplate`<li class="tl-item" data-astro-cid-j7pv25f6> <span class="tl-years" data-astro-cid-j7pv25f6>${j.years}</span> <span class="tl-rail" aria-hidden="true" data-astro-cid-j7pv25f6> <span class="tl-dot" data-astro-cid-j7pv25f6></span> </span> <button class="tl-node" type="button" aria-expanded="false"${addAttribute(j.blurb, "data-blurb")}${addAttribute(j.tags.join(" \xB7 "), "data-tags")} data-astro-cid-j7pv25f6> ${j.name} ${j.where ? renderTemplate`<span class="tl-where" data-astro-cid-j7pv25f6>${j.where}</span>` : null} </button> </li>`)} </ol> <div class="tl-readout" data-tl-readout aria-live="polite" data-astro-cid-j7pv25f6> <p class="tl-readout-blurb tl-hint" data-astro-cid-j7pv25f6>
Hover a stop, or tab through and press, to read the damage.
</p> <p class="tl-readout-tags" data-astro-cid-j7pv25f6></p> </div> </section> ${renderComponent($$result2, "Intercom", $$Intercom, { "greeting": intercomGreeting, "suggestions": intercomSuggestions, "email": email, "availability": availability, "data-astro-cid-j7pv25f6": true })} ` })} ${renderScript($$result, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/index.astro?astro&type=script&index=0&lang.ts")} `;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/index.astro", void 0);

const $$file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
