/*
 * Client integrations: does a client's credential actually work?
 *
 * One cheap, read-only call per vendor — no writes except the Google Play edit
 * that is deleted again straight away. Runs inside a Cloudflare Worker, so it
 * uses WebCrypto only: no Node APIs, no npm dependencies.
 *
 * Rules that keep this safe to call with whatever an admin pasted in:
 * - nothing throws; a bad key, a dead network or a weird response all come back
 *   as { ok: false, error }
 * - every request is aborted after 10s
 * - error text never echoes a field value, so a token cannot leak into a log
 *   line; success details only use names and counts the vendor itself reports
 */

export interface VerifyResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

type Fields = Record<string, string>;
type Fetch = typeof fetch;

/** Every vendor call gets this long, then the request is aborted. */
const REQUEST_TIMEOUT_MS = 10_000;

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ fields */

function value(fields: Fields, name: string): string {
  const raw = fields?.[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** The first required field that is absent or blank, as `missing NAME`. */
function missing(fields: Fields, ...names: string[]): string | undefined {
  for (const name of names) if (!value(fields, name)) return `missing ${name}`;
  return undefined;
}

/** Replace every field value in a message, so no secret can be echoed. */
function scrub(text: string, fields: Fields): string {
  let out = String(text ?? '');
  for (const item of scrubbableValues(fields)) out = out.split(item).join('[redacted]');
  // Belt and braces for values that came back from a vendor rather than the fields.
  out = out.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]');
  out = out.replace(/(AKIA|ASIA)[A-Z0-9]{16}/g, '[redacted]');
  return out.trim().slice(0, 200);
}

/**
 * Everything in the fields that must not reach an error message: the values
 * themselves, their longer lines (a PEM is one value but many lines), and the
 * leaves of a JSON field such as a service-account key.
 */
function scrubbableValues(fields: Fields): string[] {
  const found = new Set<string>();
  function add(raw: unknown): void {
    if (typeof raw !== 'string' || !raw) return;
    if (raw.trim().length >= 3) found.add(raw);
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length >= 8) found.add(trimmed);
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        collect(JSON.parse(trimmed));
      } catch {
        // Not JSON after all; the raw value is already in the list.
      }
    }
  }
  function collect(node: unknown): void {
    if (typeof node === 'string') add(node);
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
  }
  for (const raw of Object.values(fields ?? {})) add(raw);
  return [...found].sort((a, b) => b.length - a.length);
}

function errorMessage(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidates: unknown[] = [body.error_description, body.message, body.error];
  if (typeof body.errors === 'string') candidates.push(body.errors);
  if (body.error && typeof body.error === 'object') candidates.push(body.error.message);
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    if (first && typeof first === 'object') candidates.push(first.message, first.detail, first.title);
    else candidates.push(first);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 160);
  }
  return undefined;
}

function httpFailure(provider: string, status: number, body: any, fields: Fields): VerifyResult {
  const message = errorMessage(body);
  return {
    ok: false,
    error: message ? `${provider}: HTTP ${status} ${scrub(message, fields)}` : `${provider}: HTTP ${status}`,
  };
}

function badResponse(provider: string, body: any, fields: Fields): VerifyResult {
  const message = errorMessage(body);
  return { ok: false, error: `${provider}: ${scrub(message ?? 'unexpected response', fields)}` };
}

/* --------------------------------------------------------------- transport */

/**
 * One request with the 10s cap. A thrown fetch (offline, DNS, abort) propagates
 * to the top-level catch, which turns it into a plain error string.
 */
