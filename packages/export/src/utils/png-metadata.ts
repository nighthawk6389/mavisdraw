/**
 * PNG tEXt chunk encoder/decoder for embedding scene JSON in PNG files.
 *
 * PNG spec: A tEXt chunk contains a null-terminated keyword followed by text data.
 * Chunk layout: [4-byte length][4-byte type "tEXt"][keyword\0text][4-byte CRC-32]
 */

// CRC-32 lookup table (precomputed)
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const view = new Uint8Array(buffer);
  return PNG_SIGNATURE.every((byte, i) => view[i] === byte);
}

/** Read a 4-byte big-endian uint from a DataView. */
function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

/** Get the ASCII chunk type at a given offset. */
function chunkType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Embed a text key-value pair into a PNG ArrayBuffer as a tEXt chunk.
 * Inserts the chunk before the IEND marker.
 */
export function embedPngTextChunk(
  pngBuffer: ArrayBuffer,
  keyword: string,
  text: string,
): ArrayBuffer {
  if (!isPng(pngBuffer)) {
    throw new Error('Not a valid PNG file');
  }

  // Encode keyword + null separator + text
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  const chunkDataLength = keywordBytes.length + 1 + textBytes.length; // +1 for null separator

  // Build the chunk data: keyword + \0 + text
  const chunkData = new Uint8Array(chunkDataLength);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0; // null separator
  chunkData.set(textBytes, keywordBytes.length + 1);

  // Build CRC input: type bytes + data
  const typeBytes = encoder.encode('tEXt');
  const crcInput = new Uint8Array(4 + chunkDataLength);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, 4);
  const crcValue = crc32(crcInput);

  // Full chunk: [4-byte length][4-byte type][data][4-byte CRC]
  const chunkSize = 4 + 4 + chunkDataLength + 4;
  const chunk = new ArrayBuffer(chunkSize);
  const chunkView = new DataView(chunk);
  chunkView.setUint32(0, chunkDataLength, false);
  const chunkArr = new Uint8Array(chunk);
  chunkArr.set(typeBytes, 4);
  chunkArr.set(chunkData, 8);
  chunkView.setUint32(8 + chunkDataLength, crcValue, false);

  // Find IEND chunk position
  const view = new DataView(pngBuffer);
  let offset = 8; // skip PNG signature
  let iendOffset = -1;

  while (offset < pngBuffer.byteLength) {
    const length = readU32(view, offset);
    const type = chunkType(view, offset + 4);
    if (type === 'IEND') {
      iendOffset = offset;
      break;
    }
    offset += 4 + 4 + length + 4; // length field + type + data + CRC
  }

  if (iendOffset === -1) {
    throw new Error('Invalid PNG: IEND chunk not found');
  }

  // Build result: [before IEND] + [new tEXt chunk] + [IEND chunk]
  const before = new Uint8Array(pngBuffer, 0, iendOffset);
  const after = new Uint8Array(pngBuffer, iendOffset);

  const result = new ArrayBuffer(before.length + chunkSize + after.length);
  const resultArr = new Uint8Array(result);
  resultArr.set(before, 0);
  resultArr.set(new Uint8Array(chunk), before.length);
  resultArr.set(after, before.length + chunkSize);

  return result;
}

/**
 * Extract a text chunk from a PNG by keyword.
 * Returns null if the keyword is not found.
 */
export function extractPngTextChunk(
  pngBuffer: ArrayBuffer,
  keyword: string,
): string | null {
  if (!isPng(pngBuffer)) return null;

  const view = new DataView(pngBuffer);
  const decoder = new TextDecoder();
  let offset = 8; // skip PNG signature

  while (offset < pngBuffer.byteLength) {
    const length = readU32(view, offset);
    const type = chunkType(view, offset + 4);

    if (type === 'tEXt') {
      const dataStart = offset + 8;
      const dataBytes = new Uint8Array(pngBuffer, dataStart, length);

      // Find null separator
      let nullIdx = -1;
      for (let i = 0; i < dataBytes.length; i++) {
        if (dataBytes[i] === 0) {
          nullIdx = i;
          break;
        }
      }

      if (nullIdx !== -1) {
        const chunkKeyword = decoder.decode(dataBytes.slice(0, nullIdx));
        if (chunkKeyword === keyword) {
          return decoder.decode(dataBytes.slice(nullIdx + 1));
        }
      }
    }

    if (type === 'IEND') break;
    offset += 4 + 4 + length + 4;
  }

  return null;
}
