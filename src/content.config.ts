import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    category: z.string(),
    date: z.coerce.date(),
    summary: z.string().optional(),
    draft: z.boolean().optional().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdoc', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    kind: z.enum(['shopify-app', 'game', 'tool', 'experiment']),
    tagline: z.string().max(90),
    status: z.enum(['live', 'beta', 'archived', 'wip']),
    cover: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    year: z.number().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const site = defineCollection({
  loader: glob({ pattern: 'site.yaml', base: './src/content' }),
  schema: z.object({
    tagline: z.string(),
    intercomGreeting: z.string(),
    intercomSuggestions: z.array(z.string()).default([]),
    email: z.string(),
    github: z.string(),
    availability: z.enum(['open', 'limited', 'closed']),
  }),
});

export const collections = { blog, projects, site };
