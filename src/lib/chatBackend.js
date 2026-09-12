/* Chat backend seam.
 * Currently a local mock ("the desk answers itself") so the correspondence
 * card works end-to-end with zero infrastructure. To wire the real bot,
 * replace reply() with a fetch to whatever endpoint we settle on —
 * the old setup was Flowise (flowise.malipetek.dev) + a Directus contact
 * flow + Turnstile; this function is the only thing that changes.
 */

const FACTS = {
  who: 'Muhammet Ali Petek — full-stack dev since 2017. Node plus whatever the project needs. I write the code, delete it, and rewrite it better.',
  stack: 'Node, Svelte/SvelteKit, Shopify (Plus, checkout.liquid, apps), Directus, Linux on the desk. Cheap and open-source by conviction.',
  svelte: 'I love Svelte. This site is Astro though — fair is fair, Astro is the better fit for a mostly-static notebook. The old site was SvelteKit.',
  shopify: 'Years of Shopify: Plus migrations, Dawn-based themes, custom apps, checkout.liquid before they took it away. See /experience for the damage.',
  linux: 'Daily drove Linux Mint for years — Cinnamon then XFCE. The blog has the scars: GPU configs, xrandr scripts, ocamlfuse mounts.',
  work: 'Customily → TRUTH NYC → PAX Digital → Bemeir. Mostly e-commerce, mostly Shopify, always the weird integration nobody else wanted.',
  hire: 'The desk is not taking new contracts right now — but notes still get read. Say what you are building and it reaches me.',
  astro: 'Second attempt at this site. The first Astro version was reverted for looking like every AI landing page ever. This one is a notebook.',
  bot: 'I am the desk copy — a local ruleset pretending to be the man until the real pipeline (Flowise + Directus + some LLM) gets wired back in.',
};

const RULES = [
  [/who|muhammet|petek|your name/i, FACTS.who],
  [/stack|tech|tools?|framework/i, FACTS.stack],
  [/svelte/i, FACTS.svelte],
  [/astro/i, FACTS.astro],
  [/shopify|e-?commerce|theme/i, FACTS.shopify],
  [/linux|mint|xfce|ubuntu|debian/i, FACTS.linux],
  [/work|experience|job|agency|career/i, FACTS.work],
  [/hire|contract|freelance|project|work with/i, FACTS.hire],
  [/bot|chat|ai|robot|flowise|who are you/i, FACTS.bot],
  [/blog|post|wrote|writing|article/i, 'Seven entries in the log so far — Linux wounds, Shopify tricks, one Svelte hydration mystery. Index is on the left page.'],
  [/hello|hi|hey|selam/i, 'Hey. You are talking to the desk copy of Muhammet — the real one is somewhere being expensive. What do you need?'],
  [/thank|thx|tesekkur/i, 'Noted. The desk appreciates the rare polite visitor.'],
  [/joke/i, 'I once deleted a working module just to prove I could rewrite it. The joke is that it worked.'],
];

const FALLBACKS = [
  'The desk copy only knows so much — try "stack", "shopify", "linux", "hire", or "who".',
  'Filed under: things to ask the real one. Meanwhile — "stack" or "experience" might cover it.',
  'No note on that in this card. "who", "work", "stack", "blog" are safe bets.',
];

export const SUGGESTIONS = ['who are you', 'your stack', 'shopify work', 'hire you'];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function reply(text /*, history */) {
  const t = text.trim();
  await delay(450 + Math.min(t.length * 18, 900)); // desk is not instant
  for (const [re, ans] of RULES) if (re.test(t)) return ans;
  return FALLBACKS[Math.abs(hash(t)) % FALLBACKS.length];
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
