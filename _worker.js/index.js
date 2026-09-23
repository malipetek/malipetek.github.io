globalThis.process ??= {}; globalThis.process.env ??= {};
import { renderers } from './renderers.mjs';
import { c as createExports, s as serverEntrypointModule } from './chunks/_@astrojs-ssr-adapter_N4Qi8b7z.mjs';
import { manifest } from './manifest_BiqhjOKs.mjs';

const serverIslandMap = new Map();;

const _page0 = () => import('./pages/_image.astro.mjs');
const _page1 = () => import('./pages/404.astro.mjs');
const _page2 = () => import('./pages/api/keystatic/_---params_.astro.mjs');
const _page3 = () => import('./pages/blog/_slug_.astro.mjs');
const _page4 = () => import('./pages/blog.astro.mjs');
const _page5 = () => import('./pages/experience/truth.astro.mjs');
const _page6 = () => import('./pages/experience.astro.mjs');
const _page7 = () => import('./pages/keystatic/_---params_.astro.mjs');
const _page8 = () => import('./pages/pdfextractor/privacy-policy.astro.mjs');
const _page9 = () => import('./pages/pdfextractor/terms-of-service.astro.mjs');
const _page10 = () => import('./pages/privacy-policy.astro.mjs');
const _page11 = () => import('./pages/projects/_slug_.astro.mjs');
const _page12 = () => import('./pages/terms-of-service.astro.mjs');
const _page13 = () => import('./pages/index.astro.mjs');
const pageMap = new Map([
    ["node_modules/.pnpm/@astrojs+cloudflare@12.6.13_@types+node@24.13.4_astro@5.18.2_@types+node@24.13.4_idb-keyval@6_jpj6khduidgatoyn6iysvltgnq/node_modules/@astrojs/cloudflare/dist/entrypoints/image-endpoint.js", _page0],
    ["src/pages/404.astro", _page1],
    ["node_modules/.pnpm/@keystatic+astro@5.2.0_@keystatic+core@0.6.9_@keystar+ui@0.10.0_react-aria@3.50.0_react-dom@1_6jkmiibtrn5mkfwqipl2arpcza/node_modules/@keystatic/astro/internal/keystatic-api.js", _page2],
    ["src/pages/blog/[slug].astro", _page3],
    ["src/pages/blog/index.astro", _page4],
    ["src/pages/experience/truth.md", _page5],
    ["src/pages/experience.astro", _page6],
    ["node_modules/.pnpm/@keystatic+astro@5.2.0_@keystatic+core@0.6.9_@keystar+ui@0.10.0_react-aria@3.50.0_react-dom@1_6jkmiibtrn5mkfwqipl2arpcza/node_modules/@keystatic/astro/internal/keystatic-astro-page.astro", _page7],
    ["src/pages/pdfextractor/privacy-policy.md", _page8],
    ["src/pages/pdfextractor/terms-of-service.md", _page9],
    ["src/pages/privacy-policy.md", _page10],
    ["src/pages/projects/[slug].astro", _page11],
    ["src/pages/terms-of-service.md", _page12],
    ["src/pages/index.astro", _page13]
]);

const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    actions: () => import('./noop-entrypoint.mjs'),
    middleware: () => import('./_astro-internal_middleware.mjs')
});
const _args = undefined;
const _exports = createExports(_manifest);
const __astrojsSsrVirtualEntry = _exports.default;
const _start = 'start';
if (Object.prototype.hasOwnProperty.call(serverEntrypointModule, _start)) {
	serverEntrypointModule[_start](_manifest, _args);
}

export { __astrojsSsrVirtualEntry as default, pageMap };
