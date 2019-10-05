const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/"];

self.addEventListener("install", async event => {
  const cache = await caches.open(CACHE_NAME);
  cache.addAll(CACHE_MAP);
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
      event.respondWith(MAINPAGECACHE);
    } else {
      event.responseWith(response);
    }
  }
});
