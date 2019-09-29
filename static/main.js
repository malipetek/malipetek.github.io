// lets just csss as far as we can
//var styles = document.createElement("div");
//styles.innerHTML = `<link type="text/css" rel="stylesheet" href="./reset.css" />
//<link type="text/css" rel="stylesheet" href="./style.css" />`;
//document.head.appendChild(styles);
(async () => {
  const view_el = document.getElementById("view");

  window.EXTMAP = {
    t: "template",
    temp: "template",
    md: "md"
  };
  window.internal_url_reg = new RegExp(
    `((${Object.keys(window.EXTMAP).join(")|(")}))_`,
    "gi"
  );

  window.DOMCACHE = {};
  Object.defineProperty(NodeList.prototype, "detach", {
    value: function() {
      const arr = [];
      if (this.length) {
        const parent = this[0].parentNode;
        while (parent.firstChild) {
          arr.push(parent.removeChild(parent.firstChild));
        }
      }
      return arr;
    }
  });
  window.view = {
    _current: "",
    get current() {
      return this._current;
    },
    set current(_url) {
      let [url, ext] = _url.split(".");
      ext = ext || "t";
      url = !!(url.indexOf(window.location.hostname) > 0)
        ? url
        : `${window.location.origin}/${url.replace("//", "/")}`;
      url = new URL(url);
      var path = url.pathname;
      if (path === this._current) return 1;
      window.history.pushState(
        path,
        path[0].toUpperCase() + path.slice(1),
        url
      );
      console.log("setting curent path", path, ext);
      renderView(ext, path, this._current);
      this._current = path;
    }
  };

  console.log(window.view);
  await window.srequire("./scripts/parseLinks.js"); // window.parseLinks

  async function renderView(ext, path, prev) {
    if (path == prev) return;
    if (prev) window.DOMCACHE[prev] = view_el.childNodes.detach();

    if (window.DOMCACHE[path]) {
      for (var i = 0; i < window.DOMCACHE[path].length; i++) {
        view_el.appendChild(window.DOMCACHE[path][i]);
      }
      return 1;
    }
    const response = await window.srequire(
      `/src/views${path}.${window.EXTMAP[ext]}`
    );

    var importStatements = new RegExp('\\s*import\\s*"[^"]+"', "gi");
    var _imports = response.match(importStatements);
    if (_imports) {
      const loaded = await Promise.all(
        _imports.map(async statement => {
          var url = statement.match(/".+"/)[0].replace(/"/g, "");
          const resp = await fetch(url);
          const js = await resp.text();
          return js;
        })
      );
      loaded.forEach(js => {
        console.log(window.evalGlobal.call(window, js));
      });
    }
    response = response.replace(importStatements, "");

    if (ext == "md" && window.markdownit) {
      if (window.hljs) {
        window.md = window.markdownit({
          highlight: function(str, lang) {
            if (lang && window.hljs.getLanguage(lang)) {
              try {
                return (
                  '<pre class="hljs"><code>' +
                  window.hljs.highlight(lang, str, true).value +
                  "</code></pre>"
                );
              } catch (__) {}
            }

            return (
              '<pre class="hljs"><code>' +
              window.md.utils.escapeHtml(str) +
              "</code></pre>"
            );
          }
        });
      } else {
        window.md = window.markdownit();
      }
      response = window.md.render(response);
    }
    view_el.innerHTML = response;
    view_el.setAttribute("data-currentpath", path);
    window.parseLinks(view_el);
  }

  window.addEventListener("popstate", function(event) {
    window.view.current = window.location.pathname.replace(/^\/|\/$/g, "");
  });

  window.parseLinks(document.body);
  window.view.current =
    window.location.pathname.replace(/^\/|\/$/g, "") || "main";
})();
