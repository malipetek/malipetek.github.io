(async () => {
  function evalGlobal(js) {
    // we store globals to detect additions later
    var keys = Object.keys(window).slice();

    // execute and have funtion in global
    var evalResult = eval.call(window, js);

    // we find additions to global
    var new_keys = Object.keys(window).slice();
    var dif_keys = new_keys.filter(k => keys.indexOf(k) == -1);

    var result = {
      default: evalResult
    };
    if (dif_keys.length) {
      // we have both global additions and module export
      for (var key in dif_keys) {
        result[key] = window[key];
      }
    }
    return result;
  }
  window.evalGlobal = evalGlobal;

  window.RENDER = {};

  window.MODULE_REGISTRY = {};
  window.RELATIVE = new RegExp(window.location.hostname, "i");

  window.require = async function(url) {
    let ext;
    const forExtentionReg = new RegExp(":((?!//|:).)+$", "i");
    try {
      var isExternal = /external:/.test(url);
      var forceExtension = forExtentionReg.test(url);
      if (isExternal) {
        url = url.replace(/\/?external:/, "https://");
      }
      if (forceExtension) {
        ext = url.match(forExtentionReg)[0];
        url = url.replace(forExtentionReg, "");
      }
      url = new URL(url);
    } catch (err) {
      url = new URL(`${url.replace(/^\.*\//, window.location.origin + "/")}`);
    }
    const isRelative = window.RELATIVE.test(url.href);

    url.pathname =
      isRelative && !/static\//.test(url.pathname)
        ? `../static/${url.pathname}`
        : url.pathname;

    ext = ext ? ext : url.pathname.match(/\.[^\.]+$/gi)[0];

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
      case ".mapper":
        window.MODULE_REGISTRY[url.href] = { loaded: true };
        try {
          var result = window.evalGlobal(response);
          if (result.default && result.default.constructor === Promise) {
            await result.default;
          }
        } catch (err) {
          throw new Error("Could not executre script " + url.href, err);
        }
        window.MODULE_REGISTRY[url]["excuted"] = true;
        break;
      default:
        return response;
    }
  };
})();
