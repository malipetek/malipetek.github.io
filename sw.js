const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/"];

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      cache.addAll(CACHE_MAP);
      // now we cached main mage
      console.log("main page cached");
    })()
  );
});

self.addEventListener("fetch", event => {
  // lets make it wait
  console.log("fetch event", event.request.url);
  event.waitUntil(
    (async () => {
      const response = await fetch(event.request);
      console.log("response", response);
      if (response.ok) {
        return event.respondWith(response);
      } else {
        const MAINPAGECACHE = await caches.match("/");
        if (MAINPAGECACHE) {
          return event.respondWith(MAINPAGECACHE.clone());
        } else {
          return event.respondWith(response);
        }
      }
    })()
  );
});
