const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/"];

self.addEventListener("install", async event => {
  const cache = await caches.open(CACHE_NAME);
  cache.addAll(CACHE_MAP);

  const MAINPAGECACHE = await caches.match("/");

  console.log("response from cache", MAINPAGECACHE.bodyUsed);
  // now we cached main mage
});

self.addEventListener("fetch", async event => {
  const response = await fetch(event.request);
  console.log("response", response);
  if (response.ok) {
    event.respondWith(response);
  } else {
    const MAINPAGECACHE = await caches.match("/");
    if (MAINPAGECACHE) {
      event.respondWith(MAINPAGECACHE.clone());
    } else {
      event.respondWith(response);
    }
  }
});
