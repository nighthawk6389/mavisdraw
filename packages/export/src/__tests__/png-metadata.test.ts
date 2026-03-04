import { describe, it, expect } from 'vitest';
import { embedPngTextChunk, extractPngTextChunk } from '../utils/png-metadata';

/**
 * Create a minimal valid PNG file (1x1 red pixel).
 * Structure: PNG signature + IHDR + IDAT + IEND.
 */
function createMinimalPng(): ArrayBuffer {
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (width=1, height=1, bit depth=8, color type=2 (RGB))
  const ihdrData = new Uint8Array([
    0, 0, 0, 1, // width
    0, 0, 0, 1, // height
    8, // bit depth
    2, // color type (RGB)
    0, // compression
    0, // filter
    0, // interlace
  ]);
  const ihdr = buildChunk('IHDR', ihdrData);

  // IDAT chunk (minimal deflate stream for 1x1 RGB: filter byte + 3 bytes)
  // Zlib: CMF=0x78, FLG=0x01, deflate blocks, Adler32
  const idatData = new Uint8Array([
    0x78, 0x01, // zlib header
    0x62, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01, // deflated data
  ]);
  const idat = buildChunk('IDAT', idatData);

  // IEND chunk (empty)
  const iend = buildChunk('IEND', new Uint8Array(0));

  // Combine
  const totalLength =
    signature.length + ihdr.length + idat.length + iend.length;
  const result = new ArrayBuffer(totalLength);
  const view = new Uint8Array(result);
  let offset = 0;
  view.set(signature, offset);
  offset += signature.length;
  view.set(ihdr, offset);
  offset += ihdr.length;
  view.set(idat, offset);
  offset += idat.length;
  view.set(iend, offset);

  return result;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const length = data.length;
  const chunk = new Uint8Array(4 + 4 + length + 4);
  const view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, length, false);

  // Type
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);
  chunk.set(typeBytes, 4);

  // Data
  chunk.set(data, 8);

  // CRC (simplified — just write zeros; the PNG reader won't validate for our test)
  view.setUint32(8 + length, 0, false);

  return chunk;
}

describe('PNG metadata', () => {
  it('embeds and extracts a text chunk', () => {
    const png = createMinimalPng();
    const keyword = 'mavisdraw-scene';
    const text = '{"type":"mavisdraw","version":1}';

    const embedded = embedPngTextChunk(png, keyword, text);
    const extracted = extractPngTextChunk(embedded, keyword);

    expect(extracted).toBe(text);
  });

  it('returns null when keyword not found', () => {
    const png = createMinimalPng();
    const result = extractPngTextChunk(png, 'nonexistent');
    expect(result).toBeNull();
  });

  it('handles large JSON payloads', () => {
    const png = createMinimalPng();
    const largeText = JSON.stringify({
      elements: Array.from({ length: 100 }, (_, i) => ({
        id: `el-${i}`,
        type: 'rectangle',
        x: i * 10,
        y: i * 10,
      })),
    });

    const embedded = embedPngTextChunk(png, 'test-key', largeText);
    const extracted = extractPngTextChunk(embedded, 'test-key');
    expect(extracted).toBe(largeText);
  });

  it('throws on non-PNG buffer', () => {
    const notPng = new ArrayBuffer(8);
    expect(() => embedPngTextChunk(notPng, 'key', 'value')).toThrow(
      'Not a valid PNG file',
    );
  });

  it('returns null for non-PNG on extract', () => {
    const notPng = new ArrayBuffer(8);
    expect(extractPngTextChunk(notPng, 'key')).toBeNull();
  });

  it('can embed multiple chunks and retrieve each', () => {
    let png = createMinimalPng();
    png = embedPngTextChunk(png, 'key1', 'value1');
    png = embedPngTextChunk(png, 'key2', 'value2');

    expect(extractPngTextChunk(png, 'key1')).toBe('value1');
    expect(extractPngTextChunk(png, 'key2')).toBe('value2');
  });
});
