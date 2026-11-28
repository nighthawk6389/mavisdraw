const DAY_MS = 24 * 60 * 60 * 1000;

/** The lifetimes offered when making a link (days; null: it doesn't expire). */
export const LINK_LIFETIMES: Array<{ days: number | null; label: string }> = [
  { days: 1, label: 'Expires in 1 day' },
  { days: 7, label: 'Expires in 7 days' },
  { days: 30, label: 'Expires in 30 days' },
  { days: null, label: 'Never expires' },
];

/** How a share link's expiry reads in the list ("Expires in 6 days", "Expired"). */
export function describeExpiry(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return 'Never expires';
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return 'Expired';
  if (left < DAY_MS) {
    const hours = Math.ceil(left / (60 * 60 * 1000));
    return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.ceil(left / DAY_MS);
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

export const isExpired = (expiresAt: string | null, now = Date.now()) =>
  !!expiresAt && new Date(expiresAt).getTime() <= now;
