globalThis.process ??= {}; globalThis.process.env ??= {};
import { g as getCollection } from './_astro_content_D_8YSN97.mjs';

async function getPosts() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

function readMinutes(body) {
  return Math.max(1, Math.round(body.split(/\s+/).length / 200));
}

function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export { fmtDate as f, getPosts as g, readMinutes as r };
