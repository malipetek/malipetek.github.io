import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const blogDir = join(root, "src", "content", "blog");

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
  /category:\s*fields\.text\(/,
  "Keystatic blog entries should expose category as a free text field"
);
assert.doesNotMatch(
  keystaticConfig,
  /category:\s*fields\.select\(|blogCategoryOptions/,
  "Keystatic category should not be limited to a predefined option list"
);
assert.match(
  contentConfig,
  /category:\s*z\.string\(\)(?:\.trim\(\))?\.min\(1\)/,
  "Astro content schema should accept any non-empty category string"
);
assert.match(
  blogData,
  /categoryTitle\s*=\s*entry\.data\.category\.trim\(\)/,
  "Blog routes should derive category from frontmatter, not the file path"
);
assert.match(
  blogData,
  /category:\s*toCategorySlug\(categoryTitle\)/,
  "Blog URL category segments should be generated from typed category text"
);
assert.doesNotMatch(
  blogData,
  /filter\(\(post\) => getBlogCategory\(post\.category\)/,
  "Blog posts with new typed categories should not be filtered out"
);
assert.match(
  blogData,
  /getBlogCategoriesWithPosts/,
  "Blog index pages should derive visible categories from post frontmatter"
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
