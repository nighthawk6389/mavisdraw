import { describe, it, expect, vi } from 'vitest';
import { PRESENCE_MESSAGE, trackPresence, type PresenceRoom } from '../ws/presence.js';

type Change = { added: number[]; updated: number[]; removed: number[] };

/** A room with two signed-in sockets (Alice's and Mallory's) and an awareness to drive. */
function room() {
  let listener: (change: Change, origin: unknown) => void = () => {};
  const alice = Symbol('alice socket');
  const mallory = Symbol('mallory socket');
  const broadcastStateless = vi.fn();
  const fake: PresenceRoom = {
    awareness: { on: (_event, l) => (listener = l) },
    connections: new Map<unknown, { connection: { context: unknown } }>([
      [alice, { connection: { context: { user: { id: 'alice', name: 'Alice' } } } }],
      [mallory, { connection: { context: { user: { id: 'mallory', name: 'Mallory' } } } }],
    ]),
    broadcastStateless,
  };
  const identities = trackPresence(fake);
  const change = (origin: unknown, c: Partial<Change>) =>
    listener({ added: [], updated: [], removed: [], ...c }, origin);
  const lastMessage = () =>
    JSON.parse(broadcastStateless.mock.calls.at(-1)![0] as string) as {
      type: string;
      clients: Record<string, { userId: string; name: string }>;
    };
  return { identities, change, lastMessage, broadcastStateless, alice, mallory };
}

describe('presence: who each client in a room is', () => {
  it('names each client by the person whose socket sent it, and tells the room', () => {
    const r = room();
    r.change(r.alice, { added: [1] });
    r.change(r.mallory, { added: [2] });
    expect(r.lastMessage()).toEqual({
      type: PRESENCE_MESSAGE,
      clients: {
        1: { userId: 'alice', name: 'Alice' },
        2: { userId: 'mallory', name: 'Mallory' },
      },
    });
  });

  it('a client id belongs to whoever used it first: nobody can take over someone else’s', () => {
    const r = room();
    r.change(r.alice, { added: [1] });
    r.change(r.mallory, { updated: [1] });
    expect(r.identities.get(1)?.userId).toBe('alice');
    // Nor free it with a removal of their own, to claim it afterwards
    r.change(r.mallory, { removed: [1] });
    r.change(r.mallory, { added: [1] });
    expect(r.identities.get(1)?.userId).toBe('alice');
    expect(r.broadcastStateless).toHaveBeenCalledTimes(1);
  });

  it('forgets a client when its socket closes or its state times out', () => {
    const r = room();
    r.change(r.alice, { added: [1, 3] });
    r.change(null, { removed: [1] });
    r.change('timeout', { removed: [3] });
    expect(r.identities.size).toBe(0);
    expect(r.lastMessage().clients).toEqual({});
  });

  it('the owner can remove their own client', () => {
    const r = room();
    r.change(r.alice, { added: [1] });
    r.change(r.alice, { removed: [1] });
    expect(r.identities.has(1)).toBe(false);
  });

  it('ignores updates from sockets it doesn’t know, and caps clients per person', () => {
    const r = room();
    r.change(Symbol('stranger'), { added: [9] });
    expect(r.identities.size).toBe(0);
    r.change(r.mallory, { added: Array.from({ length: 50 }, (_, i) => 100 + i) });
    expect(r.identities.size).toBe(16);
  });
});
