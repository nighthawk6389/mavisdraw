import type { MavisElement, Point } from '@mavisdraw/types';
import type { CommentThreadData, Member } from '../../services/api';

/**
 * Where a thread's pin sits in canvas coordinates: on its element (so the
 * pin travels when the shape moves), or where it was placed if the element
 * has since been deleted.
 */
export function threadAnchor(
  thread: Pick<CommentThreadData, 'elementId' | 'x' | 'y' | 'offsetX' | 'offsetY'>,
  elements: Map<string, MavisElement>,
): Point {
  const el = thread.elementId ? elements.get(thread.elementId) : undefined;
  if (el && !el.isDeleted) return { x: el.x + thread.offsetX, y: el.y + thread.offsetY };
  return { x: thread.x, y: thread.y };
}

// ── @mentions ──────────────────────────────────────────────────────────

export interface MentionQuery {
  /** Index of the '@' in the text. */
  start: number;
  query: string;
}

/** The '@name' being typed at the caret, if any (names may contain spaces). */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null; // e.g. an email address
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

/** Members matching what's typed after '@' (prefix of any word in the name first). */
export function matchMembers(members: Member[], query: string, limit = 6): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, limit);
  const starts = members.filter((m) => m.name.toLowerCase().startsWith(q));
  const words = members.filter(
    (m) =>
      !starts.includes(m) &&
      m.name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q)),
  );
  return [...starts, ...words].slice(0, limit);
}

/** Replace the '@query' at `start..caret` with '@Name '. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  member: Member,
): { text: string; caret: number } {
  const insert = `@${member.name} `;
  return {
    text: text.slice(0, start) + insert + text.slice(caret),
    caret: start + insert.length,
  };
}

/** Ids of the members whose '@Name' still appears in the body. */
export function mentionsInBody(body: string, members: Member[]): string[] {
  return members.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
}

export interface BodySegment {
  text: string;
  mentionId?: string;
}

/** Split a comment body into plain text and highlighted '@Name' mentions. */
export function bodySegments(body: string, mentioned: Member[]): BodySegment[] {
  const names = [...mentioned].sort((a, b) => b.name.length - a.name.length);
  const segments: BodySegment[] = [];
  let i = 0;
  let plain = '';
  while (i < body.length) {
    const hit = body[i] === '@' ? names.find((m) => body.startsWith(`@${m.name}`, i)) : undefined;
    if (hit) {
      if (plain) segments.push({ text: plain });
      plain = '';
      segments.push({ text: `@${hit.name}`, mentionId: hit.id });
      i += hit.name.length + 1;
    } else {
      plain += body[i];
      i += 1;
    }
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
