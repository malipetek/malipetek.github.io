(async () => {
  const view_el = document.getElementById("view");

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
    _extmap: {
      // root is views
      ext: "template",
      blog: {
        ext: "md"
      },
      scripts: {
        ext: "module"
      },
      styles: { ext: "css" }
    },
    get ext() {
      var isExternal = /external:/.test(this.current);
      var forceExtension = /:[^:]+$/.test(this.current);
      var ext_found = this._extmap.ext;

      if (forceExtension) {
        return (ext_found = this.current.match(/:[^:]+$/)[0]).replace(":", "");
      }
      if (isExternal) {
        return (ext_found = (this.current.match(/\.[^.]+$/) || [
          "noextension"
        ])[0]);
      }

      // regular case
      var path = this.current.split("/").filter(Boolean);
      path.pop();
      path.forEach(step => {
        ext_found =
          this._extmap[step] && this._extmap[step].ext
            ? this._extmap[step].ext
            : ext_found;
      });
      return ext_found;
    },
    set ext(value) {
      console.warn("ext is read only");
    },
    _current: "",
    get current() {
      return this._current;
    },
    set current(_url) {
      let url = _url;

      url = !!(url.indexOf(window.location.hostname) > 0) // is internal
        ? url
        : `${window.location.origin}/${url.replace("//", "/")}`;
      url = new URL(url);
      var path = url.pathname + url.search;
      if (path === this._current) return 1;
      window.history.pushState(
        path,
        path[0].toUpperCase() + path.slice(1),
        url
      );

      this._was = this._current;
      this._current = path;

      var ext = this.ext;
      renderView(ext, this._current, this._was);
    }
  };
  await window.require("../scripts/parseLinks.module"); // window.parseLinks

  async function renderView(ext, path, prev) {
    if (path == prev) return;
    if (prev) window.DOMCACHE[prev] = view_el.childNodes.detach();

    if (window.DOMCACHE[path]) {
      for (var i = 0; i < window.DOMCACHE[path].length; i++) {
        view_el.appendChild(window.DOMCACHE[path][i]);
      }
      return 1;
    }
    let response;
    var isExternal = /external:/.test(path);
    if (isExternal) {
      response = await window.require(`${path}`);
    } else {
      response = await window.require(`/static/views${path}.${ext}`);
    }

    ext = ext.replace(".", "");

    await window.require(`../static/renderers/${ext}.renderer`);

    view_el.innerHTML = await window.RENDER[ext](response);
    view_el.setAttribute("data-currentpath", path);
    window.parseLinks(view_el);
  }

  window.addEventListener("popstate", function(event) {
    window.view.current = window.location.pathname.replace(/^\/|\/$/g, "");
  });

  window.parseLinks(document.body);
  window.view.current =
    window.location.pathname.replace(/^\/|\/$/g, "") + window.location.search ||
    "main";
})();
