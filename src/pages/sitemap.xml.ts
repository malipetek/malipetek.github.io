import { getBlogCategoriesWithPosts, getBlogPosts } from "../data/blog";
import { products } from "../data/projects";
import { services } from "../data/services";
import { storeProducts } from "../data/store";
import { absoluteUrl } from "../data/site";

const staticRoutes = [
  "/",
  "/store",
  "/products",
  "/services",
  "/agents",
  "/work-with-me",
  "/resume",
  "/contact",
  "/chat",
  "/chatbotstack",
  "/now",
  "/experience",
  "/experience/truth",
  "/blog",
  "/privacy-policy",
  "/terms-of-service",
  "/refund-cancellation-policy",
  "/distance-sales-agreement",
  "/preliminary-information-form",
  "/pdfextractor/privacy-policy",
  "/pdfextractor/terms-of-service",
];

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  const posts = await getBlogPosts();
  const categories = await getBlogCategoriesWithPosts();
  const urls = [
    ...staticRoutes,
    ...categories.map((category) => `/blog/${category.key}`),
    ...storeProducts.map((product) => `/store/${product.slug}`),
    ...storeProducts.map((product) => `/checkout/${product.slug}`),
    ...products.map((product) => `/products/${product.slug}`),
    ...services.map((service) => `/services/${service.slug}`),
    ...posts.map((post) => `/blog/${post.category}/${post.slug}`),
  ];
  const uniqueUrls = Array.from(new Set(urls));
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueUrls
  .map(
    (path) => `  <url>
    <loc>${escapeXml(absoluteUrl(path))}</loc>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
