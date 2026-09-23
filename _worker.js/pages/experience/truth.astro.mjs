globalThis.process ??= {}; globalThis.process.env ??= {};
import { b as createAstro, c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead, e as renderSlot, u as unescapeHTML } from '../../chunks/astro/server_BwhXqllw.mjs';
import { $ as $$Base } from '../../chunks/Base_D6ZN1X-D.mjs';
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro("https://malipetek.dev");
const $$Prose = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Prose;
  const { frontmatter = {} } = Astro2.props;
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": frontmatter.title ? `${frontmatter.title} \u2014 malipetek` : "malipetek", "current": frontmatter.current }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<article class="prose"> ${renderSlot($$result2, $$slots["default"])} </article> ` })}`;
}, "/home/runner/work/malipetek.github.io/malipetek.github.io/src/layouts/Prose.astro", void 0);

const html = () => "<h1 id=\"truth\">Truth</h1>\n<p><a href=\"https://truthnyc.com/\">TRUTH NYC</a> is a creative agency that has all kinds of big projects. I have had so many interesting projects there, it changed my view on how software should be built.</p>\n<p>First I made a theme customization on a <a href=\"https://www.lightspeedhq.com/pos/retail/ecommerce/\">Lightspeed eCom</a> store. What is one of a kind project, there is no known workflow for proceeding such thing I invented a way to preview changes.</p>\n<p>I have planned and executed a Shopify migration from a platform I never heard of. Manipulated huge amount of data with nodejs and used Shopify to its limit to match source platforms capabilities. Developed a theme starting from from debut and developed a custom app to add extra functionalities. We also didn’t have 2.0 sections back then so custom app was absolutely necessary.</p>\n<p>I am still contracting projects @ <a href=\"https://truthnyc.com/\">TRUTH NYC</a>, if you need a world class design you can <a href=\"https://truthnyc.com/contact/\">get a quote</a> from them and I would be possibly involved if it is Shopify or some front end heavy stuff.</p>\n<h2 id=\"get-a-quote-from-truth-nyc\"><a class=\"button\" href=\"https://truthnyc.com/contact/\" target=\"_blank\">Get A Quote from TRUTH NYC</a></h2>\n<h2 id=\"truth-nyc\"><a href=\"https://truthnyc.com/\">TRUTH NYC</a></h2>";

				const frontmatter = {"layout":"../../layouts/Prose.astro","title":"TRUTH NYC — the long note","current":"/experience"};
				const file = "/home/runner/work/malipetek.github.io/malipetek.github.io/src/pages/experience/truth.md";
				const url = "/experience/truth";
				function rawContent() {
					return "   \n                                 \n                                  \n                      \n   \n# Truth\n\n[TRUTH NYC](https://truthnyc.com/) is a creative agency that has all kinds of big projects. I have had so many interesting projects there, it changed my view on how software should be built.\n\nFirst I made a theme customization on a [Lightspeed eCom](https://www.lightspeedhq.com/pos/retail/ecommerce/) store. What is one of a kind project, there is no known workflow for proceeding such thing I invented a way to preview changes.\n\nI have planned and executed a Shopify migration from a platform I never heard of. Manipulated huge amount of data with nodejs and used Shopify to its limit to match source platforms capabilities. Developed a theme starting from from debut and developed a custom app to add extra functionalities. We also didn't have 2.0 sections back then so custom app was absolutely necessary.\n\nI am still contracting projects @ [TRUTH NYC](https://truthnyc.com/), if you need a world class design you can [get a quote](https://truthnyc.com/contact/) from them and I would be possibly involved if it is Shopify or some front end heavy stuff.\n\n\n## <a class=\"button\" href=\"https://truthnyc.com/contact/\" target=\"_blank\">Get A Quote from TRUTH NYC</a>\n\n## [TRUTH NYC](https://truthnyc.com/)";
				}
				async function compiledContent() {
					return await html();
				}
				function getHeadings() {
					return [{"depth":1,"slug":"truth","text":"Truth"},{"depth":2,"slug":"get-a-quote-from-truth-nyc","text":"Get A Quote from TRUTH NYC"},{"depth":2,"slug":"truth-nyc","text":"TRUTH NYC"}];
				}

				const Content = createComponent((result, _props, slots) => {
					const { layout, ...content } = frontmatter;
					content.file = file;
					content.url = url;

					return renderTemplate`${renderComponent(result, 'Layout', $$Prose, {
								file,
								url,
								content,
								frontmatter: content,
								headings: getHeadings(),
								rawContent,
								compiledContent,
								'server:root': true,
							}, {
								'default': () => renderTemplate`${unescapeHTML(html())}`
							})}`;
				});

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  Content,
  compiledContent,
  default: Content,
  file,
  frontmatter,
  getHeadings,
  rawContent,
  url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
