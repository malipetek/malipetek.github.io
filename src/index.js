// lets just csss as far as we can
var styles = document.createElement("div");
//styles.innerHTML = `<link type="text/css" rel="stylesheet" href="./reset.css" />
//<link type="text/css" rel="stylesheet" href="./style.css" />`;
document.head.appendChild(styles);
const view_el = document.getElementById("view");

window.EXTMAP = {
  t: "template",
  temp: "template",
  md: "md"
};
const internal_url_reg = new RegExp(
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
    window.history.pushState(null, path[0].toUpperCase() + path.slice(1), url);
    console.log("setting curent path", url.pathname, ext);
    renderView(ext, url.pathname, this._current);
    this._current = url.pathname;
  }
};

function parseLinks(container) {
  var parentPath = "";
  if (container.getAttribute("data-currentpath")) {
    parentPath = container.getAttribute("data-currentpath").replace("/", "");
  }
  var links = container.getElementsByTagName("a");
  Array.prototype.forEach.call(
    Array.prototype.filter.call(links, el => {
      var internal = el.href.search(internal_url_reg) !== -1;
      if (!internal) el.classList.add("external");
      return internal;
    }),
    el => {
      if (parentPath) {
        el.setAttribute("data-parent-path", parentPath);
      }
      el.setAttribute(
        "data-extension",
        el.href.match(internal_url_reg)[0].split("_")[0]
      );
      el.addEventListener("click", e => {
        if (e.currentTarget.href.search(internal_url_reg) !== -1) {
          e.preventDefault();
          var pp = e.currentTarget.getAttribute("data-parent-path");
          var virtualPath = e.currentTarget.href.split(
            e.currentTarget.href.match(internal_url_reg)[0]
          )[1];

          window.view.current =
            (pp ? pp + "/" : "") +
            virtualPath +
            "." +
            e.currentTarget.getAttribute("data-extension");
          return !!0;
        } else {
          return !!1;
        }
      });
    }
  );
}

async function renderView(ext, path, prev) {
  if (path == prev) return;
  if (prev) window.DOMCACHE[prev] = view_el.childNodes.detach();

  if (window.DOMCACHE[path]) {
    for (var i = 0; i < window.DOMCACHE[path].length; i++) {
      view_el.appendChild(window.DOMCACHE[path][i]);
    }
    return 1;
  }
  const response = await fetch(`/src/views${path}.${window.EXTMAP[ext]}`);
  const responseText = await response.text();
  var importStatements = new RegExp('\\s*import\\s*"[^"]+"', "gi");
  var _imports = responseText.match(importStatements);
  if (_imports) {
    await Promise.all(
      _imports.map(async statement => {
        var url = statement.match(/".+"/)[0].replace(/"/g, "");
        const resp = await fetch(url);
        const js = await resp.text();
        eval(js);
        return 1;
      })
    );
  }

  view_el.innerHTML = responseText.replace(importStatements, "");
  view_el.setAttribute("data-currentpath", path);
  parseLinks(view);
}

parseLinks(document.body);
window.view.current =
  window.location.pathname.replace(/^\/|\/$/g, "") || "main";
