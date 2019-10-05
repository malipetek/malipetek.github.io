const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/"];

self.addEventListener("install", event => {
  event
    .waitUntil(caches.open(CACHE_NAME))
    .then(cache => cache.addAll(CACHE_MAP));
  // now we cached main mage
});

self.addEventListener("fetch", event => {
  console.log(event);
  event.respondWith(caches.match());
});
