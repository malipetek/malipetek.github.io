(async () => {
  function evalGlobal(js) {
    // we store globals to detect additions later
    var keys = Object.keys(window).slice();

    // execute and have funtion in global
    eval.call(window, js);

    // we find additions to global
    var new_keys = Object.keys(window).slice();
    var dif_keys = new_keys.filter(k => keys.indexOf(k) == -1);

    if (dif_keys.length) {
      // we have both global additions and module export
      var result = {};
      for (var key in dif_keys) {
        result[key] = window[key];
      }
      return result;
    }
  }
  window.evalGlobal = evalGlobal;

  window.RENDER = {};

  window.MODULE_REGISTRY = {};
  window.RELATIVE = new RegExp(window.location.hostname, "i");

  window.require = async function(url) {
    try {
      var isExternal = /external:/.test(url);
      if (isExternal) {
        url = new URL(url.replace("/external:", "https://"));
      } else {
        url = new URL(url);
      }
    } catch (err) {
      url = new URL(`${url.replace(/^\.*\//, window.location.origin + "/")}`);
    }
    const isRelative = window.RELATIVE.test(url.href);

    url.pathname =
      isRelative && !/static\//.test(url.pathname)
        ? `../static/${url.pathname}`
        : url.pathname;

    let ext = url.pathname.match(/\.[^\.]+$/gi)[0];

    if (
      (ext == ".js" || ext == ".renderer" || ext == ".module") &&
      (window.MODULE_REGISTRY[url.href] &&
        window.MODULE_REGISTRY[url.href]["loaded"])
    ) {
      return console.log("script already loaded");
    } else {
      console.log("loading resource", url.href);
    }

    let _response;
    let response;
    try {
      _response = await fetch(url);
      response = await _response.text();
    } catch (err) {
      throw new Error("script could not be loaded ", err);
    }

    switch (ext) {
      case ".template":
        return response;
      case ".md":
        return response;
      case ".js":
      case ".module":
      case ".renderer":
        window.MODULE_REGISTRY[url.href] = { loaded: true };
        try {
          window.evalGlobal(response);
        } catch (err) {
          throw new Error("Could not executre script " + url.href, err);
        }
        window.MODULE_REGISTRY[url]["excuted"] = true;
        break;
      default:
        return response;
    }
  };

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("../sw.js");
      console.log("Service worker did register ");
    } catch (err) {
      console.error("Service worker did not register ", err);
    }
  }
})();
