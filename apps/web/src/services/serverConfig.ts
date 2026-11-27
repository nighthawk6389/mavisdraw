import { apiGetServerConfig, type ServerConfig } from './api';

/** What this server offers (asked once per page load). */
let config: Promise<ServerConfig> | null = null;

const FALLBACK: ServerConfig = { mail: true, sso: null, passwordLogin: true };

export function getServerConfig(): Promise<ServerConfig> {
  return (config ??= apiGetServerConfig().catch(() => FALLBACK));
}

/** Whether this server sends email (assumed yes if unknown). */
export function serverSendsEmail(): Promise<boolean> {
  return getServerConfig().then((c) => c.mail);
}
