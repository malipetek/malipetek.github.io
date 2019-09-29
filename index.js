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

window.GLOB_SCRIPT_CACHE = {};

window.srequire = async function(url) {
  const relative = /^https?:\/\//i;
  const isRelative = !relative.test(url);
  url = /static\//.test(url) ? url : `./static${url.replace(".", "")}`;
  url = isRelative ? `${url.replace("./", window.location.origin + "/")}` : url;
  let ext = url.match(/\.[^\.]+$/gi)[0];

  const _response = await fetch(url);
  const response = await _response.text();

  console.log("loaded", url);
  switch (ext) {
    case ".module":
      return evalGlobal(response);
      break;
    case ".template":
      return response;
      break;
    case ".md":
      break;
  }
};
window.require =
  window.location.origin !== "https://malipetek.github.io"
    ? window.srequire
    : window.srequire;

window.srequire("./static/main.module");
