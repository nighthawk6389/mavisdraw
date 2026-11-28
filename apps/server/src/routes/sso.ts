import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import { signInUser } from '../services/authService.js';
import {
  accountFor,
  completeLogin,
  readLoginCookie,
  safeNextPath,
  SsoError,
  startLogin,
} from '../services/oidc.js';
import { reportError } from '../observability.js';
import { disconnectUser } from '../ws/hocuspocus.js';

const COOKIE = 'mavisdraw_oidc';
const COOKIE_PATH = '/api/auth/oidc';

/** Where the provider sends people back (register exactly this at the provider). */
export function oidcCallbackUrl(request: FastifyRequest): string {
  return config.oidc?.redirectUri ?? `${request.protocol}://${request.host}/api/auth/oidc/callback`;
}

/**
 * Single sign-on (docs/sso.md): the browser goes to the provider and comes
 * back signed in, to the page it started from.
 */
export async function ssoRoutes(app: FastifyInstance): Promise<void> {
  const back = (reply: FastifyReply, path: string) =>
    reply.redirect(`${config.appUrl}${path}`, 302);
  const failed = (reply: FastifyReply, code: string) =>
    back(reply.clearCookie(COOKIE, { path: COOKIE_PATH }), `/?sso_error=${code}`);

  app.get('/api/auth/oidc/start', { preHandler: [authRateLimit] }, async (request, reply) => {
    const cfg = config.oidc;
    if (!cfg) return reply.code(404).send({ error: 'Single sign-on isn’t set up on this server' });
    const { next } = request.query as { next?: string };
    try {
      const { url, cookie } = await startLogin(cfg, oidcCallbackUrl(request), safeNextPath(next));
      reply.setCookie(COOKIE, cookie, {
        httpOnly: true,
        secure: config.cookieSecure,
        // The provider sends the browser back with a top-level GET: Lax is enough
        sameSite: 'lax',
        path: COOKIE_PATH,
        maxAge: 10 * 60,
      });
      return reply.redirect(url, 302);
    } catch (err) {
      request.log.error({ err }, 'Single sign-on: could not start');
      reportError(err, { route: 'sso:start' });
      return failed(reply, 'failed');
    }
  });

  app.get('/api/auth/oidc/callback', { preHandler: [authRateLimit] }, async (request, reply) => {
    const cfg = config.oidc;
    if (!cfg) return reply.code(404).send({ error: 'Single sign-on isn’t set up on this server' });
    const query = request.query as { code?: string; state?: string; error?: string };
    try {
      const login = readLoginCookie(
        (request.cookies as Record<string, string | undefined>)[COOKIE],
        query.state,
      );
      if (query.error || !query.code) throw new SsoError('denied', query.error ?? 'No code');
      const identity = await completeLogin(cfg, query.code, login);
      const account = await accountFor(identity);
      // Taken back from whoever registered the address: their open tabs go too
      if (account.tookOver) disconnectUser(app.hocuspocus, account.userId);
      const { tokens } = await signInUser(account.userId);
      reply.clearCookie(COOKIE, { path: COOKIE_PATH });
      reply.setCookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60,
      });
      return back(reply, login.next);
    } catch (err) {
      if (err instanceof SsoError) {
        request.log.warn({ code: err.code, reason: err.message }, 'Single sign-on refused');
        return failed(reply, err.code);
      }
      request.log.error({ err }, 'Single sign-on failed');
      reportError(err, { route: 'sso:callback' });
      return failed(reply, 'failed');
    }
  });
}
