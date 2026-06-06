import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    category: z.enum(["linux", "shopify", "svelte", "web"]),
    description: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    keywords: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
  }),
});

export const collections = {
  blog,
};
