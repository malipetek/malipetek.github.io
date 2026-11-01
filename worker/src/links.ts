/*
 * Absolute portal links, for agents. A code agent on a node cannot point at a
 * relative address, and the intake agent's replies are read in the portal and
 * by email. One helper so every agent gives the same place.
 */
import type { Env } from './shared.ts';

export function portalLinks(env: Env) {
  const base = (env.SITE_URL || 'https://malipetek.dev').replace(/\/+$/, '');
  return {
    connections: `${base}/portal/#/connections`,
    requests: `${base}/portal/#/requests`,
    billing: `${base}/portal/#/billing`,
    project: (id: string) => `${base}/portal/#/project/${id}`,
    ticket: (id: number | string) => `${base}/portal/#/ticket/${id}`,
  };
}
