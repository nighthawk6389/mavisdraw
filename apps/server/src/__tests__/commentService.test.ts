import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/client.js', () => ({ db: {} }));

const { notificationRecipients, validMentions } = await import('../services/commentService.js');

const members = new Set(['alice', 'bob', 'carol', 'dan']);

describe('comment notifications', () => {
  it('mentioned members get a mention; earlier participants get a reply', () => {
    const out = notificationRecipients({
      authorId: 'alice',
      mentions: ['bob'],
      participants: ['alice', 'carol'],
      memberIds: members,
    });
    expect(out).toEqual([
      { userId: 'bob', type: 'mention' },
      { userId: 'carol', type: 'reply' },
    ]);
  });

  it('never notifies the author, and one notification per person', () => {
    const out = notificationRecipients({
      authorId: 'alice',
      mentions: ['alice', 'bob', 'bob'],
      participants: ['bob', 'alice'],
      memberIds: members,
    });
    expect(out).toEqual([{ userId: 'bob', type: 'mention' }]);
  });

  it('people who lost access are not notified', () => {
    const out = notificationRecipients({
      authorId: 'alice',
      mentions: ['mallory'],
      participants: ['eve'],
      memberIds: members,
    });
    expect(out).toEqual([]);
  });

  it('mentions are limited to project members and de-duplicated', () => {
    expect(validMentions(['bob', 'mallory', 'bob', 'dan'], members)).toEqual(['bob', 'dan']);
  });
});
