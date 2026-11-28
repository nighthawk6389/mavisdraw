/**
 * What a socket may send for documents it hasn't authenticated. Hocuspocus
 * queues every message for a document until that document authenticates,
 * so without a budget a client could authenticate one document and then
 * pile unbounded data onto others it never authenticates.
 */

/** Longest document name worth reading ("diagram:" plus an id). */
const MAX_NAME_BYTES = 512;
const utf8 = new TextDecoder();

/**
 * The document a Hocuspocus message is for: its first field, a UTF-8 string
 * prefixed with its length as a lib0 varUint. null if it can't be read.
 */
export function documentNameOf(data: Uint8Array): string | null {
  let length = 0;
  let shift = 0;
  let i = 0;
  for (;;) {
    if (i >= data.length || shift > 21) return null;
    const byte = data[i++];
    length += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) break;
    shift += 7;
  }
  if (length > MAX_NAME_BYTES || i + length > data.length) return null;
  return utf8.decode(data.subarray(i, i + length));
}

/** Bytes queued per document still waiting to authenticate on one socket. */
export class PendingBudget {
  private readonly pending = new Map<string, number>();
  private total = 0;

  constructor(
    readonly limitBytes: number,
    readonly maxDocuments: number,
  ) {}

  /** Bytes arrived for a document not authenticated on this socket: false once over budget. */
  add(documentName: string, bytes: number): boolean {
    if (!this.pending.has(documentName) && this.pending.size >= this.maxDocuments) return false;
    this.pending.set(documentName, (this.pending.get(documentName) ?? 0) + bytes);
    this.total += bytes;
    return this.total <= this.limitBytes;
  }

  /** The document authenticated: what it queued is being handled now. */
  release(documentName: string): void {
    const bytes = this.pending.get(documentName);
    if (bytes === undefined) return;
    this.total -= bytes;
    this.pending.delete(documentName);
  }

  get queuedBytes(): number {
    return this.total;
  }
}

/** A ws message as bytes (it may arrive as fragments). */
export function messageBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}
