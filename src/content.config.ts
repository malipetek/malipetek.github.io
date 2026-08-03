import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    category: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    keywords: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
  }),
});

export const collections = {
  blog,
};
