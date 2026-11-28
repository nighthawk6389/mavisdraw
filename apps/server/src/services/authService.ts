import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, sessions } from '../db/schema.js';
import { config } from '../config.js';
import { issuedTokenRevoked } from './accessRevocation.js';
import { releaseAbandonedAddress } from './unconfirmedAccounts.js';

const JWT_SECRET = config.jwtSecret;
const JWT_ACCESS_EXPIRY = '15m';
const JWT_REFRESH_EXPIRY_DAYS = 30;
const BCRYPT_ROUNDS = 10;

export interface TokenPayload {
  userId: string;
  email: string;
  /** Issued at, in ms (JWT `iat` is whole seconds): see `accessRevocation`. */
  iatMs?: number;
  /** Issued at (seconds), set by jwt.sign. */
  iat?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Confirmed ownership of the email (see services/emailVerification.ts). */
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

function toUserResponse(user: typeof users.$inferSelect): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  // An address held by a sign-up nobody confirmed for a month, with nothing
  // in it, goes to whoever signs up with it now
  if (existing && !(await releaseAbandonedAddress(email))) {
    throw new AuthError('Email already registered', 409);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const userId = nanoid();
  const now = new Date();

  const [user] = await db
    .insert(users)
    .values({
      id: userId,
      email: email.toLowerCase(),
      name,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const tokens = await createSession(userId, user.email);

  return { user: toUserResponse(user), tokens };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  if (!user || !user.passwordHash) {
    throw new AuthError('Invalid email or password', 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AuthError('Invalid email or password', 401);
  }

  const tokens = await createSession(user.id, user.email);

  return { user: toUserResponse(user), tokens };
}

/**
 * How long a just-rotated refresh token keeps working. Covers responses that
 * never reached the browser (navigation aborted the request, flaky network)
 * and several tabs refreshing at once — otherwise any of those logs the user
 * out.
 */
const ROTATION_GRACE_MS = 60_000;

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const session = await db.query.sessions.findFirst({
    where: or(
      eq(sessions.refreshToken, refreshToken),
      eq(sessions.previousRefreshToken, refreshToken),
    ),
  });

  if (!session || session.expiresAt < new Date()) {
    throw new AuthError('Invalid or expired refresh token', 401);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) {
    throw new AuthError('User not found', 401);
  }

  const accessToken = signAccessToken(user.id, user.email);

  // A recently replaced token: hand back the session's current token
  if (session.refreshToken !== refreshToken) {
    const rotatedAt = session.rotatedAt?.getTime() ?? 0;
    if (Date.now() - rotatedAt > ROTATION_GRACE_MS) {
      throw new AuthError('Invalid or expired refresh token', 401);
    }
    return { accessToken, refreshToken: session.refreshToken };
  }

  // Rotate in place, remembering the old token for the grace window
  const nextRefreshToken = nanoid(64);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRY_DAYS);
  await db
    .update(sessions)
    .set({
      refreshToken: nextRefreshToken,
      previousRefreshToken: refreshToken,
      rotatedAt: new Date(),
      expiresAt,
    })
    .where(eq(sessions.id, session.id));

  return { accessToken, refreshToken: nextRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  await db
    .delete(sessions)
    .where(
      or(eq(sessions.refreshToken, refreshToken), eq(sessions.previousRefreshToken, refreshToken)),
    );
}

export async function getUserById(userId: string): Promise<UserResponse | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  return user ? toUserResponse(user) : null;
}

export function verifyAccessToken(token: string): TokenPayload {
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (err) {
    console.error(
      '[authService] verifyAccessToken failed:',
      err instanceof Error ? err.message : err,
    );
    throw new AuthError('Invalid or expired access token', 401);
  }
  // Issued before the account was taken back by the owner of its address
  if (issuedTokenRevoked(payload.userId, payload)) {
    throw new AuthError('Invalid or expired access token', 401);
  }
  return payload;
}

function signAccessToken(userId: string, email: string): string {
  return jwt.sign({ userId, email, iatMs: Date.now() } satisfies TokenPayload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
  });
}

async function createSession(userId: string, email: string): Promise<AuthTokens> {
  const accessToken = signAccessToken(userId, email);

  const refreshToken = nanoid(64);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRY_DAYS);

  await db.insert(sessions).values({
    id: nanoid(),
    userId,
    refreshToken,
    expiresAt,
  });

  return { accessToken, refreshToken };
}

/** Start a session for someone already proven to be them (e.g. a password reset). */
export async function signInUser(
  userId: string,
): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new AuthError('User not found', 404);
  return { user: toUserResponse(user), tokens: await createSession(user.id, user.email) };
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
