import { getCollection, type CollectionEntry } from "astro:content";

export const blogCategories = [
  {
    key: "linux",
    title: "Linux",
    description: "Linux troubleshooting, shell, and desktop workflows.",
  },
  {
    key: "shopify",
    title: "Shopify",
    description: "Shopify theme, app, and storefront implementation notes.",
  },
  {
    key: "svelte",
    title: "Svelte",
    description: "Svelte implementation notes and framework debugging.",
  },
  {
    key: "web",
    title: "Web",
    description: "Practical browser, CSS, and frontend notes.",
  },
] as const;

export type BlogCategory = (typeof blogCategories)[number];

export type BlogPost = {
  category: BlogCategory["key"];
  slug: string;
  title: string;
  description?: string;
  entry: CollectionEntry<"blog">;
};

const categoryOrder = new Map(
  blogCategories.map((category, index) => [category.key, index])
);

const legacyPostOrder = new Map(
  [
    "linux/convert-bash-scripts-into-named-cli-commands-in-linux",
    "linux/how-i-solved-chrome-gpu-issue-on-my-linux-mint",
    "linux/ubuntu-accessing-google-drive-from-nautilus",
    "linux/linux-mint-xfce-how-i-made-vga-display-configuration-persist",
    "shopify/how-to-partytown",
    "svelte/why-my-image-is-not-hydrating-right",
    "web/css-only-toggleables",
  ].map((slug, index) => [slug, index])
);

export function getBlogCategory(categoryKey: string) {
  return blogCategories.find((category) => category.key === categoryKey);
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  const entries = await getCollection("blog");

  return entries
    .map((entry) => {
      return {
        category: entry.data.category,
        slug: entry.slug,
        title: entry.data.title,
        description: entry.data.description || undefined,
        entry,
      };
    })
    .filter((post) => getBlogCategory(post.category) && post.slug)
    .sort(sortBlogPosts);
}

export async function getBlogCategoryPosts(categoryKey: string) {
  const posts = await getBlogPosts();
  return posts.filter((post) => post.category === categoryKey);
}

function sortBlogPosts(a: BlogPost, b: BlogPost) {
  const categoryDelta =
    (categoryOrder.get(a.category) ?? 999) -
    (categoryOrder.get(b.category) ?? 999);

  if (categoryDelta !== 0) return categoryDelta;

  const aLegacyOrder = legacyPostOrder.get(`${a.category}/${a.slug}`);
  const bLegacyOrder = legacyPostOrder.get(`${b.category}/${b.slug}`);

  if (aLegacyOrder !== undefined || bLegacyOrder !== undefined) {
    return (aLegacyOrder ?? 999) - (bLegacyOrder ?? 999);
  }

  return a.title.localeCompare(b.title);
}

export const compatibilityMap = {
  "linux/How I Solved Chrome GPU Issue On My Linux Mint":
    "/blog/linux/how-i-solved-chrome-gpu-issue-on-my-linux-mint",
  "linux/Convert Bash Scripts Into Named CLI Commands in Linux":
    "/blog/linux/convert-bash-scripts-into-named-cli-commands-in-linux",
  "linux/Ubuntu Accessing Google Drive from Nautilus":
    "/blog/linux/ubuntu-accessing-google-drive-from-nautilus",
  "linux/Linux Mint XFCE How I made VGA display configuration persist":
    "/blog/linux/linux-mint-xfce-how-i-made-vga-display-configuration-persist",
  "web/CSS only toggleables": "/blog/web/css-only-toggleables",
  "shopify/how-to-partytown": "/blog/shopify/how-to-partytown",
  "svelte/why-my-image-is-not-hydrating-right":
    "/blog/svelte/why-my-image-is-not-hydrating-right",
};
