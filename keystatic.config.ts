import { collection, config, fields, singleton } from '@keystatic/core';

export default config({
  storage: {
    // Edits commit straight to the repo. Local dev still works — Keystatic
    // falls back to local mode when the OAuth env vars aren't set.
    kind: 'github',
    repo: 'malipetek/malipetek.github.io',
  },
  collections: {
    projects: collection({
      label: 'Projects',
      slugField: 'title',
      path: 'src/content/projects/*',
      format: { contentField: 'body' },
      entryLayout: 'content',
      columns: ['title', 'kind', 'status'],
      schema: {
        title: fields.slug({
          name: { label: 'Title' },
        }),
        kind: fields.select({
          label: 'Kind',
          options: [
            { label: 'Shopify app', value: 'shopify-app' },
            { label: 'Game', value: 'game' },
            { label: 'Tool', value: 'tool' },
            { label: 'Experiment', value: 'experiment' },
          ],
          defaultValue: 'tool',
        }),
        tagline: fields.text({
          label: 'Tagline',
          validation: { length: { max: 90 } },
        }),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Live', value: 'live' },
            { label: 'Beta', value: 'beta' },
            { label: 'Archived', value: 'archived' },
            { label: 'Work in progress', value: 'wip' },
          ],
          defaultValue: 'wip',
        }),
        cover: fields.image({
          label: 'Cover',
          directory: 'public/projects',
          publicPath: '/projects/',
        }),
        links: fields.array(
          fields.object({
            label: fields.text({ label: 'Label' }),
            url: fields.url({ label: 'URL' }),
          }),
          {
            label: 'Links',
            itemLabel: (props) => props.fields.label.value || 'Link',
          },
        ),
        year: fields.integer({ label: 'Year' }),
        featured: fields.checkbox({ label: 'Featured', defaultValue: false }),
        order: fields.integer({ label: 'Order', defaultValue: 0 }),
        body: fields.markdoc({ label: 'Body' }),
      },
    }),
    posts: collection({
      label: 'Writing',
      slugField: 'title',
      path: 'src/content/blog/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['title', 'date', 'category'],
      schema: {
        title: fields.slug({
          name: { label: 'Title' },
        }),
        category: fields.text({ label: 'Category' }),
        date: fields.date({ label: 'Date', validation: { isRequired: true } }),
        summary: fields.text({ label: 'Summary', multiline: true }),
        draft: fields.checkbox({ label: 'Draft', defaultValue: false }),
        // Existing posts are plain Markdown (`.md`), so the Markdoc editor reads
        // and writes `.md` rather than `.mdoc` to keep filenames and slugs intact.
        content: fields.markdoc({ label: 'Body', extension: 'md' }),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: 'Site',
      path: 'src/content/site',
      format: { data: 'yaml' },
      schema: {
        tagline: fields.text({ label: 'Tagline', multiline: true }),
        intercomGreeting: fields.text({ label: 'Intercom greeting', multiline: true }),
        intercomSuggestions: fields.array(fields.text({ label: 'Suggestion' }), {
          label: 'Intercom suggestions',
          itemLabel: (props) => props.value || 'Suggestion',
        }),
        email: fields.text({ label: 'Email' }),
        github: fields.text({ label: 'GitHub' }),
        availability: fields.select({
          label: 'Availability',
          options: [
            { label: 'Open', value: 'open' },
            { label: 'Limited', value: 'limited' },
            { label: 'Closed', value: 'closed' },
          ],
          defaultValue: 'limited',
        }),
      },
    }),
  },
});
