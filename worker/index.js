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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return withDiscoveryHeaders(
        Response.json({
          status: "ok",
          service: "malipetek.dev",
          timestamp: new Date().toISOString(),
        }),
        url
      );
    }

    const assetRequest = requestForAsset(request, url);
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    const response = await normalizeSpecialResponse(assetResponse, url);

    if (wantsMarkdown(request) && isHtml(response)) {
      const html = await response.text();
      const markdown = htmlToMarkdown(html, url);
      const headers = new Headers(response.headers);
      headers.set("content-type", TEXT_MARKDOWN);
      headers.set("vary", appendHeaderValue(headers.get("vary"), "Accept"));
      headers.set("x-markdown-tokens", String(estimateTokens(markdown)));
      return withDiscoveryHeaders(
        new Response(markdown, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
        url
      );
    }

    return withDiscoveryHeaders(response, url);
  },
};

function requestForAsset(request, url) {
  if (url.pathname === "/.well-known/api-catalog") {
    const rewritten = new URL(request.url);
    rewritten.pathname = "/.well-known/api-catalog";
    return new Request(rewritten, request);
  }

  return request;
}

async function normalizeSpecialResponse(response, url) {
  const headers = new Headers(response.headers);

  if (url.pathname === "/.well-known/api-catalog") {
    headers.set("content-type", "application/linkset+json; charset=utf-8");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withDiscoveryHeaders(response, url) {
  const headers = new Headers(response.headers);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    headers.set("link", DISCOVERY_LINKS);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function wantsMarkdown(request) {
  const accept = request.headers.get("accept") || "";
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.startsWith("text/markdown"));
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").includes("text/html");
}

function htmlToMarkdown(html, url) {
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
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text) => {
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

function matchFirst(value, pattern) {
  const match = value.match(pattern);
  return match ? match[1] : "";
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "");
}

function absoluteHref(href, url) {
  try {
    return new URL(href, url.origin).href;
  } catch {
    return href;
  }
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function estimateTokens(markdown) {
  return Math.max(1, Math.ceil(markdown.trim().split(/\s+/).length * 1.33));
}

function appendHeaderValue(current, value) {
  if (!current) return value;
  const parts = current.split(",").map((part) => part.trim().toLowerCase());
  return parts.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}
