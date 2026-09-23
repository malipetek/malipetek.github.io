import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
const p = openrouterProvider();
console.log('provider', p.id, 'models:', p.getModels().length);
console.log('auth keys:', Object.keys(p.auth));
for (const arg of [{}, { signal: AbortSignal.timeout(5000) }, undefined]) {
  try {
    const r = await p.auth.apiKey.resolve(arg);
    console.log('resolve', JSON.stringify(arg && Object.keys(arg)), '→', JSON.stringify(r).slice(0, 160));
  } catch (e) { console.log('resolve err:', e.message); }
}
