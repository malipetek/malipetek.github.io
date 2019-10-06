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

self.addEventListener("fetch", function(event) {
  console.log("Handling fetch event for", event.request);

  event.respondWith(
    caches.match("/").then(function(mainpagecache) {
      return fetch(event.request)
        .then(function(response) {
          if (mainpagecache && !response.ok) {
            console.log("mainpagecache found in cache:", mainpagecache);

            return mainpagecache;
          }
          console.log("Response from network is:", response);

          return response;
        })
        .catch(function(error) {
          console.error("Fetching failed:", error);

          throw error;
        });
    })
  );
});
