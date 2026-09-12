import { getCollection } from 'astro:content';

export async function getPosts() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export const CATEGORY_META = {
  linux: { tab: 'tab-sage', note: 'desktop wounds, self-inflicted' },
  shopify: { tab: 'tab-blue', note: 'theme work for money' },
  svelte: { tab: 'tab-rose', note: 'the good framework' },
  web: { tab: 'tab-manila', note: 'platform tricks' },
};

export function entryNumber(i) {
  return String(i + 1).padStart(3, '0');
}

export function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}
