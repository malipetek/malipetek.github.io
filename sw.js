const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/"];

self.addEventListener("install", async event => {
  const cache = await caches.open(CACHE_NAME);
  cache.addAll(CACHE_MAP);
  // now we cached main mage
});

self.addEventListener("fetch", async event => {
  const response = await fetch(event.request);
  if (response.ok) {
  } else {
    const MAINPAGECACHE = caches.match(new URL("/"));
    console.log(response, MAINPAGECACHE);
    event.respondWith(MAINPAGECACHE);
  }
});
