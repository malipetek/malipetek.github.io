/*
 * Amazon SES v2, from a Worker: one signed POST per email, no SDK.
 *
 * The outreach desk can send through Cloudflare's MARKETING binding or through
 * SES (Admin → Marketing → Settings → Sender). SES is the one with volume: the
 * account is out of the sandbox in us-east-1 with a 50,000/day quota, and
 * malipetek.dev is a verified, DKIM-signing identity there.
 *
 * Bounces and complaints come back by email: the identity has feedback
 * forwarding on, so SES mails them to the From address (hello@), and the
 * inbound router reads them like any other DSN or ARF report.
 */
import type { Env } from './shared.ts';

export interface SesMail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  headers?: { name: string; value: string }[];
}

export function sesConfigured(env: Env): boolean {
  return Boolean(env.AWS_SES_ACCESS_KEY_ID && env.AWS_SES_SECRET_ACCESS_KEY);
}

const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
}

export interface SignInput {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  body: string;
  headers: Record<string, string>;
  /** `YYYYMMDDTHHMMSSZ`; the current time when left out. */
  amzDate?: string;
}

/**
 * AWS Signature Version 4. Returns the headers to send: the ones given, plus
 * host, x-amz-date and authorization. Every given header is signed.
 */
export async function signV4(input: SignInput): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const amzDate = input.amzDate ?? new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: url.host, 'x-amz-date': amzDate };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const query = [...url.searchParams]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    input.method,
    url.pathname || '/',
    query,
    names.map((name) => `${name}:${lower[name]}\n`).join(''),
    names.join(';'),
    await sha256(input.body),
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let key = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), day);
  key = await hmac(key, input.region);
  key = await hmac(key, input.service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, toSign));
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

/** The SendEmail request body: a simple message, our own headers on it. */
export function sesBody(mail: SesMail, configurationSet?: string): string {
  return JSON.stringify({
    FromEmailAddress: mail.from,
    Destination: { ToAddresses: [mail.to] },
    ...(mail.replyTo ? { ReplyToAddresses: [mail.replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: mail.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
        ...(mail.headers?.length ? { Headers: mail.headers.map((h) => ({ Name: h.name, Value: h.value })) } : {}),
      },
    },
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
  });
}

/** Send one email. Resolves to SES's message id; throws with SES's own reason. */
export async function sesSend(env: Env, mail: SesMail): Promise<string> {
  if (!sesConfigured(env)) throw new Error('ses_unconfigured');
  const region = env.AWS_SES_REGION || 'us-east-1';
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const body = sesBody(mail, env.AWS_SES_CONFIGURATION_SET);
  const headers = await signV4({
    method: 'POST',
    url,
    region,
    service: 'ses',
    accessKeyId: env.AWS_SES_ACCESS_KEY_ID!,
    secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY!,
    body,
    headers: { 'content-type': 'application/json' },
  });
  delete headers.host; // fetch sets it; signing needed it
  const res = await fetch(url, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) {
    let reason = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: string; Message?: string };
      reason = parsed.message ?? parsed.Message ?? reason;
    } catch {
      /* not JSON: keep the text */
    }
    throw new Error(`ses_${res.status}: ${reason}`);
  }
  try {
    return (JSON.parse(text) as { MessageId?: string }).MessageId ?? '';
  } catch {
    return '';
  }
}
