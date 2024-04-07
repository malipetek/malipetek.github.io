import { _ as _export_sfc, o as openBlock, c as createElementBlock, a as createStaticVNode, b as createBaseVNode } from "./app.58ffe7f5.js";
const __pageData = JSON.parse('{"title":"Old trick to use state on web pages without any js","description":null,"frontmatter":{"title":"Old trick to use state on web pages without any js","description":null,"summary":null,"keywords":null,"image":null},"headers":[{"level":2,"title":"Labels and inputs","slug":"labels-and-inputs","link":"#labels-and-inputs","children":[]},{"level":2,"title":"Checkbox","slug":"checkbox","link":"#checkbox","children":[]},{"level":2,"title":":checked state","slug":"checked-state","link":"#checked-state","children":[]},{"level":2,"title":"~ Selector","slug":"selector","link":"#selector","children":[]}],"relativePath":"blog/web/CSS only toggleables.md"}');
const _sfc_main = { name: "blog/web/CSS only toggleables.md" };
const _hoisted_1 = /* @__PURE__ */ createStaticVNode('<h1 id="toggle-something-on-a-web-page-without-js" tabindex="-1">Toggle something on a Web page without JS <a class="header-anchor" href="#toggle-something-on-a-web-page-without-js" aria-hidden="true">#</a></h1><p>If you are gaining experience in CSS and trying the limits of CSS, this trick will make you think CSS more powerful than ever before. Some years ago I learned this trick from <a href="http://travisneilson.com/">Travis Neilson</a> in this <a href="https://www.youtube.com/watch?v=d4P8s-mkMvs">video</a>.</p><p>We all know how you can use transitions and hover to change state of a element to create some interactivity. What if I told you you can make it toggle instead of temporarily changing state.</p><h2 id="labels-and-inputs" tabindex="-1">Labels and inputs <a class="header-anchor" href="#labels-and-inputs" aria-hidden="true">#</a></h2><p>To understand this trick, first thing you should know is <code>&lt;input&gt;</code> tags are binded to their labels with <code>id</code> and <code>for</code> properties.</p><p>Lets say you have a text input with <code>id=&quot;mytext&quot;</code>, when you click on a <code>&lt;label&gt;</code> with <code>for=&quot;mytext&quot;</code> it behaves just like you clicked <code>&lt;input&gt;</code>.</p><h2 id="checkbox" tabindex="-1">Checkbox <a class="header-anchor" href="#checkbox" aria-hidden="true">#</a></h2><p>So in our case we will be using a <code>&lt;input&gt;</code> with <code>type=&quot;checkbox</code> to toggle stuff. And toggler will be a <code>&lt;label&gt;</code> with <code>for=&quot;[id of input]&quot;</code>.</p><h2 id="checked-state" tabindex="-1">:checked state <a class="header-anchor" href="#checked-state" aria-hidden="true">#</a></h2><p>In css we have a pseudo selector <code>:checked</code>. It applies some styles only when a <code>&lt;input type=&quot;checkbox&quot;&gt;</code> is checked. This allows us to apply some styles with permanent states not only to <code>&lt;input&gt;</code> itself, but also its siblings and children.</p><p>However <code>&lt;input&gt;</code> tags cant have any children. Here we use these CSS selectors to enhance our selection; <code>~</code>.</p><h2 id="selector" tabindex="-1">~ Selector <a class="header-anchor" href="#selector" aria-hidden="true">#</a></h2><p><a href="https://www.w3schools.com/cssref/sel_gen_sibling.asp">~ Selector</a> is a selector that looks back in a siblings situation and checks if a selector has another selector before it among its siblings.</p><p>For example if we had a html like this:</p><div class="language-html"><button title="Copy Code" class="copy"></button><span class="lang">html</span><pre class="shiki github-dark" tabindex="0"><code><span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">class</span><span style="color:#E1E4E8;">=</span><span style="color:#9ECBFF;">&quot;key&quot;</span><span style="color:#E1E4E8;">&gt;key&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">class</span><span style="color:#E1E4E8;">=</span><span style="color:#9ECBFF;">&quot;lock&quot;</span><span style="color:#E1E4E8;">&gt;lock&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">  &lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">   &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">    &lt;</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">class</span><span style="color:#E1E4E8;">=</span><span style="color:#9ECBFF;">&quot;lock&quot;</span><span style="color:#E1E4E8;">&gt;lock&lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"><span style="color:#E1E4E8;">  &lt;/</span><span style="color:#85E89D;">div</span><span style="color:#E1E4E8;">&gt;</span></span>\n<span class="line"></span></code></pre></div><p>We could select only first <code>&lt;div&gt;</code> with class &quot;lock&quot; with this selector.</p><div class="language-css"><button title="Copy Code" class="copy"></button><span class="lang">css</span><pre class="shiki github-dark" tabindex="0"><code><span class="line"><span style="color:#B392F0;">.key</span><span style="color:#F97583;">~</span><span style="color:#B392F0;">.lock</span><span style="color:#E1E4E8;">{</span></span>\n<span class="line"><span style="color:#E1E4E8;">  </span><span style="color:#79B8FF;">color</span><span style="color:#E1E4E8;">: </span><span style="color:#79B8FF;">red</span><span style="color:#E1E4E8;">;</span></span>\n<span class="line"><span style="color:#E1E4E8;">}</span></span>\n<span class="line"></span></code></pre></div><p>See example here:</p>', 18);
const _hoisted_19 = /* @__PURE__ */ createBaseVNode("iframe", {
  height: "332",
  style: { "width": "100%" },
  scrolling: "no",
  title: "CSS ~ selector example",
  src: "https://codepen.io/malipetek/embed/xxwrOow?height=332&theme-id=dark&default-tab=css,result",
  frameborder: "no",
  allowtransparency: "true",
  allowfullscreen: "true",
  loading: "lazy"
}, "\n  See the Pen <a href='https://codepen.io/malipetek/pen/xxwrOow'>CSS ~ selector example</a> by muhammet ali petek\n  (<a href='https://codepen.io/malipetek'>@malipetek</a>) on <a href='https://codepen.io'>CodePen</a>.\n", -1);
const _hoisted_20 = /* @__PURE__ */ createBaseVNode("hr", null, null, -1);
const _hoisted_21 = /* @__PURE__ */ createBaseVNode("p", null, "Once we select a element after some sibling, we can also select children of selection which is handy because we can make this our main wrapper on page and toggle any styles on our page with this stateful selector.", -1);
const _hoisted_22 = /* @__PURE__ */ createBaseVNode("p", null, "Here is an example on Codepen demonstrating it:", -1);
const _hoisted_23 = /* @__PURE__ */ createBaseVNode("iframe", {
  height: "455",
  style: { "width": "100%" },
  scrolling: "no",
  title: "CSS toggle stuff",
  src: "https://codepen.io/malipetek/embed/mdemGPX?height=455&theme-id=dark&default-tab=result",
  frameborder: "no",
  allowtransparency: "true",
  allowfullscreen: "true",
  loading: "lazy"
}, "\n  See the Pen <a href='https://codepen.io/malipetek/pen/mdemGPX'>CSS toggle stuff</a> by muhammet ali petek\n  (<a href='https://codepen.io/malipetek'>@malipetek</a>) on <a href='https://codepen.io'>CodePen</a>.\n", -1);
const _hoisted_24 = /* @__PURE__ */ createBaseVNode("p", null, "Also you can go wild it like in below example:", -1);
const _hoisted_25 = /* @__PURE__ */ createBaseVNode("iframe", {
  height: "429",
  style: { "width": "100%" },
  scrolling: "no",
  title: "CSS only desktop",
  src: "https://codepen.io/malipetek/embed/PoPJNWx?height=429&theme-id=dark&default-tab=result",
  frameborder: "no",
  allowtransparency: "true",
  allowfullscreen: "true",
  loading: "lazy"
}, "\n  See the Pen <a href='https://codepen.io/malipetek/pen/PoPJNWx'>CSS only desktop</a> by muhammet ali petek\n  (<a href='https://codepen.io/malipetek'>@malipetek</a>) on <a href='https://codepen.io'>CodePen</a>.\n", -1);
const _hoisted_26 = /* @__PURE__ */ createBaseVNode("p", null, "If you check above examples code you will see it has a html soup.", -1);
const _hoisted_27 = /* @__PURE__ */ createBaseVNode("p", null, "You probably would use this trick only for navigation sidebars, modals etc.", -1);
const _hoisted_28 = [
  _hoisted_1,
  _hoisted_19,
  _hoisted_20,
  _hoisted_21,
  _hoisted_22,
  _hoisted_23,
  _hoisted_24,
  _hoisted_25,
  _hoisted_26,
  _hoisted_27
];
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return openBlock(), createElementBlock("div", null, _hoisted_28);
}
const CSS_only_toggleables = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  CSS_only_toggleables as default
};
