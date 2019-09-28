function evalGlobal(js) {
  // we store globals to detect additions later
  var keys = Object.keys(window).slice();

  // we wrap in a function to capture exports
  var functionid = "import_" + new Date().getTime().toString(36);
  // replace module exports with return
  js = js.replace(/module.exports\s*=\s*/gi, "return ");
  // now wrapping
  js = "function " + functionid + "(){ " + js + "}";
  // execute and have funtion in global
  eval.call(window, js);

  // execute declared function and capture exports
  var _exports = window[functionid]();

  // we find additions to global
  var new_keys = Object.keys(window).slice();
  var dif_keys = new_keys.filter(k => keys.indexOf(k) == -1);

  if (_exports && dif_keys.length) {
    // we have both global additions and module export
    var result = { default: _exports };
    for (var key in dif_keys) {
      result[key] = window[key];
    }
    return result;
  }
}
window.evalGlobal = evalGlobal;
