import type { Verifier } from './solutions.ts';

// Replaced by the provider verifiers in the integration verification changeset.
export const verifyIntegration: Verifier = async () => ({ ok: false, error: 'not_implemented' });
