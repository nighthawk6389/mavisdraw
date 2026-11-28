import { test, expect } from '@playwright/test';
import { API_URL, apiCreateProject, registerUser } from './helpers';

/**
 * What a live socket may send before its documents authenticate. Hocuspocus
 * queues a document's messages until that document authenticates, so data
 * for documents never authenticated must be bounded — after a first
 * document on the same socket authenticated, too.
 */

const WS_URL = `${API_URL.replace(/^http/, 'ws')}/collaboration`;

/** lib0 varUint, then the bytes. */
function varBytes(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let n = bytes.length;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return [...out, ...bytes];
}
const varString = (s: string) => varBytes(new TextEncoder().encode(s));

/** Hocuspocus Auth message: [document][Auth=2][Token=0][token]. */
const authMessage = (doc: string, token: string) =>
  new Uint8Array([...varString(doc), 2, 0, ...varString(token)]);

/** A Sync message carrying `size` bytes of filler. */
const bulkMessage = (doc: string, size: number) =>
  new Uint8Array([...varString(doc), 0, ...new Uint8Array(size)]);

test('a socket can’t pile data onto documents it never authenticated', async ({ context }) => {
  const user = await registerUser(context, 'Socket Sam');
  const project = await apiCreateProject(context.request, user, 'Socket map');
  const doc = `diagram:${project.rootDiagramId}`;

  const socket = new WebSocket(WS_URL);
  socket.binaryType = 'arraybuffer';
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener('close', (e) => resolve(e.code)),
  );
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket failed to open')));
  });

  // One document authenticates…
  const authenticated = new Promise<void>((resolve) =>
    socket.addEventListener('message', (e) => {
      const bytes = new Uint8Array(e.data as ArrayBuffer);
      const name = varString(doc);
      // [document][Auth=2][Authenticated=2]
      if (
        name.every((b, i) => bytes[i] === b) &&
        bytes[name.length] === 2 &&
        bytes[name.length + 1] === 2
      ) {
        resolve();
      }
    }),
  );
  socket.send(authMessage(doc, user.accessToken));
  await authenticated;

  // …then data for documents that never authenticate is cut off
  for (let i = 0; i < 6; i++) socket.send(bulkMessage(`diagram:never-${i}`, 60 * 1024));
  expect(await closed).toBe(1009);
});
