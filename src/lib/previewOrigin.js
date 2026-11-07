// Only this account's site previews may use the live intercom service binding.
// One DNS label before the exact Worker suffix; never arbitrary workers.dev hosts.
export function isSitePreview(url) {
  return url.protocol === 'https:' && !url.port &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-)?malipetek-site\.malipetek\.workers\.dev$/.test(url.hostname);
}

export function proxyOrigin(request, path, hasBinding) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  // Preserve missing, opaque, or foreign origins so the backend rejects them
  // as before. MCP/OAuth and unbound local-dev requests are not affected.
  if (hasBinding && (path === '/api' || path.startsWith('/api/')) &&
      isSitePreview(url) && origin === url.origin) {
    return 'https://malipetek.dev';
  }
  return origin;
}
