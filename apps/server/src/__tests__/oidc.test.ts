import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from 'jose';
import type { OidcConfig } from '../config.js';
import {
  completeLogin,
  emailAllowed,
  identityFrom,
  readLoginCookie,
  safeNextPath,
  SsoError,
  startLogin,
  verifyIdToken,
} from '../services/oidc.js';
import { loadConfig } from '../config.js';

const ISSUER = 'https://idp.example.com';
const cfg: OidcConfig = {
  issuer: ISSUER,
  clientId: 'mavisdraw',
  clientSecret: 's3cret',
  name: 'Acme SSO',
  scopes: 'openid email profile',
  allowedDomains: ['acme.com'],
  redirectUri: null,
  trustEmail: false,
  ssoOnly: false,
};

let privateKey: CryptoKey;
let jwk: JWK;
let otherKey: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  otherKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
});
afterEach(() => vi.unstubAllGlobals());

const idToken = (claims: Record<string, unknown>, key = privateKey, aud = 'mavisdraw') =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);

describe('single sign-on', () => {
  it('only returns to paths on this app', () => {
    expect(safeNextPath('/p/abc?thread=1')).toBe('/p/abc?thread=1');
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'p/abc',
      42,
      undefined,
    ]) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });

  it('checks the email domain when the server limits it', () => {
    expect(emailAllowed('ana@acme.com', ['acme.com'])).toBe(true);
    expect(emailAllowed('ana@ACME.com', ['acme.com'])).toBe(true);
    expect(emailAllowed('ana@acme.com.evil.io', ['acme.com'])).toBe(false);
    expect(emailAllowed('anyone@anywhere.io', [])).toBe(true);
  });

  it('reads who signed in, believing a provider that says an address is unverified', () => {
    expect(
      identityFrom(
        ISSUER,
        {
          sub: '1',
          email: 'Ana@Acme.com',
          email_verified: true,
          given_name: 'Ana',
          family_name: 'Lopez',
        },
        [],
      ),
    ).toEqual({
      issuer: ISSUER,
      subject: '1',
      email: 'ana@acme.com',
      name: 'Ana Lopez',
    });
    expect(
      identityFrom(ISSUER, { sub: '1', email: 'bo@acme.com', email_verified: 'true' }, []).name,
    ).toBe('bo');
    expect(() =>
      identityFrom(ISSUER, { sub: '1', email: 'a@acme.com', email_verified: false }, []),
    ).toThrow(/isn’t verified/);
    expect(() => identityFrom(ISSUER, { sub: '1' }, [])).toThrow(SsoError);
    expect(() =>
      identityFrom(ISSUER, { sub: '1', email: 'x@gmail.com', email_verified: true }, ['acme.com']),
    ).toThrow(/isn’t allowed/);
  });

  it('needs the provider to vouch for the address, unless the operator trusts its addresses', () => {
    const silent = { sub: '1', email: 'cy@acme.com' };
    // Some providers let people set their own address: saying nothing isn't vouching
    expect(() => identityFrom(ISSUER, silent, [])).toThrow(/didn’t say this email address/);
    expect(() => identityFrom(ISSUER, { ...silent, email_verified: 'yes' }, [])).toThrow(SsoError);
    // OIDC_TRUST_EMAIL: addresses come from the directory (e.g. Entra ID, which omits the claim)
    expect(identityFrom(ISSUER, silent, [], true).email).toBe('cy@acme.com');
    // …but an explicit "not verified" is still believed
    expect(() => identityFrom(ISSUER, { ...silent, email_verified: false }, [], true)).toThrow(
      /isn’t verified/,
    );
  });

  it('verifies ID tokens: signer, audience, expiry and nonce', async () => {
    const jwks = createLocalJWKSet({ keys: [jwk] });
    const opts = { jwks, issuer: ISSUER, clientId: 'mavisdraw', nonce: 'n1' };
    await expect(
      verifyIdToken(await idToken({ sub: '1', nonce: 'n1' }), opts),
    ).resolves.toMatchObject({ sub: '1' });
    await expect(verifyIdToken(await idToken({ sub: '1', nonce: 'n2' }), opts)).rejects.toThrow(
      /another sign-in/,
    );
    await expect(
      verifyIdToken(await idToken({ sub: '1', nonce: 'n1' }, privateKey, 'someone-else'), opts),
    ).rejects.toThrow(SsoError);
    await expect(
      verifyIdToken(await idToken({ sub: '1', nonce: 'n1' }, otherKey), opts),
    ).rejects.toThrow(SsoError);
  });

  it('goes to the provider and back: PKCE, state, the code exchange, the ID token', async () => {
    let tokenRequest: { headers: Record<string, string>; body: URLSearchParams } | null = null;
    let nonce = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${ISSUER}/.well-known/openid-configuration`) {
          return Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
          });
        }
        if (url === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] });
        if (url === `${ISSUER}/token`) {
          tokenRequest = {
            headers: init!.headers as Record<string, string>,
            body: new URLSearchParams(String(init!.body)),
          };
          return Response.json({
            access_token: 'at',
            id_token: await idToken({
              sub: 'okta-42',
              email: 'ana@acme.com',
              email_verified: true,
              name: 'Ana',
              nonce,
            }),
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );

    const start = await startLogin(cfg, 'https://draw.acme.com/api/auth/oidc/callback', '/p/abc');
    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    nonce = url.searchParams.get('nonce')!;
    const challenge = url.searchParams.get('code_challenge')!;

    // Back from the provider with a state that doesn't match: refused
    expect(() => readLoginCookie(start.cookie, 'forged')).toThrow(SsoError);
    expect(() => readLoginCookie(undefined, url.searchParams.get('state')!)).toThrow(SsoError);
    const login = readLoginCookie(start.cookie, url.searchParams.get('state')!);
    expect(login.next).toBe('/p/abc');

    const identity = await completeLogin(cfg, 'code-1', login);
    expect(identity).toEqual({
      issuer: ISSUER,
      subject: 'okta-42',
      email: 'ana@acme.com',
      name: 'Ana',
    });
    // The client authenticated, and proved it started this sign-in (PKCE)
    expect(tokenRequest!.headers.Authorization).toBe(
      `Basic ${Buffer.from('mavisdraw:s3cret').toString('base64')}`,
    );
    const verifier = tokenRequest!.body.get('code_verifier')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(tokenRequest!.body.get('redirect_uri')).toBe(
      'https://draw.acme.com/api/auth/oidc/callback',
    );
  });
});

describe('single sign-on settings', () => {
  const base = { OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 'secret' };
  it('are all-or-nothing, with readable domains', () => {
    expect(loadConfig({ OIDC_ISSUER: ISSUER }).problems.join()).toMatch(/together/);
    const { config, problems } = loadConfig({
      ...base,
      OIDC_NAME: 'Okta',
      OIDC_ALLOWED_DOMAINS: ' Acme.com, @acme.io ',
    });
    expect(problems).toEqual([]);
    expect(config.oidc).toMatchObject({
      name: 'Okta',
      allowedDomains: ['acme.com', 'acme.io'],
      trustEmail: false,
      ssoOnly: false,
    });
  });

  it('need https in production, and SSO-only needs a provider', () => {
    const prod = {
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      COOKIE_SECRET: 'y'.repeat(40),
      DATABASE_URL: 'x',
      CORS_ORIGIN: 'https://a',
    };
    expect(
      loadConfig({ ...prod, ...base, OIDC_ISSUER: 'http://idp.local' }).problems.join(),
    ).toMatch(/https/);
    expect(loadConfig({ SSO_ONLY: 'true' }).problems.join()).toMatch(/SSO_ONLY/);
    expect(loadConfig({ ...base, SSO_ONLY: 'true' }).config.oidc?.ssoOnly).toBe(true);
  });
});
