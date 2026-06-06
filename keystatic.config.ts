import { collection, config, fields } from "@keystatic/core";

const repo = "malipetek/malipetek.github.io";

const imageOptions = {
  directory: "public/blog-images",
  publicPath: "/blog-images/",
};

const blogCategoryOptions = [
  { label: "Linux", value: "linux" },
  { label: "Shopify", value: "shopify" },
  { label: "Svelte", value: "svelte" },
  { label: "Web", value: "web" },
] as const;

function blogPostCollection() {
  return collection({
    label: "Blog Posts",
    path: "src/content/blog/*",
    slugField: "title",
    entryLayout: "content",
    columns: ["title", "category", "description"],
    format: {
      contentField: "content",
    },
    schema: {
      title: fields.slug({
        name: {
          label: "Title",
          validation: { isRequired: true },
        },
      }),
      category: fields.select({
        label: "Category",
        options: blogCategoryOptions,
        defaultValue: "linux",
      }),
      description: fields.text({
        label: "Description",
        multiline: true,
        description: "Short SEO/listing description.",
      }),
      summary: fields.text({
        label: "Summary",
        multiline: true,
      }),
      keywords: fields.text({
        label: "Keywords",
        description: "Comma-separated keywords.",
      }),
      image: fields.text({
        label: "Image URL",
      }),
      content: fields.markdoc({
        label: "Content",
        extension: "md",
        options: {
          bold: true,
          italic: true,
          strikethrough: true,
          code: true,
          heading: true,
          blockquote: true,
          orderedList: true,
          unorderedList: true,
          table: true,
          link: true,
          image: imageOptions,
          divider: true,
          codeBlock: true,
        },
      }),
    },
  });
}

export default config({
  storage: {
    kind: "github",
    repo,
  },
  ui: {
    brand: {
      name: "malipetek.dev",
    },
    navigation: {
      Blog: ["blogPosts"],
    },
  },
  collections: {
    blogPosts: blogPostCollection(),
  },
});
