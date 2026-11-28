/**
 * Who is in a live room, as the server knows them. Each client announces its
 * own name in the shared awareness state, so anyone could show up as someone
 * else. Instead, the server notes which signed-in person sent each awareness
 * client (the first to use a client id owns it) and tells the room, in a
 * stateless message only the server can send. The app shows people by that,
 * never by what a client says about itself.
 */

export const PRESENCE_MESSAGE = 'mavisdraw:presence';

/** Tabs one person can have in a room before more stop being named (keeps the message small). */
const MAX_CLIENTS_PER_PERSON = 16;

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] };

export interface PresenceIdentity {
  userId: string;
  name: string;
}

/** The parts of a Hocuspocus document this needs. */
export interface PresenceRoom {
  awareness: {
    on(event: 'update', listener: (change: AwarenessChange, origin: unknown) => void): void;
  };
  connections: Map<unknown, { connection: { context: unknown } }>;
  broadcastStateless(payload: string): void;
}

const userOf = (context: unknown): PresenceIdentity | null => {
  const user = (context as { user?: { id?: unknown; name?: unknown } } | null)?.user;
  if (!user || typeof user.id !== 'string' || !user.id) return null;
  return { userId: user.id, name: typeof user.name === 'string' ? user.name : '' };
};

/** The message telling the room who each client is. */
export function presenceMessage(identities: Map<number, PresenceIdentity>): string {
  return JSON.stringify({ type: PRESENCE_MESSAGE, clients: Object.fromEntries(identities) });
}

/** Start telling a room who its clients are; returns the identities, for tests. */
export function trackPresence(room: PresenceRoom): Map<number, PresenceIdentity> {
  const identities = new Map<number, PresenceIdentity>();
  let last = '';
  room.awareness.on('update', ({ added, updated, removed }, origin) => {
    // A change sent over a socket is that socket's person's. Anything else
    // is the server's own (a socket closing, a state timing out)
    const socket = origin == null ? undefined : room.connections.get(origin);
    const sender = socket ? userOf(socket.connection.context) : null;
    let changed = false;
    if (sender) {
      let theirs = 0;
      for (const who of identities.values()) if (who.userId === sender.userId) theirs++;
      for (const id of [...added, ...updated]) {
        if (identities.has(id) || theirs >= MAX_CLIENTS_PER_PERSON) continue;
        identities.set(id, sender);
        theirs++;
        changed = true;
      }
    }
    // Anyone may send a removal for any client: only the server's, or the
    // owner's own, frees a client id (else it could be claimed by another)
    for (const id of removed) {
      const owner = identities.get(id);
      if (!owner || (socket && owner.userId !== sender?.userId)) continue;
      identities.delete(id);
      changed = true;
    }
    if (!changed) return;
    const message = presenceMessage(identities);
    if (message === last) return;
    last = message;
    room.broadcastStateless(message);
  });
  return identities;
}
