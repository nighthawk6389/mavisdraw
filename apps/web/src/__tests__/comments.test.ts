import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import {
  activeMentionQuery,
  anchorAt,
  bodySegments,
  initials,
  insertMention,
  matchMembers,
  mentionsInBody,
  pinPositionsKey,
  readPinPositions,
  relativeTime,
  threadAnchor,
} from '../components/comments/commentUtils';

const members = [
  { id: 'u1', name: 'Ada Lovelace', avatarUrl: null },
  { id: 'u2', name: 'Alan Turing', avatarUrl: null },
  { id: 'u3', name: 'Grace Hopper', avatarUrl: null },
  { id: 'u4', name: 'Ada', avatarUrl: null },
];

describe('comment pin anchoring', () => {
  const thread = { elementId: 'box', x: 10, y: 20, offsetX: 5, offsetY: 7 };

  it('follows the element it was dropped on', () => {
    const els = new Map([['box', { id: 'box', x: 300, y: 400, isDeleted: false } as MavisElement]]);
    expect(threadAnchor(thread, els)).toEqual({ x: 305, y: 407 });
  });

  it('stays where it was placed once the element is deleted', () => {
    const els = new Map([['box', { id: 'box', x: 300, y: 400, isDeleted: true } as MavisElement]]);
    expect(threadAnchor(thread, els)).toEqual({ x: 10, y: 20 });
    expect(threadAnchor({ ...thread, elementId: null }, new Map())).toEqual({ x: 10, y: 20 });
  });
});

describe('what the comment layer re-renders for', () => {
  const el = (id: string, x: number, y: number, isDeleted = false) =>
    [id, { id, x, y, isDeleted } as MavisElement] as const;

  it('changes only when a shape a pin sits on moves', () => {
    const before = new Map([el('pinned', 10, 20), el('other', 0, 0)]);
    const key = pinPositionsKey(before, ['pinned']);
    // Another shape dragged: same value, so no re-render
    expect(pinPositionsKey(new Map([...before, el('other', 500, 500)]), ['pinned'])).toBe(key);
    expect(pinPositionsKey(new Map([...before, el('pinned', 11, 20)]), ['pinned'])).not.toBe(key);
  });

  it('gives back where each one is, leaving out deleted or missing ones', () => {
    const els = new Map([el('a', 1, 2), el('b', 3, 4, true)]);
    const ids = ['a', 'b', 'gone'];
    const positions = readPinPositions(pinPositionsKey(els, ids), ids);
    expect(Array.from(positions)).toEqual([['a', { x: 1, y: 2 }]]);
    const thread = { elementId: 'a', x: 50, y: 60, offsetX: 5, offsetY: 7 };
    expect(anchorAt(thread, positions)).toEqual({ x: 6, y: 9 });
    expect(anchorAt({ ...thread, elementId: 'b' }, positions)).toEqual({ x: 50, y: 60 });
    expect(readPinPositions(pinPositionsKey(els, []), [])).toEqual(new Map());
  });
});

describe('@mentions', () => {
  it('detects the name being typed at the caret, including spaces', () => {
    expect(activeMentionQuery('hi @gr', 6)).toEqual({ start: 3, query: 'gr' });
    expect(activeMentionQuery('@Grace H', 8)).toEqual({ start: 0, query: 'Grace H' });
    expect(activeMentionQuery('mail me@example.com', 19)).toBeNull();
    expect(activeMentionQuery('no mention here', 15)).toBeNull();
    expect(activeMentionQuery('@ada\nnext line', 14)).toBeNull();
  });

  it('matches name prefixes first, then any word in the name', () => {
    expect(matchMembers(members, 'a').map((m) => m.id)).toEqual(['u1', 'u2', 'u4']);
    expect(matchMembers(members, 'hop').map((m) => m.id)).toEqual(['u3']);
    expect(matchMembers(members, '').length).toBe(4);
  });

  it('inserts the full name and moves the caret after it', () => {
    const text = 'ping @gr please';
    const out = insertMention(text, 5, 8, members[2]);
    expect(out.text).toBe('ping @Grace Hopper  please');
    expect(out.caret).toBe('ping @Grace Hopper '.length);
  });

  it('only keeps mentions whose name is still in the text', () => {
    expect(mentionsInBody('thanks @Alan Turing!', members)).toEqual(['u2']);
    expect(mentionsInBody('nobody here', members)).toEqual([]);
  });

  it('highlights the longest matching name', () => {
    const segs = bodySegments('cc @Ada Lovelace and @Ada', [members[0], members[3]]);
    expect(segs).toEqual([
      { text: 'cc ' },
      { text: '@Ada Lovelace', mentionId: 'u1' },
      { text: ' and ' },
      { text: '@Ada', mentionId: 'u4' },
    ]);
  });
});

describe('formatting', () => {
  it('initials and relative times', () => {
    expect(initials('Grace Brewster Hopper')).toBe('GH');
    expect(initials('ada')).toBe('A');
    const now = Date.parse('2026-11-26T12:00:00Z');
    expect(relativeTime('2026-11-26T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-26T11:15:00Z', now)).toBe('45m');
    expect(relativeTime('2026-11-26T02:00:00Z', now)).toBe('10h');
    expect(relativeTime('2026-11-24T12:00:00Z', now)).toBe('2d');
  });
});