async function send(fetchImpl: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`timeout after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function readJson(res: Response): Promise<any> {
  const text = await readText(res);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- encodings */

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
}

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return b64url(encoder.encode(JSON.stringify(value)));
}

/**
 * A PEM PKCS#8 key as bytes. Armor, newlines (real or the `\n` an env var
 * carries) and any accidental wrapping are discarded.
 */
function pemToBytes(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) throw new Error('private key is empty');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/* ---------------------------------------------------------------------- JWT */

async function signJwt(
  algorithm: 'ES256' | 'RS256',
  key: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const data = encoder.encode(signingInput);
  const signature =
    algorithm === 'ES256'
      ? await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data)
      : await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  // WebCrypto ECDSA output is already r||s (IEEE P1363), which is what JWS wants.
  return `${signingInput}.${b64url(signature)}`;
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/* ------------------------------------------------------------------- SigV4 */

export interface SignV4Input {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  /** `YYYYMMDDTHHMMSSZ`; now when omitted. */
  date?: string | Date;
}

function amzDate(value?: string | Date): string {
  if (!value) return formatAmzDate(new Date());
  if (value instanceof Date) return formatAmzDate(value);
  const text = value.trim();
  if (/^\d{8}T\d{6}Z$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid signature date');
  return formatAmzDate(parsed);
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 3986 encoding, as SigV4 requires (encodeURIComponent is close). */
function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(pathname: string): string {
  const path = pathname || '/';
  return path.split('/').map(awsEncode).join('/') || '/';
}

function canonicalQuery(search: string): string {
  const pairs: [string, string][] = [];
  for (const [key, item] of new URLSearchParams(search)) pairs.push([awsEncode(key), awsEncode(item)]);
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([key, item]) => `${key}=${item}`).join('&');
}

/**
 * AWS Signature Version 4. Pure: no clock, no fetch, no globals beyond WebCrypto.
 * Returns the headers to send: the caller's, plus host, x-amz-date, a session
 * token when given, and the authorization header.
 */
export async function signV4(input: SignV4Input): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const date = amzDate(input.date);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  headers.host = url.host;
  headers['x-amz-date'] = date;
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;

  const normalized: Record<string, string> = {};
  for (const [name, item] of Object.entries(headers)) normalized[name.toLowerCase()] = String(item).trim().replace(/\s+/g, ' ');
  const names = Object.keys(normalized).sort();
  const canonicalHeaders = names.map((name) => `${name}:${normalized[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const payload = input.body ?? '';
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.search),
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(payload),
  ].join('\n');

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256Hex(canonicalRequest)].join('\n');

  let key = await hmacSha256(encoder.encode(`AWS4${input.secretAccessKey}`), day);
  key = await hmacSha256(key, input.region);
  key = await hmacSha256(key, input.service);
  key = await hmacSha256(key, 'aws4_request');
  const signature = hex(await hmacSha256(key, stringToSign));

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/* ---------------------------------------------------------------- shopping */

