import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { OidcConfig } from '../config.js';
import { db } from '../db/client.js';
import { userIdentities, users } from '../db/schema.js';
import { claimInvitesForEmail } from './workspaceService.js';
import { readToken, signToken } from './signedToken.js';
import { endAccountAccess } from './accountAccess.js';

/**
 * Single sign-on through an OpenID Connect provider (Okta, Microsoft Entra
 * ID, Google Workspace, Auth0, Keycloak…): the authorization code flow with
 * PKCE, a signed one-time state, and ID tokens checked against the
 * provider's published keys.
 *
 * Accounts: someone's provider identity (issuer + subject) is linked to one
 * MavisDraw account. The first time, an account with the same (verified)
 * email is linked, or a new one is created; the provider vouches for the
 * address, so it counts as confirmed.
 */

/** What went wrong, as a short code the sign-in page explains. */
export type SsoErrorCode = 'state' | 'denied' | 'domain' | 'email' | 'failed';

export class SsoError extends Error {
  constructor(
    public code: SsoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** Where to go after signing in: a path on this app only (never another site). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.includes('\\') || /[\r\n]/.test(next)) return '/';
  return next.slice(0, 500);
}

export function emailAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return allowedDomains.includes(domain);
}

// ── The provider ─────────────────────────────────────────────

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

const discoveries = new Map<string, { doc: Discovery; jwks: JWTVerifyGetKey; at: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/** The provider's endpoints and keys (cached for an hour). */
export async function discover(issuer: string, now = Date.now()) {
  const hit = discoveries.get(issuer);
  if (hit && now - hit.at < DISCOVERY_TTL_MS) return hit;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok)
    throw new SsoError('failed', `The provider's discovery document answered ${res.status}`);
  const doc = (await res.json()) as Discovery;
  if (doc.issuer?.replace(/\/+$/, '') !== issuer) {
    throw new SsoError('failed', `The provider says its issuer is ${doc.issuer}, not ${issuer}`);
  }
  const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: now };
  discoveries.set(issuer, entry);
  return entry;
}

// ── The round trip ───────────────────────────────────────────

const STATE_PURPOSE = 'oidc-login';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface LoginStart {
  /** Where to send the browser. */
  url: string;
  /** Kept in an httpOnly cookie until the provider sends the browser back. */
  cookie: string;
}

export async function startLogin(
  cfg: OidcConfig,
  redirectUri: string,
  next: string,
): Promise<LoginStart> {
  const { doc } = await discover(cfg.issuer);
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const { verifier, challenge } = pkcePair();
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scopes,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  const cookie = signToken(
    STATE_PURPOSE,
    { s: state, n: nonce, v: verifier, r: safeNextPath(next), u: redirectUri },
    STATE_TTL_MS,
  );
  return { url: url.toString(), cookie };
}

/** The cookie set by startLogin, checked against the state the provider returned. */
export function readLoginCookie(cookie: string | undefined, state: string | undefined) {
  if (!cookie || !state) throw new SsoError('state', 'The sign-in expired or came from elsewhere');
  let data: Record<string, string>;
  try {
    data = readToken(STATE_PURPOSE, cookie);
  } catch {
    throw new SsoError('state', 'The sign-in expired or came from elsewhere');
  }
  if (data.s !== state) throw new SsoError('state', 'The sign-in came from elsewhere');
  return { nonce: data.n, verifier: data.v, next: safeNextPath(data.r), redirectUri: data.u };
}

/** Exchange the code for tokens (client authentication the provider supports). */
async function exchangeCode(
  cfg: OidcConfig,
  doc: Discovery,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ id_token?: string; access_token?: string }> {
  const methods = doc.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
  const usePost =
    !methods.includes('client_secret_basic') && methods.includes('client_secret_post');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    ...(usePost ? { client_id: cfg.clientId, client_secret: cfg.clientSecret } : {}),
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (!usePost) {
    const user = encodeURIComponent(cfg.clientId);
    const pass = encodeURIComponent(cfg.clientSecret);
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  const res = await fetch(doc.token_endpoint, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new SsoError('failed', `The provider refused the sign-in code (${res.status})`);
  }
  return (await res.json()) as { id_token?: string; access_token?: string };
}

export interface Identity {
  issuer: string;
  subject: string;
  email: string;
  name: string;
}

/** Check an ID token: signature, issuer, audience, expiry and nonce. */
export async function verifyIdToken(
  idToken: string,
  opts: { jwks: JWTVerifyGetKey; issuer: string; clientId: string; nonce: string },
): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, opts.jwks, {
      issuer: opts.issuer,
      audience: opts.clientId,
      clockTolerance: 60,
    }));
  } catch (err) {
    throw new SsoError(
      'failed',
      `The provider's ID token didn't check out: ${(err as Error).message}`,
    );
  }
  if (payload.nonce !== opts.nonce) {
    throw new SsoError('state', 'The ID token was issued for another sign-in');
  }
  return payload;
}

