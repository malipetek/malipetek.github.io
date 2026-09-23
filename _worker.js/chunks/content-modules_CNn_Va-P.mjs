globalThis.process ??= {}; globalThis.process.env ??= {};
const contentModules = new Map([
["src/content/projects/placeholder-game.mdoc", () => import('./placeholder-game_Dd6sNMe9.mjs')],
["src/content/projects/placeholder-shopify-app.mdoc", () => import('./placeholder-shopify-app_DslcyZaN.mjs')],
["src/content/projects/placeholder-tool.mdoc", () => import('./placeholder-tool_DhdBEqoO.mjs')]]);

export { contentModules as default };
