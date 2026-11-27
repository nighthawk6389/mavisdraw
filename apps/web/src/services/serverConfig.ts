import { apiGetServerConfig } from './api';

/** Whether this server sends email (asked once per page load; assumed yes if unknown). */
let mailEnabled: Promise<boolean> | null = null;

export function serverSendsEmail(): Promise<boolean> {
  return (mailEnabled ??= apiGetServerConfig()
    .then((c) => c.mail)
    .catch(() => true));
}
