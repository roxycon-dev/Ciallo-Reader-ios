import { describe, expect, it } from 'vitest';
import { detect } from '../../src/core/parser/charsetSniffer';

describe('charsetSniffer', () => {
  it('detects utf-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(detect(bytes)).toBe('utf-8');
  });

  it('detects utf-8 text without BOM', () => {
    const bytes = new TextEncoder().encode('Hello 世界 你好');
    expect(detect(bytes)).toBe('utf-8');
  });

  it('detects utf-16le BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]);
    expect(detect(bytes)).toBe('utf-16le');
  });

  it('detects utf-16be BOM', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f]);
    expect(detect(bytes)).toBe('utf-16be');
  });

  it('detects utf-16le via zero-byte heuristic', () => {
    const bytes = new Uint8Array([
      0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00,
      0x57, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x6c, 0x00, 0x64, 0x00,
    ]);
    expect(detect(bytes)).toBe('utf-16le');
  });

  it('throws when encoding cannot be identified', () => {
    const bytes = new Uint8Array(16).fill(0xff);
    expect(() => detect(bytes)).toThrow();
  });
});
