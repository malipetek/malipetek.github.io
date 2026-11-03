#!/usr/bin/env node
/*
 * Regenerate the email sections of marketing/launch/outreach.md from SEQUENCES in
 * src/marketing.ts, the copy that is actually sent. Run from worker/:
 *   node --experimental-strip-types --no-warnings scripts/build-outreach.mjs
 */
const { SEQUENCES } = await import(process.cwd() + '/src/marketing.ts');
import { readFileSync, writeFileSync } from 'node:fs';
const file = '../marketing/launch/outreach.md';
const md = readFileSync(file, 'utf8');
const marker = md.indexOf('<!-- Generated from SEQUENCES');
const start = marker >= 0 ? marker : md.indexOf('## Warm: past collaborators');
const end = md.indexOf('## LinkedIn DM');
if (start < 0 || end < 0) throw new Error('markers not found');
const ph = (t) => t.replaceAll('{{greeting}}', 'Hi {name},').replace(/\{\{(\w+)\}\}/g, '{$1}');
const quote = (t) => ph(t).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
const intro = {
  warm: ['## Warm: past collaborators and people who know the work', 'Use for Customily, TRUTH NYC, PAX Digital, Bemeir, and personal contacts.'],
  cold_a: ['## Cold A: someone who built it with AI', 'For a site or app with the marks of a fast AI build: inconsistent spacing, a\nplaceholder that made it live, a form that does nothing, a mobile layout that\nbreaks.'],
  cold_b: ['## Cold B: a business owner with a small list', 'For a local business, a small shop, a restaurant or a studio: someone with a\nsite that is mostly fine and a list of small things that never get done.'],
  nosite: ['## No website: an email on the map, no site', 'For a business OpenStreetMap lists with an email and no website\n(`marketing/prospector/osm.mjs` writes these to a `-mail-only-` CSV).'],
};
const names = { first: 'First email', followup_1: 'Follow-up, day 4', followup_2: 'Follow-up, day 10' };
let out = '<!-- Generated from SEQUENCES in worker/src/marketing.ts (the copy that is sent). Edit the templates there, then run `node --experimental-strip-types --no-warnings scripts/build-outreach.mjs` in worker/ and press "Re-render scheduled" in Admin → Marketing. -->\n\n';
for (const kind of ['warm', 'cold_a', 'cold_b', 'nosite']) {
  const [h, who] = intro[kind];
  out += `${h}\n\n${who}\n\n`;
  for (const step of SEQUENCES[kind]) {
    out += `### ${names[step.kind] ?? step.kind}\n\n**Subject:** ${ph(step.subject)}\n\n${quote(step.body)}\n\n`;
    if (step.plain) out += `Without a written observation, the queue sends this instead (it makes no claim about the site):\n\n${quote(step.plain)}\n\n`;
  }
  out += '---\n\n';
}
writeFileSync(file, md.slice(0, start) + out + md.slice(end));
console.log('written', out.length);
