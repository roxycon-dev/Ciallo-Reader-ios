import { describe, expect, it } from 'vitest';
import { ArchiveBudget, zipSlipSafeDestination } from '../../src/core/data/archiveBudget';

describe('archiveBudget', () => {
  it('rejects zip slip with both path separators', () => {
    const root = 'C:/tmp/safe-root';
    for (const name of ['../outside.jpg', '..\\outside.jpg', 'images/../../outside.jpg']) {
      expect(() => zipSlipSafeDestination(root, name)).toThrow();
    }
  });

  it('rejects absolute paths', () => {
    const root = 'C:/tmp/safe-root';
    for (const name of ['/outside.jpg', 'C:/outside.jpg', 'c:\\outside.jpg']) {
      expect(() => zipSlipSafeDestination(root, name)).toThrow(/绝对路径/);
    }
  });

  it('accepts nested relative paths under root', () => {
    const dest = zipSlipSafeDestination('C:/tmp/safe-root', 'images/page.jpg');
    expect(dest).toBe('C:/tmp/safe-root/images/page.jpg');
  });

  it('enforces per-entry, total, and entry-count limits', () => {
    const budget = new ArchiveBudget(10, 15, 2);
    budget.copyEntry(new Uint8Array(10));
    expect(() => budget.copyEntry(new Uint8Array(6))).toThrow(/体积/);
    const entries = new ArchiveBudget(64 * 1024 * 1024, 512 * 1024 * 1024, 1);
    entries.copyEntry(new Uint8Array(0));
    expect(() => entries.copyEntry(new Uint8Array(0))).toThrow(/条目过多/);
  });
});