/** Who signed in, from the ID token (and the userinfo endpoint if it holds the email). */
export function identityFrom(
  issuer: string,
  claims: Record<string, unknown>,
  allowedDomains: string[],
  /** OIDC_TRUST_EMAIL: the provider only hands out addresses from the directory, said or not. */
  trustEmail = false,
): Identity {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    throw new SsoError('email', 'The provider didn’t share an email address');
  }
  // The address links accounts and receives invites, so the provider has to
  // vouch for it. One that says "not verified" is always believed; one that
  // says nothing only counts when the operator trusts its addresses (people
  // can set their own email at some providers)
  const said = claims.email_verified;
  if (said === false || said === 'false') {
    throw new SsoError('email', 'The provider says this email address isn’t verified');
  }
  if (said !== true && said !== 'true' && !(trustEmail && said === undefined)) {
    throw new SsoError('email', 'The provider didn’t say this email address is verified');
  }
  if (!emailAllowed(email, allowedDomains)) {
    throw new SsoError('domain', `${email} isn’t allowed to sign in here`);
  }
  const given = [claims.given_name, claims.family_name].filter((p) => typeof p === 'string');
  const name =
    (typeof claims.name === 'string' && claims.name.trim()) ||
    given.join(' ').trim() ||
    email.split('@')[0];
  return { issuer, subject: String(claims.sub), email, name: name.slice(0, 255) };
}

export async function completeLogin(
  cfg: OidcConfig,
  code: string,
  login: { nonce: string; verifier: string; redirectUri: string },
): Promise<Identity> {
  const { doc, jwks } = await discover(cfg.issuer);
  const tokens = await exchangeCode(cfg, doc, code, login.verifier, login.redirectUri);
  if (!tokens.id_token) throw new SsoError('failed', 'The provider sent no ID token');
  const claims: Record<string, unknown> = {
    ...(await verifyIdToken(tokens.id_token, {
      jwks,
      issuer: doc.issuer,
      clientId: cfg.clientId,
      nonce: login.nonce,
    })),
  };
  if (!claims.sub) throw new SsoError('failed', 'The ID token names no one (no sub)');
  // Some providers keep the email out of the ID token
  if (typeof claims.email !== 'string' && doc.userinfo_endpoint && tokens.access_token) {
    const res = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const info = (await res.json()) as Record<string, unknown>;
      if (info.sub === claims.sub) Object.assign(claims, { ...info, sub: claims.sub });
    }
  }
  return identityFrom(cfg.issuer, claims, cfg.allowedDomains, cfg.trustEmail);
}

/**
 * The account for this identity: linked before, matched by email, or new.
 * `tookOver`: an account registered with this address but never confirmed was
 * taken back from whoever registered it (their password, sessions, tokens and
 * agents no longer work); the caller closes its open sockets.
 */
export async function accountFor(
  identity: Identity,
): Promise<{ userId: string; tookOver: boolean }> {
  const now = new Date();
  const linked = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.issuer, identity.issuer),
      eq(userIdentities.subject, identity.subject),
    ),
  });
  if (linked) {
    await db
      .update(userIdentities)
      .set({ email: identity.email, lastSignInAt: now })
      .where(eq(userIdentities.id, linked.id));
    return { userId: linked.userId, tookOver: false };
  }

  let tookOver = false;
  let user = await db.query.users.findFirst({ where: eq(users.email, identity.email) });
  if (user) {
    // The provider vouches for the address: it's theirs. If the account never
    // confirmed it, whoever registered it may not be them (anyone can type an
    // address at sign-up): take it back, as a password reset would
    if (!user.emailVerifiedAt) {
      await db
        .update(users)
        .set({ emailVerifiedAt: now, passwordHash: null, updatedAt: now })
        .where(eq(users.id, user.id));
      await endAccountAccess(user.id);
      tookOver = true;
    }
  } else {
    const [created] = await db
      .insert(users)
      .values({
        id: nanoid(),
        email: identity.email,
        name: identity.name,
        passwordHash: null,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = created;
  }
  await db.insert(userIdentities).values({
    id: nanoid(),
    userId: user.id,
    issuer: identity.issuer,
    subject: identity.subject,
    email: identity.email,
    createdAt: now,
    lastSignInAt: now,
  });
  await claimInvitesForEmail(user.id, user.email);
  return { userId: user.id, tookOver };
}
