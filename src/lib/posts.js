import { getCollection } from 'astro:content';

export async function getPosts() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function readMinutes(body) {
  return Math.max(1, Math.round(body.split(/\s+/).length / 200));
}

export function fmtDate(d, locale = 'en-GB') {
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}
