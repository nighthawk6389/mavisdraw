import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import {
  registerUser,
  loginUser,
  refreshTokens,
  logout,
  getUserById,
  AuthError,
} from '../services/authService.js';
import { claimInvitesForEmail } from '../services/workspaceService.js';
import {
  confirmEmail,
  sendVerificationEmail,
  VerificationError,
} from '../services/emailVerification.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Register
  app.post('/api/auth/register', { preHandler: [authRateLimit] }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    try {
      const { user, tokens } = await registerUser(parsed.data.email, parsed.data.password, parsed.data.name);
      // Invitations to this address wait until it's confirmed as theirs
      // (anyone can type any address into a sign-up form)
      await sendVerificationEmail(user);

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });

      return reply.code(201).send({ user, accessToken: tokens.accessToken });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      request.log.error({ err }, 'Unexpected error during registration');
      throw err;
    }
  });

  // Login
  app.post('/api/auth/login', { preHandler: [authRateLimit] }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    try {
      const { user, tokens } = await loginUser(parsed.data.email, parsed.data.password);
      if (user.emailVerified) await claimInvitesForEmail(user.id, user.email);

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60,
      });

      return reply.code(200).send({ user, accessToken: tokens.accessToken });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      request.log.error({ err }, 'Unexpected error during login');
      throw err;
    }
  });

  // Confirm the account's email (the link from the confirmation email; no
  // sign-in needed: it may be opened on another device)
  app.post('/api/auth/verify-email', { preHandler: [authRateLimit] }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(1).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Missing confirmation token' });
    try {
      const { userId, claimed } = await confirmEmail(parsed.data.token);
      return reply.send({ verified: true, userId, claimed });
    } catch (err) {
      if (err instanceof VerificationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Send the confirmation email again
  app.post(
    '/api/auth/resend-verification',
    { preHandler: [authRateLimit, requireAuth] },
    async (request, reply) => {
      const user = await getUserById(request.user!.userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });
      if (user.emailVerified) return reply.send({ sent: false, verified: true });
      return reply.send({ sent: await sendVerificationEmail(user), verified: false });
    },
  );

  // Refresh token
  app.post('/api/auth/refresh', async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const cookieToken = (request.cookies as Record<string, string>)?.refreshToken;
    const bodyToken = body?.refreshToken as string | undefined;
    const refreshToken = cookieToken || bodyToken;

    if (!refreshToken) {
      return reply.code(400).send({ error: 'Refresh token required' });
    }

    try {
      const tokens = await refreshTokens(refreshToken);

      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60,
      });

      return reply.code(200).send({ accessToken: tokens.accessToken });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      request.log.error({ err }, 'Unexpected error during token refresh');
      throw err;
    }
  });

  // Logout
  app.post('/api/auth/logout', async (request, reply) => {
    const cookieToken = (request.cookies as Record<string, string>)?.refreshToken;
    if (cookieToken) {
      await logout(cookieToken);
    }

    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return reply.code(200).send({ message: 'Logged out' });
  });

  // Get current user
  app.get('/api/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = await getUserById(request.user!.userId);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return reply.code(200).send({ user });
  });
}
