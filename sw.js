const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/"];

self.addEventListener("install", async event => {
  const cache = await event.waitUntil(caches.open(CACHE_NAME));
  cache.addAll(CACHE_MAP);
  // now we cached main mage
});

self.addEventListener("fetch", async event => {
  console.log(event);
  event.respondWith(caches.match());
});
