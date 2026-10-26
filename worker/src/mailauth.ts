/*
 * Did the receiving server vouch for the visible From address?
 *
 * The envelope sender (MAIL FROM) is trivially forged, so it cannot be what
 * turns an email into a ticket filed as a real client. What can be trusted is
 * the Authentication-Results header the RECEIVING server prepended — the
 * topmost one. A sender can put their own forged copies further down the
 * message, so only the first is read.
 *
 * Accepted when, for the domain of the header From address:
 *   - dmarc=pass with header.from=<that domain>, or
 *   - dkim=pass signed by that domain (header.d=<domain>, or header.i=…@<domain>).
 * SPF alone is not enough: it vouches for the envelope, not the From a human sees.
 */

export interface MailHeader {
  key: string;
  value: string;
}

export interface SenderVerdict {
  ok: boolean;
  /** Which result vouched for it, or why nothing did. */
  reason: string;
}

const domainOf = (address: string) => address.trim().toLowerCase().split('@')[1] ?? '';

/** The `method=result` clauses of one Authentication-Results value, with their properties. */
function clauses(value: string): { method: string; result: string; props: Record<string, string> }[] {
  // Drop parenthesised comments, which may contain ';' or '='.
  const text = value.replace(/\([^()]*\)/g, ' ');
  // The authserv-id (and an ARC instance tag, `i=1`) are not results; a part
  // without `method=result` shape is skipped below anyway.
  const parts = text.split(';');
  return parts.flatMap((part) => {
    const m = part.trim().match(/^([a-z0-9_-]+)\s*=\s*([a-z]+)\b(.*)$/i);
    if (!m) return [];
    const props: Record<string, string> = {};
    for (const p of m[3].matchAll(/([a-z0-9_.-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi)) {
      props[p[1].toLowerCase()] = p[2].replace(/^"|"$/g, '').toLowerCase();
    }
    return [{ method: m[1].toLowerCase(), result: m[2].toLowerCase(), props }];
  });
}

export function verifySender(headers: MailHeader[], fromAddress: string): SenderVerdict {
  const domain = domainOf(fromAddress);
  if (!domain) return { ok: false, reason: 'no From address' };
  // Some receivers record their verdict only in their ARC set; either way the
  // receiver prepends, so whichever comes first is theirs.
  const top = headers.find((h) => /^(arc-)?authentication-results$/i.test(h.key));
  if (!top) return { ok: false, reason: 'no Authentication-Results from the receiving server' };

  const results = clauses(top.value);
  if (results.some((r) => r.method === 'dmarc' && r.result === 'pass' && r.props['header.from'] === domain)) {
    return { ok: true, reason: 'dmarc=pass' };
  }
  const dkim = results.find(
    (r) =>
      r.method === 'dkim' &&
      r.result === 'pass' &&
      (r.props['header.d'] === domain || (r.props['header.i'] ?? '').endsWith(`@${domain}`)),
  );
  if (dkim) return { ok: true, reason: 'dkim=pass' };
  const seen = results.map((r) => `${r.method}=${r.result}`).join(' ') || 'nothing';
  return { ok: false, reason: `not vouched for ${domain} (${seen})` };
}
