globalThis.process ??= {}; globalThis.process.env ??= {};
import { renderers } from './renderers.mjs';
import { createExports } from './_@astrojs-ssr-adapter.mjs';
import { manifest } from './manifest_Dw9T0gtj.mjs';

const _page0 = () => import('./pages/_image.astro.mjs');
const _page1 = () => import('./pages/api/keystatic/_---params_.astro.mjs');
const _page2 = () => import('./pages/keystatic/_---params_.astro.mjs');
const _page3 = () => import('./pages/agents.astro.mjs');
const _page4 = () => import('./pages/blog/_category_/_slug_.astro.mjs');
const _page5 = () => import('./pages/blog/_category_.astro.mjs');
const _page6 = () => import('./pages/blog.astro.mjs');
const _page7 = () => import('./pages/blog/_---slug_.astro.mjs');
const _page8 = () => import('./pages/chat.astro.mjs');
const _page9 = () => import('./pages/chatbotstack.astro.mjs');
const _page10 = () => import('./pages/checkout/_slug_.astro.mjs');
const _page11 = () => import('./pages/contact.astro.mjs');
const _page12 = () => import('./pages/distance-sales-agreement.astro.mjs');
const _page13 = () => import('./pages/experience/truth.astro.mjs');
const _page14 = () => import('./pages/experience.astro.mjs');
const _page15 = () => import('./pages/now.astro.mjs');
const _page16 = () => import('./pages/pdfextractor/privacy-policy.astro.mjs');
const _page17 = () => import('./pages/pdfextractor/terms-of-service.astro.mjs');
const _page18 = () => import('./pages/preliminary-information-form.astro.mjs');
const _page19 = () => import('./pages/privacy-policy.astro.mjs');
const _page20 = () => import('./pages/products/_slug_.astro.mjs');
const _page21 = () => import('./pages/products.astro.mjs');
const _page22 = () => import('./pages/projects.astro.mjs');
const _page23 = () => import('./pages/refund-cancellation-policy.astro.mjs');
const _page24 = () => import('./pages/resume.astro.mjs');
const _page25 = () => import('./pages/services/_slug_.astro.mjs');
const _page26 = () => import('./pages/services.astro.mjs');
const _page27 = () => import('./pages/sitemap.xml.astro.mjs');
const _page28 = () => import('./pages/store/_slug_.astro.mjs');
const _page29 = () => import('./pages/store.astro.mjs');
const _page30 = () => import('./pages/terms-of-service.astro.mjs');
const _page31 = () => import('./pages/work-with-me.astro.mjs');
const _page32 = () => import('./pages/index.astro.mjs');

const pageMap = new Map([
    ["node_modules/.pnpm/astro@4.16.19_@types+node@24.12.4_rollup@4.60.4_typescript@5.9.3/node_modules/astro/dist/assets/endpoint/generic.js", _page0],
    ["node_modules/.pnpm/@keystatic+astro@5.1.0_@keystatic+core@0.5.50_@react-spectrum+provider@3.11.1_react-dom@19.2._njosf2cdxm5wdoic2xmpuerh54/node_modules/@keystatic/astro/internal/keystatic-api.js", _page1],
    ["node_modules/.pnpm/@keystatic+astro@5.1.0_@keystatic+core@0.5.50_@react-spectrum+provider@3.11.1_react-dom@19.2._njosf2cdxm5wdoic2xmpuerh54/node_modules/@keystatic/astro/internal/keystatic-astro-page.astro", _page2],
    ["src/pages/agents.astro", _page3],
    ["src/pages/blog/[category]/[slug].astro", _page4],
    ["src/pages/blog/[category]/index.astro", _page5],
    ["src/pages/blog/index.astro", _page6],
    ["src/pages/blog/[...slug].astro", _page7],
    ["src/pages/chat.astro", _page8],
    ["src/pages/chatbotstack.astro", _page9],
    ["src/pages/checkout/[slug].astro", _page10],
    ["src/pages/contact.astro", _page11],
    ["src/pages/distance-sales-agreement.md", _page12],
    ["src/pages/experience/truth.md", _page13],
    ["src/pages/experience.astro", _page14],
    ["src/pages/now.astro", _page15],
    ["src/pages/pdfextractor/privacy-policy.md", _page16],
    ["src/pages/pdfextractor/terms-of-service.md", _page17],
    ["src/pages/preliminary-information-form.md", _page18],
    ["src/pages/privacy-policy.md", _page19],
    ["src/pages/products/[slug].astro", _page20],
    ["src/pages/products.astro", _page21],
    ["src/pages/projects.astro", _page22],
    ["src/pages/refund-cancellation-policy.md", _page23],
    ["src/pages/resume.astro", _page24],
    ["src/pages/services/[slug].astro", _page25],
    ["src/pages/services.astro", _page26],
    ["src/pages/sitemap.xml.ts", _page27],
    ["src/pages/store/[slug].astro", _page28],
    ["src/pages/store.astro", _page29],
    ["src/pages/terms-of-service.md", _page30],
    ["src/pages/work-with-me.astro", _page31],
    ["src/pages/index.astro", _page32]
]);
const serverIslandMap = new Map();
const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    middleware: () => import('./_astro-internal_middleware.mjs')
});
const _exports = createExports(_manifest);
const __astrojsSsrVirtualEntry = _exports.default;

export { __astrojsSsrVirtualEntry as default, pageMap };
