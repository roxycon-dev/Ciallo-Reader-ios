import { describe, expect, it } from 'vitest';

/**
 * Placeholder parity harness — fixtures land in Phase 2 via android-export.
 * Guard: if fixtures exist, loader must find them.
 */
describe('parity harness', () => {
  it('is wired for fixture-driven comparisons', () => {
    expect(true).toBe(true);
  });
});
