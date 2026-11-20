/*
 * Unit checks for worker/src/integrations.ts: no network, no Worker, no secrets.
 * Every vendor call is a fake fetch that records what was sent and answers with
 * a canned response.
 *
 *   node --experimental-strip-types --no-warnings --test worker/test/integrations.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signV4, verifyIntegration } from '../src/integrations.ts';

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string };

/**
 * A fetch stand-in: records every call and answers through `handler`. Assertions
 * are made on the recorded calls afterwards, not inside the handler, so a
 * failure cannot be swallowed by the module's own error handling.
 */
function recorder(handler: (call: Recorded) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const impl = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawHeaders)) headers[key.toLowerCase()] = String(value);
    const call: Recorded = {
      url,
      method: String(init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml' } });
}

function decode64(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeJson(text: string): any {
  return JSON.parse(decode64(text).toString('utf8'));
}

function pem(label: string, bytes: ArrayBuffer): string {
  const base64 = Buffer.from(bytes).toString('base64');
  const lines = base64.match(/.{1,64}/g)?.join('\n') ?? base64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

async function ecKeyPair(): Promise<{ privatePem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  return { privatePem: pem('PRIVATE KEY', pkcs8), publicKey: pair.publicKey };
}

async function rsaKeyPair(): Promise<{ privatePem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  return { privatePem: pem('PRIVATE KEY', pkcs8), publicKey: pair.publicKey };
}

/** Decode a compact JWS and check its signature with the matching public key. */
async function checkJwt(jwt: string, publicKey: CryptoKey, algorithm: 'ES256' | 'RS256') {
  const parts = jwt.split('.');
  assert.equal(parts.length, 3, 'compact JWS has three parts');
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decode64(parts[2]);
  const valid = await crypto.subtle.verify(
    algorithm === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    data,
  );
  return { valid, header: decodeJson(parts[0]), payload: decodeJson(parts[1]) };
}

/* ------------------------------------------------------------------ SigV4 */

test('SigV4 matches the AWS ListUsers example from the documentation', async () => {
  const signed = await signV4({
    method: 'GET',
    url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: '',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 'iam',
    date: '20150830T123600Z',
  });

  assert.equal(signed.host, 'iam.amazonaws.com');
  assert.equal(signed['x-amz-date'], '20150830T123600Z');
  assert.equal(
    signed.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
      'SignedHeaders=content-type;host;x-amz-date, ' +
      'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
  );
});

test('SigV4 signs a session token too', async () => {
  const signed = await signV4({
    method: 'POST',
    url: 'https://sts.amazonaws.com/',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: 'Action=GetCallerIdentity&Version=2011-06-15',
    accessKeyId: 'ASIAEXAMPLE',
    secretAccessKey: 'secret',
    sessionToken: 'session-token',
    region: 'us-east-1',
    service: 'sts',
    date: '20150830T123600Z',
  });
  assert.equal(signed['x-amz-security-token'], 'session-token');
  assert.match(signed.authorization, /SignedHeaders=content-type;host;x-amz-date;x-amz-security-token/);
});

/* ----------------------------------------------------------------- shopify */

test('shopify validates the domain before it fetches anything', async () => {
  let fetched = 0;
  const impl = (async () => {
    fetched += 1;
    return json({});
  }) as typeof fetch;

  for (const domain of ['evil.example.com', 'Acme.myshopify.com', 'acme.myshopify.com.evil.com', 'acme-myshopify.com']) {
    const result = await verifyIntegration(
      'shopify',
      { SHOPIFY_STORE_DOMAIN: domain, SHOPIFY_ADMIN_TOKEN: 'shpat_secret_token' },
      impl,
    );
    assert.equal(result.ok, false, domain);
    assert.match(result.error ?? '', /invalid SHOPIFY_STORE_DOMAIN/);
  }
  assert.equal(fetched, 0);
});

test('shopify calls shop.json with the admin token and reports the shop', async () => {
  const { impl, calls } = recorder(() =>
    json({ shop: { name: 'Acme', myshopify_domain: 'acme.myshopify.com' } }),
  );
  const result = await verifyIntegration(
    'shopify',
    { SHOPIFY_STORE_DOMAIN: 'acme.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat_secret_token' },
    impl,
  );

  assert.deepEqual(result, { ok: true, detail: 'Shop: Acme (acme.myshopify.com)' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://acme.myshopify.com/admin/api/2025-10/shop.json');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers['x-shopify-access-token'], 'shpat_secret_token');
});

test('shopify HTTP failures do not echo the token', async () => {
  const token = 'shpat_super_secret_value_123';
  const { impl } = recorder(() => json({ errors: `Invalid API key or access token ${token}` }, 401));
  const result = await verifyIntegration(
    'shopify',
    { SHOPIFY_STORE_DOMAIN: 'acme.myshopify.com', SHOPIFY_ADMIN_TOKEN: token },
    impl,
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /shopify: HTTP 401/);
  assert.equal((result.error ?? '').includes(token), false);
  assert.equal((result.error ?? '').includes('[redacted]'), true);
});

/* ------------------------------------------------------- app-store-connect */

test('app-store-connect builds a valid ES256 JWT and counts the apps', async () => {
  const { privatePem, publicKey } = await ecKeyPair();
  const { impl, calls } = recorder(() => json({ data: [{ id: '1' }, { id: '2' }] }));

  const result = await verifyIntegration(
    'app-store-connect',
    {
      ASC_KEY_ID: 'KEYID12345',
      ASC_ISSUER_ID: '69a6de70-0000-4000-8000-000000000000',
      ASC_PRIVATE_KEY: privatePem,
    },
    impl,
  );

  assert.deepEqual(result, { ok: true, detail: '2 apps' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.appstoreconnect.apple.com/v1/apps?limit=5');
  assert.equal(calls[0].method, 'GET');

  const authorization = calls[0].headers.authorization;
  assert.match(authorization, /^Bearer eyJ/);
  const jwt = authorization.slice('Bearer '.length);
  const checked = await checkJwt(jwt, publicKey, 'ES256');

  assert.equal(checked.valid, true, 'JWT signature verifies with the public key');
  assert.deepEqual(checked.header, { alg: 'ES256', kid: 'KEYID12345', typ: 'JWT' });
  assert.equal(checked.payload.iss, '69a6de70-0000-4000-8000-000000000000');
  assert.equal(checked.payload.aud, 'appstoreconnect-v1');
  assert.equal(typeof checked.payload.iat, 'number');
  assert.ok(checked.payload.exp > checked.payload.iat);
  assert.ok(checked.payload.exp - checked.payload.iat <= 1200, 'token lives at most 20 minutes');
});

/* ------------------------------------------------------------------ google */

test('gcp signs an RS256 assertion, exchanges it and reads the project', async () => {
  const { privatePem, publicKey } = await rsaKeyPair();
  const serviceAccount = JSON.stringify({
    type: 'service_account',
    project_id: 'project-123',
    private_key_id: 'kid-1',
    client_email: 'verify@project-123.iam.gserviceaccount.com',
    private_key: privatePem,
  });
  const { impl, calls } = recorder((call) => {
    if (call.url === 'https://oauth2.googleapis.com/token') {
      return json({ access_token: 'ya29.test-token', expires_in: 3600, token_type: 'Bearer' });
    }
    return json({ projectId: 'project-123', projectNumber: '42', lifecycleState: 'ACTIVE' });
  });

  const result = await verifyIntegration(
    'gcp',
    { GCP_SERVICE_ACCOUNT_JSON: serviceAccount, GCP_PROJECT_ID: 'project-123' },
    impl,
  );

  assert.deepEqual(result, { ok: true, detail: 'Project: project-123 (ACTIVE)' });
  assert.equal(calls.length, 2, 'one token exchange, one project read');

  // 1. The token exchange carries a signed RS256 assertion with the read-only scope.
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers['content-type'], /application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = form.get('assertion') ?? '';
  const checked = await checkJwt(assertion, publicKey, 'RS256');
  assert.equal(checked.valid, true, 'assertion signature verifies with the public key');
  assert.deepEqual(checked.header, { alg: 'RS256', typ: 'JWT', kid: 'kid-1' });
  assert.equal(checked.payload.iss, 'verify@project-123.iam.gserviceaccount.com');
  assert.equal(checked.payload.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(checked.payload.scope, 'https://www.googleapis.com/auth/cloud-platform.read-only');
  assert.ok(checked.payload.exp - checked.payload.iat <= 3600);

  // 2. The project read uses the access token, not the assertion.
  assert.equal(calls[1].url, 'https://cloudresourcemanager.googleapis.com/v1/projects/project-123');
  assert.equal(calls[1].headers.authorization, 'Bearer ya29.test-token');
});

test('google-play opens and deletes an edit when a package name is given', async () => {
  const { privatePem, publicKey } = await rsaKeyPair();
  const serviceAccount = JSON.stringify({
    client_email: 'play@project-123.iam.gserviceaccount.com',
    private_key: privatePem,
  });
  const { impl, calls } = recorder((call) => {
    if (call.url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'ya29.play-token' });
    if (call.method === 'POST') return json({ id: 'edit-77', expiryTimeSeconds: '123' });
    return new Response(null, { status: 204 });
  });

  const result = await verifyIntegration(
    'google-play',
    { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: serviceAccount, GOOGLE_PLAY_PACKAGE_NAME: 'com.acme.app' },
    impl,
  );

  assert.equal(result.ok, true);
  assert.match(result.detail ?? '', /com\.acme\.app/);
  assert.match(result.detail ?? '', /play@project-123\.iam\.gserviceaccount\.com/);
  assert.equal(calls.length, 3);

  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.acme.app/edits');
  assert.equal(calls[1].headers.authorization, 'Bearer ya29.play-token');
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(
    calls[2].url,
    'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.acme.app/edits/edit-77',
  );
  assert.equal(calls[2].headers.authorization, 'Bearer ya29.play-token');

  const assertion = new URLSearchParams(calls[0].body).get('assertion') ?? '';
  const checked = await checkJwt(assertion, publicKey, 'RS256');
  assert.equal(checked.payload.scope, 'https://www.googleapis.com/auth/androidpublisher');
});

test('google-play without a package name only proves the token', async () => {
  const { privatePem } = await rsaKeyPair();
  const serviceAccount = JSON.stringify({ client_email: 'play@example.com', private_key: privatePem });
  const { impl, calls } = recorder(() => json({ access_token: 'ya29.play-token' }));

  const result = await verifyIntegration('google-play', { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: serviceAccount }, impl);

  assert.deepEqual(result, { ok: true, detail: 'Google Play: token ok (play@example.com)' });
  assert.equal(calls.length, 1);
});

/* --------------------------------------------------------------------- AWS */

const roleXml = `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleResult>
    <Credentials>
      <AccessKeyId>ASIA_TEMP_ACCESS_KEY</AccessKeyId>
      <SecretAccessKey>temp-secret-access-key</SecretAccessKey>
      <SessionToken>temp-session-token</SessionToken>
      <Expiration>2030-01-01T00:00:00Z</Expiration>
    </Credentials>
    <AssumedRoleUser>
      <AssumedRoleId>AROAEXAMPLE:ptech-verify</AssumedRoleId>
      <Arn>arn:aws:sts::123456789012:assumed-role/verify/ptech-verify</Arn>
    </AssumedRoleUser>
  </AssumeRoleResult>
</AssumeRoleResponse>`;

const identityXml = `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>arn:aws:iam::123456789012:user/verify</Arn>
    <UserId>AIDAEXAMPLE</UserId>
    <Account>123456789012</Account>
  </GetCallerIdentityResult>
  <ResponseMetadata><RequestId>01234567-89ab-cdef-0123-456789abcdef</RequestId></ResponseMetadata>
</GetCallerIdentityResponse>`;

test('aws assumes a role from the STS XML, then verifies the caller with the temporary key', async () => {
  const { impl, calls } = recorder((call) => {
    if (call.body.includes('Action=AssumeRole')) return xml(roleXml);
    return xml(identityXml);
  });

  const result = await verifyIntegration(
    'aws',
    {
      AWS_ACCESS_KEY_ID: 'AKIDORIGINAL',
      AWS_SECRET_ACCESS_KEY: 'original-secret',
      AWS_ROLE_ARN: 'arn:aws:iam::111122223333:role/verify',
      AWS_EXTERNAL_ID: 'ext-42',
    },
    impl,
  );

  assert.deepEqual(result, {
    ok: true,
    detail: 'Account 123456789012 (arn:aws:iam::123456789012:user/verify)',
  });
  assert.equal(calls.length, 2);

  // AssumeRole: form body and the long-lived key.
  const assume = calls[0];
  assert.equal(assume.method, 'POST');
  assert.equal(assume.url, 'https://sts.amazonaws.com/');
  const assumeForm = new URLSearchParams(assume.body);
  assert.equal(assumeForm.get('Action'), 'AssumeRole');
  assert.equal(assumeForm.get('RoleArn'), 'arn:aws:iam::111122223333:role/verify');
  assert.equal(assumeForm.get('RoleSessionName'), 'ptech-verify');
  assert.equal(assumeForm.get('ExternalId'), 'ext-42');
  assert.equal(assumeForm.get('Version'), '2011-06-15');
  assert.match(assume.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.match(assume.headers.authorization, /Credential=AKIDORIGINAL\/\d{8}\/us-east-1\/sts\/aws4_request/);
  assert.match(assume.headers.authorization, /SignedHeaders=content-type;host;x-amz-date/);

  // GetCallerIdentity: exact documented body, signed with the temporary key + session token.
  const identity = calls[1];
  assert.equal(identity.body, 'Action=GetCallerIdentity&Version=2011-06-15');
  assert.match(identity.headers.authorization, /Credential=ASIA_TEMP_ACCESS_KEY\/\d{8}\/us-east-1\/sts\/aws4_request/);
  assert.equal(identity.headers['x-amz-security-token'], 'temp-session-token');
});

test('aws without a role calls GetCallerIdentity with the long-lived key', async () => {
  const { impl, calls } = recorder(() => xml(identityXml));
  const result = await verifyIntegration(
    'aws',
    { AWS_ACCESS_KEY_ID: 'AKIDORIGINAL', AWS_SECRET_ACCESS_KEY: 'original-secret' },
    impl,
  );

  assert.equal(result.ok, true);
  assert.match(result.detail ?? '', /123456789012/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, 'Action=GetCallerIdentity&Version=2011-06-15');
  assert.match(calls[0].headers.authorization, /Credential=AKIDORIGINAL\//);
});

/* ------------------------------------------------------------ defaulting */

test('unknown integrations and missing fields are plain errors and never fetch', async () => {
  let fetched = 0;
  const impl = (async () => {
    fetched += 1;
    return json({});
  }) as typeof fetch;

  assert.deepEqual(await verifyIntegration('nope', {}, impl), { ok: false, error: 'unknown_integration' });
  assert.deepEqual(await verifyIntegration('shopify', {}, impl), { ok: false, error: 'missing SHOPIFY_STORE_DOMAIN' });
  assert.deepEqual(await verifyIntegration('aws', { AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE' }, impl), {
    ok: false,
    error: 'missing AWS_SECRET_ACCESS_KEY',
  });
  assert.deepEqual(await verifyIntegration('app-store-connect', { ASC_KEY_ID: 'x' }, impl), {
    ok: false,
    error: 'missing ASC_ISSUER_ID',
  });
  assert.equal(fetched, 0);
});

test('unexpected throws and network errors are caught and scrubbed', async () => {
  const token = 'expo-secret-token-value';
  const throwing = (async () => {
    throw new Error(`socket closed for ${token}`);
  }) as typeof fetch;

  const result = await verifyIntegration('expo', { EXPO_TOKEN: token }, throwing);
  assert.equal(result.ok, false);
  assert.equal((result.error ?? '').includes(token), false);
  assert.match(result.error ?? '', /socket closed/);
  assert.match(result.error ?? '', /\[redacted\]/);
});

test('a vendor error body cannot leak an AWS secret either', async () => {
  const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
  const { impl } = recorder(() =>
    xml(
      '<ErrorResponse><Error><Type>Sender</Type><Code>InvalidClientTokenId</Code>' +
        `<Message>The security token contained ${secret} is invalid</Message></Error></ErrorResponse>`,
      403,
    ),
  );
  const result = await verifyIntegration(
    'aws',
    { AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: secret },
    impl,
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /InvalidClientTokenId/);
  assert.equal((result.error ?? '').includes(secret), false);
});

test('a Google token failure cannot echo the service-account private key', async () => {
  const { privatePem } = await rsaKeyPair();
  const keyLine = privatePem.split('\n')[2];
  assert.ok(keyLine.length >= 8);
  const serviceAccount = JSON.stringify({
    client_email: 'verify@project-123.iam.gserviceaccount.com',
    private_key: privatePem,
  });
  const { impl } = recorder(() =>
    json({ error: 'invalid_grant', error_description: `assertion signature invalid: ${keyLine}` }, 400),
  );

  const result = await verifyIntegration(
    'gcp',
    { GCP_SERVICE_ACCOUNT_JSON: serviceAccount, GCP_PROJECT_ID: 'project-123' },
    impl,
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /google: HTTP 400/);
  assert.equal((result.error ?? '').includes(keyLine), false);
  assert.equal((result.error ?? '').includes('-----BEGIN'), false);
});
