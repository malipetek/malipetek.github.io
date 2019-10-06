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
  event.respondWith(
    fetch(event.request).then(response => {
      event.waitUntil(
        caches.match("/").then(cache => {
          if (!cache) {
            return event.request.redirect("/");
          }

          var init = {
            status: 200,
            statusText: "OK",
            headers: {}
          };

          response.headers.forEach(function(v, k) {
            init.headers[k] = v;
          });

          return cache.text().then(function(body) {
            return new Response(body, init);
          });
        })
      );
    })
  );
});
