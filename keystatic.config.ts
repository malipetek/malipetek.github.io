import { collection, config, fields } from "@keystatic/core";

const repo = "malipetek/malipetek.github.io";

const imageOptions = {
  directory: "public/blog-images",
  publicPath: "/blog-images/",
};

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
      category: fields.text({
        label: "Category",
        description: "Type any category. It will be converted into the URL category segment.",
        defaultValue: "linux",
        validation: { isRequired: true },
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
