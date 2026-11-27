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
  /**
   * Send the session cookie only over HTTPS. Follows APP_URL (a self-hosted
   * instance on plain http:// would otherwise lose its session on reload);
   * COOKIE_SECURE=true|false overrides.
   */
  cookieSecure: boolean;
  mail: {
    provider: 'resend' | 'postmark' | 'smtp' | 'log' | 'outbox' | 'none';
    from: string;
    apiKey: string;
    /** smtp(s)://user:pass@host:port, for MAIL_PROVIDER=smtp. */
    smtpUrl: string;
  };
  github: {
    redirectUri: string;
    /** github.com OAuth app (empty when not configured). */
    cloud: GitHubHostConfig;
    /** One GitHub Enterprise Server, if configured. Only this host is ever contacted besides github.com. */
    enterprise: GitHubHostConfig | null;
  };
  /** The GitHub App behind pull-request map checks (null when not set up). */
  githubApp: GitHubAppConfig | null;
}

export interface GitHubAppConfig {
  appId: string;
  /** PEM private key, for signing the app's JWTs. */
  privateKey: string;
  /** Shared secret GitHub signs webhook deliveries with. */
  webhookSecret: string;
  /** The app's URL name, for "install the app" links. */
  slug: string | null;
  /** REST API base (github.com's by default; Enterprise or a test double otherwise). */
  apiUrl: string;
  /** Web origin, for install links. */
  webUrl: string;
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

  // GitHub App (PR checks): all three secrets, or none
  const appParts = [env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, env.GITHUB_APP_WEBHOOK_SECRET];
  let githubApp: GitHubAppConfig | null = null;
  if (appParts.some(Boolean)) {
    if (!appParts.every(Boolean)) {
      problems.push(
        'The GitHub App needs GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_WEBHOOK_SECRET together',
      );
    } else {
      // Render and .env files often hold the PEM on one line with \n escapes
      const privateKey = env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n');
      if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
        problems.push('GITHUB_APP_PRIVATE_KEY must be the PEM private key GitHub generated');
      }
      if (isProduction && env.GITHUB_APP_WEBHOOK_SECRET!.length < 16) {
        problems.push('GITHUB_APP_WEBHOOK_SECRET must be at least 16 characters');
      }
      const apiUrl = (env.GITHUB_APP_API_URL || 'https://api.github.com').replace(/\/+$/, '');
      if (isProduction && !apiUrl.startsWith('https://')) {
        problems.push('GITHUB_APP_API_URL must use https');
      }
      githubApp = {
        appId: env.GITHUB_APP_ID!,
        privateKey,
        webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET!,
        slug: env.GITHUB_APP_SLUG || null,
        apiUrl,
        webUrl: originOf(env.GITHUB_APP_WEB_URL) || 'https://github.com',
      };
    }
  }

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  // "true" trusts every hop, so the client address becomes whatever the client
  // put first in X-Forwarded-For: every rate limit could be dodged
  if (isProduction && trustProxy === true) {
    problems.push(
      'TRUST_PROXY=true trusts any X-Forwarded-For a client sends: set the number of proxies in front of the API (usually 1) or their addresses',
    );
  }

  const provider = (env.MAIL_PROVIDER ?? (isProduction ? 'none' : 'log')).toLowerCase();
  if (!['resend', 'postmark', 'smtp', 'log', 'outbox', 'none'].includes(provider)) {
    problems.push('MAIL_PROVIDER must be resend, postmark, smtp, log, outbox or none');
  }
  const smtpUrl = env.SMTP_URL ?? '';
  if (provider === 'smtp') {
    let valid: boolean;
    try {
      valid = ['smtp:', 'smtps:'].includes(new URL(smtpUrl).protocol);
    } catch {
      valid = false;
    }
    if (!valid) {
      problems.push(
        'MAIL_PROVIDER=smtp needs SMTP_URL, e.g. smtp://user:password@smtp.example.com:587',
      );
    }
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
  if ((provider === 'resend' || provider === 'postmark' || provider === 'smtp') && !env.MAIL_FROM) {
    problems.push('MAIL_FROM must be set (e.g. "MavisDraw <notifications@yourdomain.com>")');
  }

  const appUrl = (env.APP_URL ?? env.CORS_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
  const config: Config = {
    isProduction,
    databaseUrl: required('DATABASE_URL', DEV.databaseUrl),
    jwtSecret: secret('JWT_SECRET', DEV.jwtSecret),
    cookieSecret: secret('COOKIE_SECRET', DEV.cookieSecret),
    corsOrigin: required('CORS_ORIGIN', 'http://localhost:3000'),
    trustProxy,
    logLevel: env.LOG_LEVEL ?? 'info',
    appUrl,
    cookieSecure:
      env.COOKIE_SECURE !== undefined
        ? env.COOKIE_SECURE.trim().toLowerCase() === 'true'
        : appUrl.startsWith('https://'),
    mail: {
      provider: provider as Config['mail']['provider'],
      from: env.MAIL_FROM ?? 'MavisDraw <notifications@localhost>',
      apiKey: mailKey ?? '',
      smtpUrl,
    },
    github: {
      redirectUri: env.GITHUB_REDIRECT_URI ?? `${appUrl}/oauth/github/callback.html`,
      cloud: {
        url: 'https://github.com',
        clientId: env.GITHUB_CLIENT_ID ?? '',
        clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
      },
      enterprise,
    },
    githubApp,
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
