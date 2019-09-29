window.parseLinks = function(container) {
  var parentPath = "";
  if (container.getAttribute("data-currentpath")) {
    parentPath = container.getAttribute("data-currentpath").replace("/", "");
  }
  var links = container.getElementsByTagName("a");
  Array.prototype.forEach.call(
    Array.prototype.filter.call(links, el => {
      var internal = el.href.search(window.internal_url_reg) !== -1;
      if (!internal) el.classList.add("external");
      el.style.display = "block";
      return internal;
    }),
    el => {
      if (parentPath) {
        el.setAttribute("data-parent-path", parentPath);
      }
      el.setAttribute(
        "data-extension",
        el.href.match(window.internal_url_reg)[0].split("_")[0]
      );
      el.addEventListener("click", e => {
        if (e.currentTarget.href.search(window.internal_url_reg) !== -1) {
          e.preventDefault();
          var pp = e.currentTarget.getAttribute("data-parent-path");
          var virtualPath = e.currentTarget.href.split(
            e.currentTarget.href.match(window.internal_url_reg)[0]
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
};
