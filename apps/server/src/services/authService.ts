import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, sessions } from '../db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'mavisdraw-dev-secret-change-in-production';
const JWT_ACCESS_EXPIRY = '15m';
const JWT_REFRESH_EXPIRY_DAYS = 30;
const BCRYPT_ROUNDS = 10;

export interface TokenPayload {
  userId: string;
  email: string;
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
  createdAt: string;
  updatedAt: string;
}

function toUserResponse(user: typeof users.$inferSelect): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
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
  if (existing) {
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

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.refreshToken, refreshToken),
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

  // Delete old session
  await db.delete(sessions).where(eq(sessions.id, session.id));

  // Create new session
  return createSession(user.id, user.email);
}

export async function logout(refreshToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.refreshToken, refreshToken));
}

export async function getUserById(userId: string): Promise<UserResponse | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  return user ? toUserResponse(user) : null;
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (err) {
    console.error('[authService] verifyAccessToken failed:', err instanceof Error ? err.message : err);
    throw new AuthError('Invalid or expired access token', 401);
  }
}

async function createSession(userId: string, email: string): Promise<AuthTokens> {
  const accessToken = jwt.sign({ userId, email } satisfies TokenPayload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
  });

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

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