async function verifyShopify(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN');
  if (absent) return { ok: false, error: absent };
  const domain = value(fields, 'SHOPIFY_STORE_DOMAIN');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    return { ok: false, error: 'invalid SHOPIFY_STORE_DOMAIN' };
  }
  const res = await send(fetchImpl, `https://${domain}/admin/api/2025-10/shop.json`, {
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': value(fields, 'SHOPIFY_ADMIN_TOKEN'), Accept: 'application/json' },
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('shopify', res.status, body, fields);
  const shop = body?.shop ?? {};
  const name = typeof shop.name === 'string' && shop.name.trim() ? shop.name.trim() : domain;
  const host = typeof shop.myshopify_domain === 'string' && shop.myshopify_domain.trim() ? shop.myshopify_domain.trim() : domain;
  return { ok: true, detail: `Shop: ${name} (${host})` };
}

/* ------------------------------------------------------- app-store-connect */

async function verifyAppStoreConnect(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY');
  if (absent) return { ok: false, error: absent };
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(value(fields, 'ASC_PRIVATE_KEY')),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const issuedAt = epochSeconds();
  const jwt = await signJwt(
    'ES256',
    key,
    { alg: 'ES256', kid: value(fields, 'ASC_KEY_ID'), typ: 'JWT' },
    { iss: value(fields, 'ASC_ISSUER_ID'), iat: issuedAt, exp: issuedAt + 1200, aud: 'appstoreconnect-v1' },
  );
  const res = await send(fetchImpl, 'https://api.appstoreconnect.apple.com/v1/apps?limit=5', {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('app-store-connect', res.status, body, fields);
  if (!Array.isArray(body?.data)) return badResponse('app-store-connect', body, fields);
  return { ok: true, detail: `${body.data.length} apps` };
}

/* ------------------------------------------------------------ google cloud */

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
}

function parseServiceAccount(fieldName: string, raw: string): ServiceAccount | string {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return `invalid ${fieldName}`;
  }
  const clientEmail = typeof data?.client_email === 'string' ? data.client_email.trim() : '';
  const privateKey = typeof data?.private_key === 'string' ? data.private_key : '';
  if (!clientEmail || !privateKey) return `invalid ${fieldName}`;
  return {
    clientEmail,
    privateKey,
    privateKeyId: typeof data?.private_key_id === 'string' && data.private_key_id ? data.private_key_id : undefined,
  };
}

/** Sign a service-account assertion and trade it for an access token. */
async function googleAccessToken(
  fields: Fields,
  fetchImpl: Fetch,
  account: ServiceAccount,
  scope: string,
): Promise<{ token: string } | VerifyResult> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const issuedAt = epochSeconds();
  const header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' };
  if (account.privateKeyId) header.kid = account.privateKeyId;
  const assertion = await signJwt('RS256', key, header, {
    iss: account.clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const res = await send(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('google', res.status, body, fields);
  const token = typeof body?.access_token === 'string' ? body.access_token : '';
  if (!token) return { ok: false, error: 'google: no access_token' };
  return { token };
}

async function verifyGooglePlay(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (absent) return { ok: false, error: absent };
  const account = parseServiceAccount('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', value(fields, 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'));
  if (typeof account === 'string') return { ok: false, error: account };

  const granted = await googleAccessToken(
    fields,
    fetchImpl,
    account,
    'https://www.googleapis.com/auth/androidpublisher',
  );
  if (!('token' in granted)) return granted;

  const packageName = value(fields, 'GOOGLE_PLAY_PACKAGE_NAME');
  if (!packageName) return { ok: true, detail: `Google Play: token ok (${account.clientEmail})` };

  const editsUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits`;
  const opened = await send(fetchImpl, editsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${granted.token}`, Accept: 'application/json' },
  });
  const edit = await readJson(opened);
  if (!opened.ok) return httpFailure('google-play', opened.status, edit, fields);
  const editId = typeof edit?.id === 'string' ? edit.id : '';
  if (!editId) return badResponse('google-play', edit, fields);

  const closed = await send(fetchImpl, `${editsUrl}/${encodeURIComponent(editId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${granted.token}` },
  });
  if (!closed.ok) return httpFailure('google-play', closed.status, await readJson(closed), fields);
  return { ok: true, detail: `Google Play: ${packageName} edit opened and deleted (${account.clientEmail})` };
}

async function verifyGcp(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'GCP_SERVICE_ACCOUNT_JSON', 'GCP_PROJECT_ID');
  if (absent) return { ok: false, error: absent };
  const account = parseServiceAccount('GCP_SERVICE_ACCOUNT_JSON', value(fields, 'GCP_SERVICE_ACCOUNT_JSON'));
  if (typeof account === 'string') return { ok: false, error: account };

  const granted = await googleAccessToken(
    fields,
    fetchImpl,
    account,
    'https://www.googleapis.com/auth/cloud-platform.read-only',
  );
  if (!('token' in granted)) return granted;

  const projectId = value(fields, 'GCP_PROJECT_ID');
  const res = await send(fetchImpl, `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${granted.token}`, Accept: 'application/json' },
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('gcp', res.status, body, fields);
  const id = typeof body?.projectId === 'string' && body.projectId ? body.projectId : projectId;
  const state = typeof body?.lifecycleState === 'string' && body.lifecycleState ? body.lifecycleState : 'ACTIVE';
  return { ok: true, detail: `Project: ${id} (${state})` };
}

/* ---------------------------------------------------------------------- AWS */

