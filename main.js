(async () => {
  const view_el = document.getElementById("view");

  window.DOMCACHE = {};

  window.URL_MAPS = {};

  Object.defineProperty(NodeList.prototype, "detach", {
    value: function() {
      const arr = [];
      if (this.length) {
        const parent = this[0].parentNode;
        // then we do the detaching
        while (parent.firstChild) {
          arr.push(parent.removeChild(parent.firstChild));
        }
      }
      return arr;
    }
  });

  // crazy loading
  const LOADING = {
    elements: (() => {
      return document.querySelectorAll(".loading-animation");
    })(),
    start: () => {
      LOADING.elements.forEach(el => (el.style.display = "block"));
    },
    stop: () => {
      LOADING.elements.forEach(el => (el.style.display = ""));
    }
  };

  window.LOADING = LOADING;
  // page load animations
  const ANIMATIONS = {
    append: {
      transform: "scale(1)",
      transformOrigin: "50% 0%",
      easing: "cubic-bezier(.5,1.5,.5,1)"
    },
    detach: {
      transform: "scale(0)",
      transformOrigin: "50% 100%",
      easing: "cubic-bezier(1,.1,1,.1)"
    }
  };

  function forceSkipAFrame(callback) {
    return new Promise(done => {
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          if (callback && callback.call) var result = callback();
          if (result && result.constructor === Promise) {
            await result;
          }
          done();
        });
      });
    }).catch(error => console.error("error"));
  }
  Object.defineProperty(NodeList.prototype, "oneByOneReverse", {
    value: function(action) {
      var arr = this;
      return new Promise(function(resolve, reject) {
        var results = [];
        var act = function(i) {
          // action expexted to return a promise but otherwise should still work
          var actionResult = action.call(arr[i], arr[i], i);
          if (!actionResult || actionResult.constructor != Promise) {
            actionResult = new Promise(function(res, rej) {
              res(actionResult);
            });
          }
          actionResult
            .then(function(resultOfSomething) {
              results.push(resultOfSomething);
              if (--i >= 0) {
                act(i);
              } else {
                resolve(results);
              }
            })
            .catch(function(err) {
              throw new Error(err);
            });
        };

        act(arr.length);
      });
    }
  });

  Object.defineProperty(NodeList.prototype, "oneByOne", {
    value: function(action) {
      var arr = this;
      return new Promise(function(resolve, reject) {
        var results = [];
        var act = function(i) {
          // action expexted to return a promise but otherwise should still work
          var actionResult = action.call(arr[i], arr[i], i);
          if (!actionResult || actionResult.constructor != Promise) {
            actionResult = new Promise(function(res, rej) {
              res(actionResult);
            });
          }
          actionResult
            .then(function(resultOfSomething) {
              results.push(resultOfSomething);
              if (++i < arr.length) {
                act(i);
              } else {
                resolve(results);
              }
            })
            .catch(function(err) {
              throw new Error(err);
            });
        };

        act(0);
      });
    }
  });

  Object.defineProperty(HTMLElement.prototype, "detachAnim", {
    value: async function(option) {
      const el = this;
      let variable_time = el.clientHeight / 1000;
      const max_variable_time = 0.1;
      variable_time =
        variable_time <= max_variable_time ? variable_time : max_variable_time;

      if (option == "immediate") {
        // el.style.transition = "none";
        el.style.transform = ANIMATIONS.detach.transform;
        /*        await forceSkipAFrame(async () => {
          return 1;
        }); */
        /* setTimeout(function() {
          el.style.transition = "transform";
          el.style.transitionDuration = variable_time + "s";
          el.style.transitionTimingFunction = ANIMATIONS.detach.easing;
        }, variable_time * 1000 + 10); */
        return 1;
      } else if (el.nodeType == 1) {
        el.style.transition = "transform";
        el.style.transitionDuration = variable_time + "s";
        el.style.transitionTimingFunction = ANIMATIONS.detach.easing;

        el.style.transform = ANIMATIONS.detach.transform;
        el.style.transformOrigin = ANIMATIONS.detach.transformOrigin;
        el.setAttribute("animating", "yes");
        return await new Promise(done => {
          setTimeout(function() {
            el.removeAttribute("animating");
            done();
          }, variable_time * 1000 + 10);
        });
      } else {
        return 1;
      }
    }
  });

  Object.defineProperty(HTMLElement.prototype, "appendAnim", {
    value: async function(option) {
      const el = this;
      let variable_time = el.clientHeight / 1000;
      const max_variable_time = 0.1;
      variable_time =
        variable_time <= max_variable_time ? variable_time : max_variable_time;
      if (option == "immediate") {
        await forceSkipAFrame(async () => {
          //          el.style.transition = "none";
          el.style.transform = ANIMATIONS.append.transform;
          return 1;
        });
        /*setTimeout(function() {
          el.style.transition = "transform";
          el.style.transitionDuration = variable_time + "s";
          el.style.transitionTimingFunction = ANIMATIONS.append.easing;
          return 1;
        }, variable_time * 1000 + 10);*/
        return 1;
      } else if (el.nodeType == 1) {
        el.style.transition = "transform";
        el.style.transitionDuration = variable_time + "s";
        el.style.transitionTimingFunction = ANIMATIONS.append.easing;

        el.style.transform = ANIMATIONS.append.transform;
        el.style.transformOrigin = ANIMATIONS.append.transformOrigin;
        el.setAttribute("animating", "yes");
        return await new Promise(done => {
          setTimeout(function() {
            el.removeAttribute("animating");
            done();
          }, variable_time * 1000 + 10);
        });
      } else {
        return 1;
      }
    }
  });

  Object.defineProperty(HTMLElement.prototype, "animateAppend", {
    value: async function(option) {
      var that = this;
      return await forceSkipAFrame(async () => {
        await that.childNodes.oneByOne(async el => {
          if (
            el &&
            el.nodeType == 1 &&
            !el.hasAttribute("animating") &&
            !el.classList.contains("animate-container")
          ) {
            await el.appendAnim(option == "immediate" ? option : null);
          } else if (
            el &&
            el.nodeType == 1 &&
            el.classList.contains("animate-container")
          ) {
            await el.appendAnim("immediate");
            await forceSkipAFrame(async () => {
              await el.animateAppend(option == "immediate" ? option : null);
            });
          }
          return 1;
        });
      });
    }
  });

  Object.defineProperty(HTMLElement.prototype, "animateDetach", {
    value: async function(option) {
      var that = this;
      return await forceSkipAFrame(async () => {
        await that.childNodes.oneByOneReverse(async el => {
          if (
            el &&
            el.nodeType == 1 &&
            !el.hasAttribute("animating") &&
            !el.classList.contains("animate-container")
          ) {
            await el.detachAnim(option == "immediate" ? option : null);
          } else if (
            el &&
            el.nodeType == 1 &&
            el.classList.contains("animate-container")
          ) {
            await forceSkipAFrame(async () => {
              await el.animateDetach(option == "immediate" ? option : null);
            });
            await el.detachAnim("immediate");
          }
          return 1;
        });
      });
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
    _disqus_config: {
      enabled: false,
      blog: {
        enabled: false,
        "*": { enabled: true }
      },
      grocery: {
        enabled: false,
        "*": {
          enabled: true
        }
      }
    },
    get ext() {
      var url = this.current;

      var URLMAP_REGEXP = new RegExp(
        "(" + Object.keys(window.URL_MAPS).join("|") + "):",
        "gi"
      );

      var mapped = URLMAP_REGEXP.test(url);

      if (mapped) {
        var map = this.current.match(URLMAP_REGEXP)[0];
        map = map.replace(":", "");
        url = url.replace(URLMAP_REGEXP, "").replace("/", "");
        url = window.URL_MAPS[map] ? window.URL_MAPS[map][url] : ":load";
      }

      var isExternal = /external:/.test(url);
      var forceExtension = /:[^:]+$/.test(url);
      var ext_found = this._extmap.ext;
      if (forceExtension) {
        return (ext_found = url.match(/:[^:]+$/)[0]).replace(":", "");
      }
      if (isExternal) {
        return (ext_found = (url.match(/\.[^.]+$/) || ["noextension"])[0]);
      }

      // regular case
      var path = url.split("/").filter(Boolean);
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
    },
    get isDisqus() {
      var pathSplit = this._current.split(/[\/:]+/gi).filter(Boolean);
      var confFound = false;
      pathSplit.forEach(pathPart => {
        confFound = confFound
          ? confFound[pathPart] || confFound["*"]
          : this._disqus_config[pathPart] || this._disqus_config["*"];
      });
      return confFound ? confFound["enabled"] : false;
    },
    set isDisqus(v) {
      return;
    }
  };
  await window.require("../scripts/parseLinks.module"); // window.parseLinks

  function checkDisQus() {
    (function() {
      // DON'T EDIT BELOW THIS LINE
      // SHUT UP
      if (this.view.isDisqus) {
        document.querySelector("#disqus_thread").style.display = "block";
        if (window.DISQUS) {
          window.DISQUS.reset({
            reload: true,
            config: function() {
              this.page.identifier = window.location.pathname;
              this.page.url = window.location.href;
            }
          });
        } else {
          window.disqus_config = function() {
            this.page.url = window.location.href;
            this.page.identifier = window.location.pathname;
          };
          var d = document,
            s = d.createElement("script");
          s.src = "https://malipetek-github-io.disqus.com/embed.js";
          s.setAttribute("data-timestamp", +new Date());
          (d.head || d.body).appendChild(s);
          console.log("disqus script embedded");
        }
      } else {
        if (window.DISQUS) {
          window.DISQUS.reset();
        }
      }
    })();
  }
  async function renderView(ext, path, prev) {
    if (path == prev) return;

    document.querySelector("#disqus_thread").style.display = "none";

    await view_el.animateDetach();
    if (prev) window.DOMCACHE[prev] = view_el.childNodes.detach();

    LOADING.start();

    if (window.DOMCACHE[path]) {
      for (var i = 0; i < window.DOMCACHE[path].length; i++) {
        view_el.appendChild(window.DOMCACHE[path][i]);
      }

      LOADING.stop();

      checkDisQus();

      await view_el.animateAppend();
      return 1;
    }

    var URLMAP_REGEXP = new RegExp("[^:]+:", "gi");
    var mapped = URLMAP_REGEXP.test(path);

    if (mapped) {
      var map = path.match(URLMAP_REGEXP)[0];
      map = map.replace(":", "").replace("/", "");
      if (ext == "load") {
        await window.require(`/static/url_mappers/${map}.mapper`);
        ext = window.view.ext;
      }
      path = path.replace(URLMAP_REGEXP, "").replace("/", "");
      path = window.URL_MAPS[map][path];
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

    var new_html = await window.RENDER[ext](response);
    var domParser = new DOMParser();

    var newChildNodes = Array.from(
      domParser.parseFromString(new_html, "text/html").body.childNodes
    );

    for (var i = 0; i < newChildNodes.length; i++) {
      if (newChildNodes[i].style) {
        newChildNodes[i].style.opacity = "0";
      }
      view_el.appendChild(newChildNodes[i]);
    }

    window.parseLinks(view_el);

    await forceSkipAFrame(async () => {
      await view_el.animateDetach("immediate");
    });

    await view_el.childNodes.oneByOne(el => {
      if (el && el.nodeType == 1) {
        el.style.opacity = "1";
      }
    });

    LOADING.stop();

    checkDisQus();

    await forceSkipAFrame(async () => {
      await view_el.animateAppend();
    });

    view_el.setAttribute("data-currentpath", path);
  }

  window.addEventListener("popstate", function(event) {
    window.view.current = window.location.pathname.replace(/^\/|\/$/g, "");
  });

  window.parseLinks(document.body);
  let redirect = sessionStorage.redirect
    ? new URL(sessionStorage.redirect)
    : false;
  let initialPath = redirect || window.location;
  window.view.current =
    initialPath.pathname.replace(/^\/|\/$/g, "") + initialPath.search || "main";
})();
