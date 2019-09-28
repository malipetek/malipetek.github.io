window.srequire = async function(url) {
  const relative = /^https?:\/\//i;
  const isRelative = !relative.test(url);
  url = isRelative ? `${window.location.origin}/${url}` : url;
  const response = await fetch(url);
  let js = await response.text();
  console.log(url, js);
  // we store globals to detect additions later
  var keys = Object.keys(window).slice();

  // we wrap in a function to capture exports
  var functionid = "import_" + new Date().getTime().toString(36);
  // replace module exports with return
  var isModule = js.match(/module.exports\s*=\s*/gi);

  if (isModule) {
    js = js.replace(/module.exports\s*=\s*/gi, "window." + functionid + "=");
  }

  eval.call(window, js);

  // execute declared function and capture exports
  var module_export = window[functionid];

  // we find additions to global
  var new_keys = Object.keys(window).slice();
  var dif_keys = new_keys.filter(k => keys.indexOf(k) == -1);

  // we have both global additions and module export
  var result = { default: module_export };
  for (var key in dif_keys) {
    result[key] = window[key];
  }
  return result;
};
window.require =
  window.location.origin !== "https://malipetek.github.io"
    ? require
    : window.srequire;

require("./main.js");