const STS_URL = 'https://sts.amazonaws.com/';
const STS_REGION = 'us-east-1';
const STS_SERVICE = 'sts';

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function xmlValue(xml: string, tag: string): string | undefined {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`);
  const match = pattern.exec(xml);
  if (!match) return undefined;
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

async function stsRequest(
  fields: Fields,
  fetchImpl: Fetch,
  credentials: AwsCredentials,
  body: string,
): Promise<{ res: Response; text: string }> {
  const signed = await signV4({
    method: 'POST',
    url: STS_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    region: STS_REGION,
    service: STS_SERVICE,
    date: amzDate(),
  });
  delete signed.host; // fetch sets it; signing needed it
  const res = await send(fetchImpl, STS_URL, {
    method: 'POST',
    headers: signed,
    body,
  });
  return { res, text: await readText(res) };
}

function stsFailure(provider: string, status: number, text: string, fields: Fields): VerifyResult {
  const code = xmlValue(text, 'Code');
  const message = xmlValue(text, 'Message');
  const detail = [code, message].filter(Boolean).join(': ');
  return { ok: false, error: detail ? `${provider}: HTTP ${status} ${scrub(detail, fields)}` : `${provider}: HTTP ${status}` };
}

async function callerIdentity(
  fields: Fields,
  fetchImpl: Fetch,
  credentials: AwsCredentials,
): Promise<{ account: string; arn: string } | VerifyResult> {
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';
  const { res, text } = await stsRequest(fields, fetchImpl, credentials, body);
  if (!res.ok) return stsFailure('aws', res.status, text, fields);
  const account = xmlValue(text, 'Account');
  const arn = xmlValue(text, 'Arn');
  if (!account || !arn) return badResponse('aws', null, fields);
  return { account, arn };
}

async function verifyAws(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY');
  if (absent) return { ok: false, error: absent };

  let credentials: AwsCredentials = {
    accessKeyId: value(fields, 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: value(fields, 'AWS_SECRET_ACCESS_KEY'),
    sessionToken: value(fields, 'AWS_SESSION_TOKEN') || undefined,
  };

  const roleArn = value(fields, 'AWS_ROLE_ARN');
  if (roleArn) {
    const form: Record<string, string> = {
      Action: 'AssumeRole',
      RoleArn: roleArn,
      RoleSessionName: 'ptech-verify',
      Version: '2011-06-15',
    };
    const externalId = value(fields, 'AWS_EXTERNAL_ID');
    if (externalId) form.ExternalId = externalId;
    const { res, text } = await stsRequest(fields, fetchImpl, credentials, new URLSearchParams(form).toString());
    if (!res.ok) return stsFailure('aws', res.status, text, fields);
    const block = /<Credentials>[\s\S]*?<\/Credentials>/.exec(text)?.[0] ?? text;
    const accessKeyId = xmlValue(block, 'AccessKeyId');
    const secretAccessKey = xmlValue(block, 'SecretAccessKey');
    const sessionToken = xmlValue(block, 'SessionToken');
    if (!accessKeyId || !secretAccessKey || !sessionToken) return badResponse('aws', null, fields);
    credentials = { accessKeyId, secretAccessKey, sessionToken };
  }

  const identity = await callerIdentity(fields, fetchImpl, credentials);
  if ('ok' in identity) return identity;
  return { ok: true, detail: `Account ${identity.account} (${identity.arn})` };
}

/* --------------------------------------------------------------------- SaaS */

async function verifyExpo(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'EXPO_TOKEN');
  if (absent) return { ok: false, error: absent };
  const res = await send(fetchImpl, 'https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${value(fields, 'EXPO_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ me { username } }' }),
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('expo', res.status, body, fields);
  const username = body?.data?.me?.username;
  if (typeof username !== 'string' || !username) return badResponse('expo', body, fields);
  return { ok: true, detail: `Expo: ${username}` };
}

async function verifyHetzner(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'HETZNER_API_TOKEN');
  if (absent) return { ok: false, error: absent };
  const res = await send(fetchImpl, 'https://api.hetzner.cloud/v1/servers?per_page=1', {
    method: 'GET',
    headers: { Authorization: `Bearer ${value(fields, 'HETZNER_API_TOKEN')}`, Accept: 'application/json' },
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('hetzner', res.status, body, fields);
  const total = body?.meta?.pagination?.total_entries;
  if (typeof total !== 'number') return badResponse('hetzner', body, fields);
  return { ok: true, detail: `${total} servers` };
}

async function verifyDigitalOcean(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const token = value(fields, 'DIGITALOCEAN_TOKEN') || value(fields, 'DIGITALOCEAN_API_TOKEN');
  if (!token) return { ok: false, error: 'missing DIGITALOCEAN_TOKEN' };
  const res = await send(fetchImpl, 'https://api.digitalocean.com/v2/account', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await readJson(res);
  if (!res.ok) return httpFailure('digitalocean', res.status, body, fields);
  const email = typeof body?.account?.email === 'string' ? body.account.email : '';
  const status = typeof body?.account?.status === 'string' ? body.account.status : 'active';
  return { ok: true, detail: email ? `DigitalOcean: ${email} (${status})` : `DigitalOcean: account ${status}` };
}

async function verifyFly(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'FLY_API_TOKEN');
  if (absent) return { ok: false, error: absent };
  const token = value(fields, 'FLY_API_TOKEN');
  const res = await send(fetchImpl, 'https://api.fly.io/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { email } }' }),
  });
  const body = await readJson(res);
  const email = res.ok ? body?.data?.viewer?.email : undefined;
  if (typeof email === 'string' && email) return { ok: true, detail: `Fly: ${email}` };

  // Deploy tokens cannot query `viewer`; a 200 from the Machines API proves the token.
  const fallback = await send(fetchImpl, 'https://api.machines.dev/v1/apps?org_slug=personal', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (fallback.ok) return { ok: true, detail: 'Fly: apps ok (personal)' };
  return httpFailure('fly', fallback.status, await readJson(fallback), fields);
}

async function verifyCloudflare(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'CLOUDFLARE_API_TOKEN');
  if (absent) return { ok: false, error: absent };
  const res = await send(fetchImpl, 'https://api.cloudflare.com/client/v4/user/tokens/verify', {
    method: 'GET',
    headers: { Authorization: `Bearer ${value(fields, 'CLOUDFLARE_API_TOKEN')}`, Accept: 'application/json' },
  });
  const body = await readJson(res);
  if (!res.ok || body?.success !== true) return httpFailure('cloudflare', res.status, body, fields);
  const status = typeof body?.result?.status === 'string' && body.result.status ? body.result.status : 'active';
  return { ok: true, detail: `Cloudflare token: ${status}` };
}

async function verifyGithub(fields: Fields, fetchImpl: Fetch): Promise<VerifyResult> {
  const absent = missing(fields, 'GITHUB_REPO');
  if (absent) return { ok: false, error: absent };
  const repo = value(fields, 'GITHUB_REPO').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { ok: false, error: 'invalid GITHUB_REPO' };
  const res = await send(fetchImpl, `https://api.github.com/repos/${repo}`, {
    method: 'GET',
    headers: { 'User-Agent': 'ptech-verify', Accept: 'application/vnd.github+json' },
  });
  const body = await readJson(res);
  if (res.status === 404) return { ok: false, error: 'GITHUB_REPO not found or private' };
  if (!res.ok) return httpFailure('github', res.status, body, fields);
  const fullName = typeof body?.full_name === 'string' && body.full_name ? body.full_name : repo;
  const visibility =
    typeof body?.visibility === 'string' && body.visibility ? body.visibility : body?.private === true ? 'private' : 'public';
  return { ok: true, detail: `Repo: ${fullName} (${visibility})` };
}

/* ------------------------------------------------------------------ router */

type Handler = (fields: Fields, fetchImpl: Fetch) => Promise<VerifyResult>;

const HANDLERS: Record<string, Handler> = {
  shopify: verifyShopify,
  'app-store-connect': verifyAppStoreConnect,
  'google-play': verifyGooglePlay,
  gcp: verifyGcp,
  aws: verifyAws,
  expo: verifyExpo,
  hetzner: verifyHetzner,
  digitalocean: verifyDigitalOcean,
  fly: verifyFly,
  cloudflare: verifyCloudflare,
  github: verifyGithub,
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'request failed';
}

/**
 * Check one integration's credentials with a single cheap read-only call.
 *
 * Never throws: every failure — a missing field, a rejected token, a timeout —
 * comes back as `{ ok: false, error }` with no field value in the message.
 */
export async function verifyIntegration(
  id: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const input: Fields = fields && typeof fields === 'object' ? fields : {};
  try {
    const integration = String(id ?? '').trim().toLowerCase();
    const handler = HANDLERS[integration];
    if (!handler) return { ok: false, error: 'unknown_integration' };
    return await handler(input, fetchImpl);
  } catch (error) {
    return { ok: false, error: scrub(errorText(error), input) || 'request_failed' };
  }
}
