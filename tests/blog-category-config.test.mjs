import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const blogDir = join(root, "src", "content", "blog");
const allowedCategories = new Set(["linux", "shopify", "svelte", "web"]);

const keystaticConfig = readFileSync(join(root, "keystatic.config.ts"), "utf8");
const contentConfig = readFileSync(join(root, "src", "content", "config.ts"), "utf8");
const blogData = readFileSync(join(root, "src", "data", "blog.ts"), "utf8");

assert.match(
  keystaticConfig,
  /navigation:\s*\{\s*Blog:\s*\["blogPosts"\]/s,
  "Keystatic navigation should expose one Blog Posts collection"
);
assert.match(
  keystaticConfig,
  /blogPosts:\s*blogPostCollection\(/,
  "Keystatic should register one blogPosts collection"
);
assert.doesNotMatch(
  keystaticConfig,
  /linuxPosts|shopifyPosts|sveltePosts|webPosts/,
  "Keystatic should not hard-code one collection per category"
);
assert.match(
  keystaticConfig,
  /category:\s*fields\.select\(/,
  "Keystatic blog entries should expose category as a select field"
);
assert.match(
  contentConfig,
  /category:\s*z\.enum\(\["linux",\s*"shopify",\s*"svelte",\s*"web"\]\)/,
  "Astro content schema should validate blog category frontmatter"
);
assert.match(
  blogData,
  /category:\s*entry\.data\.category/,
  "Blog routes should derive category from frontmatter, not the file path"
);

const markdownFiles = listMarkdownFiles(blogDir);
assert.ok(markdownFiles.length > 0, "Expected existing blog markdown files");

for (const file of markdownFiles) {
  const rel = relative(blogDir, file);
  assert.equal(
    rel.split("/").length,
    1,
    `${rel} should live directly under src/content/blog so category can be edited independently`
  );

  const frontmatter = parseFrontmatter(readFileSync(file, "utf8"));
  assert.ok(frontmatter.category, `${rel} should include category frontmatter`);
  assert.ok(
    allowedCategories.has(frontmatter.category),
    `${rel} category should be one of ${[...allowedCategories].join(", ")}`
  );
}

function listMarkdownFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listMarkdownFiles(fullPath);
    return entry.endsWith(".md") ? [fullPath] : [];
  });
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, "Markdown file should start with frontmatter");

  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [
        key,
        value.replace(/^["']|["']$/g, "").trim(),
      ])
  );
}
