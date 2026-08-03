import { defineMiddleware } from "astro:middleware";

const DISCOVERY_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</agents>; rel="service-doc"; type="text/html"',
  '</agents.txt>; rel="describedby"; type="text/plain"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
  '</.well-known/acp.json>; rel="describedby"; type="application/json"',
].join(", ");

const TEXT_MARKDOWN = "text/markdown; charset=utf-8";

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  if (url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "malipetek.dev",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: DISCOVERY_LINKS,
        },
      }
    );
  }

  const response = await next();

  // Add discovery headers to homepage
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const headers = new Headers(response.headers);
    headers.set("link", DISCOVERY_LINKS);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // Markdown content negotiation
  const accept = context.request.headers.get("accept") || "";
  const wantsMarkdown = accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.startsWith("text/markdown"));

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");

  if (wantsMarkdown && isHtml) {
    const html = await response.text();
    const markdown = htmlToMarkdown(html, url);
    const headers = new Headers(response.headers);
    headers.set("content-type", TEXT_MARKDOWN);
    headers.set("vary", appendHeaderValue(headers.get("vary"), "Accept"));
    headers.set("x-markdown-tokens", String(estimateTokens(markdown)));
    return new Response(markdown, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
});

function htmlToMarkdown(html: string, url: URL): string {
  const title = matchFirst(html, /<title>([\s\S]*?)<\/title>/i) || "malipetek.dev";
  const description =
    matchFirst(html, /<meta\s+name="description"\s+content="([^"]*)"/i) ||
    matchFirst(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i) ||
    "";
  const main = matchFirst(html, /<main[^>]*>([\s\S]*?)<\/main>/i) || html;

  let markdown = main
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match: string, href: string, text: string) => {
      return `[${stripTags(text).trim()}](${absoluteHref(href, url)})`;
    })
    .replace(/<\/(p|div|section|article|aside|nav|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  markdown = decodeEntities(markdown);

  const intro = [`# ${decodeEntities(stripTags(title).trim())}`, "", `Source: ${url.href}`];
  if (description) {
    intro.push("", decodeEntities(description));
  }

  return `${intro.join("\n")}\n\n${markdown}\n`;
}

function matchFirst(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  return match ? match[1] : "";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function absoluteHref(href: string, url: URL): string {
  try {
    return new URL(href, url.origin).href;
  } catch {
    return href;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function estimateTokens(markdown: string): number {
  return Math.max(1, Math.ceil(markdown.trim().split(/\s+/).length * 1.33));
}

function appendHeaderValue(current: string | null, value: string): string {
  if (!current) return value;
  const parts = current.split(",").map((part) => part.trim().toLowerCase());
  return parts.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}
