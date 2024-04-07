import { o as openBlock, c as createElementBlock, b as createBaseVNode, e as createVNode, u as unref, d as createTextVNode, a as createStaticVNode, V as VPTeamMembers } from "./app.58ffe7f5.js";
const _hoisted_1 = /* @__PURE__ */ createBaseVNode("h1", {
  id: "your-favorite-full-stack-js-developer",
  tabindex: "-1"
}, [
  /* @__PURE__ */ createTextVNode("Your Favorite Full Stack JS Developer "),
  /* @__PURE__ */ createBaseVNode("a", {
    class: "header-anchor",
    href: "#your-favorite-full-stack-js-developer",
    "aria-hidden": "true"
  }, "#")
], -1);
const _hoisted_2 = { class: "w-full flex justify-center mb-4" };
const _hoisted_3 = /* @__PURE__ */ createStaticVNode("", 11);
const __pageData = JSON.parse('{"title":"Your Favorite Full Stack JS Developer","description":"","frontmatter":{"head":[["meta",{"name":"ir-site-verification-token","content":718139090}]]},"headers":[{"level":2,"title":"What I do?","slug":"what-i-do","link":"#what-i-do","children":[]},{"level":2,"title":"What is my level?","slug":"what-is-my-level","link":"#what-is-my-level","children":[]},{"level":2,"title":"What I charge?","slug":"what-i-charge","link":"#what-i-charge","children":[]}],"relativePath":"index.md"}');
const __default__ = { name: "index.md" };
const _sfc_main = Object.assign(__default__, {
  setup(__props) {
    const theguy = [
      {
        avatar: "images/me.webp",
        name: "Muhammet Ali Petek",
        title: "Developer",
        links: [
          { icon: "github", link: "https://github.com/malipetek" },
          { icon: "twitter", link: "https://twitter.com/malipetek" },
          { icon: "youtube", link: "https://www.youtube.com/@malipetek/featured" },
          { icon: "linkedin", link: "https://www.linkedin.com/in/malipetek/" }
        ],
        org: "TRUTH NYC",
        orgLink: "https://truthnyc.com/"
      }
    ];
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", null, [
        _hoisted_1,
        createBaseVNode("div", _hoisted_2, [
          createVNode(unref(VPTeamMembers), {
            class: "drop-shadow-md rounded",
            size: "medium",
            members: theguy
          })
        ]),
        _hoisted_3
      ]);
    };
  }
});
export {
  __pageData,
  _sfc_main as default
};
