globalThis.process ??= {}; globalThis.process.env ??= {};
async function getMod() {
						return import('./placeholder-shopify-app_Bm2NPnai.mjs');
					}
					const collectedLinks = [];
					const collectedStyles = [];
					const defaultMod = { __astroPropagation: true, getMod, collectedLinks, collectedStyles, collectedScripts: [] };

export { defaultMod as default };
