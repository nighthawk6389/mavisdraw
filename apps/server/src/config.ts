/**
 * Server configuration, read once from the environment.
 *
 * In production every secret must be set explicitly: the server refuses to
 * start rather than run with a guessable development default (a known JWT
 * secret would let anyone mint tokens for any user). In development the
 * defaults keep `pnpm dev` working with no setup.
 */

export interface GitHubHostConfig {
  /** Web origin, e.g. https://github.com or https://github.acme.com */
  url: string;
  clientId: string;
  clientSecret: string;
}

export interface Config {
  isProduction: boolean;
  databaseUrl: string;
  jwtSecret: string;
  cookieSecret: string;
  corsOrigin: string;
  /** Fastify trustProxy: false, true, a hop count, or a list of addresses/CIDRs. */
  trustProxy: boolean | number | string;
  logLevel: string;
  /** Public URL of the web app (links in emails). */
  appUrl: string;
  mail: {
    provider: 'resend' | 'postmark' | 'log' | 'outbox' | 'none';
    from: string;
    apiKey: string;
  };
  github: {
    redirectUri: string;
    /** github.com OAuth app (empty when not configured). */
    cloud: GitHubHostConfig;
    /** One GitHub Enterprise Server, if configured. Only this host is ever contacted besides github.com. */
    enterprise: GitHubHostConfig | null;
  };
}

const DEV = {
  databaseUrl: 'postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw',
  jwtSecret: 'mavisdraw-dev-secret-change-in-production',
  cookieSecret: 'mavisdraw-cookie-secret-dev-only',
};

/** Parse TRUST_PROXY: "true"/"false", a hop count, or addresses/CIDRs. */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false' || v === '0') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return value.trim();
}

/** Normalise a configured or user-supplied GitHub URL to its origin ("" if invalid). */
export function originOf(url: string | undefined | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): {
  config: Config;
  problems: string[];
} {
  const isProduction = env.NODE_ENV === 'production';
  const problems: string[] = [];

  const secret = (name: string, devDefault: string, minLength = 32): string => {
    const value = env[name];
    if (value && (!isProduction || value.length >= minLength)) return value;
    if (isProduction) {
      problems.push(`${name} must be set to a random value of at least ${minLength} characters`);
      return '';
    }
    return value || devDefault;
  };
  const required = (name: string, devDefault: string): string => {
    const value = env[name];
    if (value) return value;
    if (isProduction) problems.push(`${name} must be set`);
    return devDefault;
  };

  const enterpriseUrl = originOf(env.GITHUB_ENTERPRISE_URL);
  if (env.GITHUB_ENTERPRISE_URL && !enterpriseUrl)
    problems.push('GITHUB_ENTERPRISE_URL is not a valid URL');
  if (isProduction && enterpriseUrl && !enterpriseUrl.startsWith('https://')) {
    problems.push('GITHUB_ENTERPRISE_URL must use https');
  }
  const enterprise =
    enterpriseUrl && env.GITHUB_ENTERPRISE_CLIENT_ID && env.GITHUB_ENTERPRISE_CLIENT_SECRET
      ? {
          url: enterpriseUrl,
          clientId: env.GITHUB_ENTERPRISE_CLIENT_ID,
          clientSecret: env.GITHUB_ENTERPRISE_CLIENT_SECRET,
        }
      : null;
  if (enterpriseUrl && !enterprise) {
    problems.push(
      'GITHUB_ENTERPRISE_URL needs GITHUB_ENTERPRISE_CLIENT_ID and GITHUB_ENTERPRISE_CLIENT_SECRET',
    );
  }

  const githubConfigured = !!(env.GITHUB_CLIENT_ID || enterprise);
  if (
    isProduction &&
    githubConfigured &&
    !/^[0-9a-f]{64}$/i.test(env.GITHUB_TOKEN_ENCRYPTION_KEY ?? '')
  ) {
    problems.push(
      'GITHUB_TOKEN_ENCRYPTION_KEY must be 64 hex characters when GitHub is configured',
    );
  }

  const provider = (env.MAIL_PROVIDER ?? (isProduction ? 'none' : 'log')).toLowerCase();
  if (!['resend', 'postmark', 'log', 'outbox', 'none'].includes(provider)) {
    problems.push('MAIL_PROVIDER must be resend, postmark, log, outbox or none');
  }
  const mailKey =
    provider === 'resend'
      ? env.RESEND_API_KEY
      : provider === 'postmark'
        ? env.POSTMARK_SERVER_TOKEN
        : '';
  if ((provider === 'resend' || provider === 'postmark') && !mailKey) {
    problems.push(
      `MAIL_PROVIDER=${provider} needs ${provider === 'resend' ? 'RESEND_API_KEY' : 'POSTMARK_SERVER_TOKEN'}`,
    );
  }
  if ((provider === 'resend' || provider === 'postmark') && !env.MAIL_FROM) {
    problems.push('MAIL_FROM must be set (e.g. "MavisDraw <notifications@yourdomain.com>")');
  }

  const config: Config = {
    isProduction,
    databaseUrl: required('DATABASE_URL', DEV.databaseUrl),
    jwtSecret: secret('JWT_SECRET', DEV.jwtSecret),
    cookieSecret: secret('COOKIE_SECRET', DEV.cookieSecret),
    corsOrigin: required('CORS_ORIGIN', 'http://localhost:3000'),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    logLevel: env.LOG_LEVEL ?? 'info',
    appUrl: (env.APP_URL ?? env.CORS_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, ''),
    mail: {
      provider: provider as Config['mail']['provider'],
      from: env.MAIL_FROM ?? 'MavisDraw <notifications@localhost>',
      apiKey: mailKey ?? '',
    },
    github: {
      redirectUri: env.GITHUB_REDIRECT_URI ?? 'http://localhost:3000/oauth/github/callback.html',
      cloud: {
        url: 'https://github.com',
        clientId: env.GITHUB_CLIENT_ID ?? '',
        clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
      },
      enterprise,
    },
  };
  return { config, problems };
}

const loaded = loadConfig();
export const config = loaded.config;

/** Stop the server from starting with an unsafe production configuration. */
export function assertValidConfig(): void {
  if (loaded.problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${loaded.problems.join('\n  - ')}`);
  }
}
