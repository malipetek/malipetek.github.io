const CACHE_NAME = "githubio-cache";
const CACHE_MAP = ["/", 
                    "/static/views/blog.template",
                    "/static/views/grocery.template",
                    "/static/views/contact.template",
                    "/static//scripts/parseLinks.module",
                    "/static/renderers/template.renderer",
                    "/static/styles/reset.css", 
                    "/static/styles/styles.css", 
                    "/static/styles/atom-one-dark.css", 
                    "/static/images/me_optimized.jpg", 
                    "/index.js", 
                    "/main.js"];

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
  const url = new URL(event.request.url);
  if(CACHE_MAP.indexOf(url.pathname) == -1) return;
  event.respondWith(
    caches.match(url.pathname).then(function(mainpagecache) {
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
