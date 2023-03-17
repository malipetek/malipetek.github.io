import { f as useData, r as ref, g as resolveComponent, o as openBlock, c as createElementBlock, e as createVNode, w as withCtx, b as createBaseVNode, d as createTextVNode, F as Fragment, h as renderList, i as withDirectives, v as vModelRadio, t as toDisplayString } from "./app.2b2e4ede.js";
const quoteRequest_md_vue_type_style_index_0_lang = "";
const _hoisted_1 = /* @__PURE__ */ createBaseVNode("h1", {
  id: "send-a-request",
  tabindex: "-1"
}, [
  /* @__PURE__ */ createTextVNode("Send a request "),
  /* @__PURE__ */ createBaseVNode("a", {
    class: "header-anchor",
    href: "#send-a-request",
    "aria-hidden": "true"
  }, "#")
], -1);
const _hoisted_2 = /* @__PURE__ */ createBaseVNode("br", null, null, -1);
const _hoisted_3 = ["value"];
const _hoisted_4 = /* @__PURE__ */ createBaseVNode("input", {
  type: "hidden",
  name: "_next",
  value: "https://malipetek.github.io/form-sent"
}, null, -1);
const _hoisted_5 = { class: "d-flex flex-column" };
const _hoisted_6 = { class: "mt-8" };
const _hoisted_7 = /* @__PURE__ */ createBaseVNode("div", { class: "text-large mb-2" }, " Query type ", -1);
const _hoisted_8 = { class: "grid grid-flow-row-dense grid-cols-3 grid-rows-auto gap-4" };
const _hoisted_9 = ["checked", "id", "value"];
const _hoisted_10 = ["for"];
const _hoisted_11 = ["src"];
const _hoisted_12 = { class: "!mb-0 text-sm" };
const _hoisted_13 = { class: "mt-4" };
const _hoisted_14 = { class: "d-flex flex-column mt-4" };
const _hoisted_15 = /* @__PURE__ */ createBaseVNode("p", null, [
  /* @__PURE__ */ createTextVNode("Not feel like typing? "),
  /* @__PURE__ */ createBaseVNode("a", { href: "book-call" }, "Book a quick call")
], -1);
const __pageData = JSON.parse('{"title":"Send a request","description":"","frontmatter":{"prev":false,"next":false},"headers":[],"relativePath":"quote-request.md"}');
const __default__ = { name: "quote-request.md" };
const _sfc_main = Object.assign(__default__, {
  setup(__props) {
    useData();
    ref("");
    const items = ref([{
      label: "Shopify",
      value: "shopify",
      image: "images/shopify-icon.svg"
    }, {
      label: "Development",
      value: "development",
      image: "images/javascript.svg"
    }, {
      label: "Smt Else",
      value: "generic",
      image: "images/chat.svg"
    }]);
    const selection = ref("shopify");
    return (_ctx, _cache) => {
      const _component_v_text_field = resolveComponent("v-text-field");
      const _component_v_textarea = resolveComponent("v-textarea");
      const _component_v_btn = resolveComponent("v-btn");
      const _component_v_form = resolveComponent("v-form");
      const _component_v_sheet = resolveComponent("v-sheet");
      return openBlock(), createElementBlock("div", null, [
        _hoisted_1,
        _hoisted_2,
        createVNode(_component_v_sheet, {
          theme: "{{ isDark ? 'dark' : 'light' }}",
          width: "320",
          class: "contact-form"
        }, {
          default: withCtx(() => [
            createVNode(_component_v_form, {
              ref: "form",
              id: "contact-form",
              action: "https://formsubmit.co/malipetek@gmail.com",
              method: "POST"
            }, {
              default: withCtx(() => [
                createBaseVNode("input", {
                  type: "hidden",
                  name: "_subject",
                  value: selection.value
                }, null, 8, _hoisted_3),
                _hoisted_4,
                createBaseVNode("div", _hoisted_5, [
                  createVNode(_component_v_text_field, {
                    variant: "outlined",
                    "hide-details": "auto",
                    label: "Email address",
                    placeholder: "your@email.com",
                    type: "email",
                    name: "email",
                    clearable: "",
                    required: ""
                  })
                ]),
                createBaseVNode("div", _hoisted_6, [
                  _hoisted_7,
                  createBaseVNode("div", _hoisted_8, [
                    (openBlock(true), createElementBlock(Fragment, null, renderList(items.value, (entry, index) => {
                      return openBlock(), createElementBlock("div", null, [
                        withDirectives(createBaseVNode("input", {
                          checked: index == 0,
                          name: "query_type",
                          id: "qt-" + index,
                          value: entry.value,
                          type: "radio",
                          group: "qtype",
                          class: "hidden peer",
                          "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => selection.value = $event)
                        }, null, 8, _hoisted_9), [
                          [vModelRadio, selection.value]
                        ]),
                        createBaseVNode("label", {
                          for: "qt-" + index,
                          class: "h-40 cursor-pointer rounded border-2 border-gray-700 flex items-center justify-center peer-checked:border-green-700 flex-col"
                        }, [
                          createBaseVNode("img", {
                            src: entry.image,
                            width: "50"
                          }, null, 8, _hoisted_11),
                          createBaseVNode("p", _hoisted_12, toDisplayString(entry.label), 1)
                        ], 8, _hoisted_10)
                      ]);
                    }), 256))
                  ])
                ]),
                createBaseVNode("div", _hoisted_13, [
                  createVNode(_component_v_textarea, {
                    clearable: "",
                    label: "Message (optional)",
                    variant: "outlined",
                    name: "message"
                  })
                ]),
                createBaseVNode("div", _hoisted_14, [
                  createVNode(_component_v_btn, {
                    type: "submit",
                    variant: "outlined",
                    color: "green",
                    form: "contact-form",
                    class: "",
                    block: ""
                  }, {
                    default: withCtx(() => [
                      createTextVNode(" Submit ")
                    ]),
                    _: 1
                  })
                ])
              ]),
              _: 1
            }, 512)
          ]),
          _: 1
        }),
        _hoisted_15
      ]);
    };
  }
});
export {
  __pageData,
  _sfc_main as default
};
