import { describe, expect, it } from 'vitest';
import { naturalOrderCompare, naturalSort } from '../../src/core/data/naturalOrderCompare';

describe('naturalOrderCompare', () => {
  it('orders a1 < a2 < a10', () => {
    expect(naturalOrderCompare('a1', 'a2')).toBeLessThan(0);
    expect(naturalOrderCompare('a2', 'a10')).toBeLessThan(0);
    expect(naturalOrderCompare('a10', 'a2')).toBeGreaterThan(0);
    expect(naturalOrderCompare('a2', 'a1')).toBeGreaterThan(0);
  });

  it('handles mixed case', () => {
    expect(naturalOrderCompare('a2', 'B10')).toBeLessThan(0);
    expect(naturalOrderCompare('B10', 'a2')).toBeGreaterThan(0);
    expect(naturalOrderCompare('File2', 'file10')).toBeLessThan(0);
  });

  it('skips leading zeros in digit runs', () => {
    // After zero-skip both runs are "2"; equal → full-string compareTo (0002 < 2)
    expect(naturalOrderCompare('p_0002', 'p_2')).toBeLessThan(0);
    expect(naturalOrderCompare('p_0002', 'p_10')).toBeLessThan(0);
    expect(naturalOrderCompare('p_2', 'p_10')).toBeLessThan(0);
  });

  it('naturalSort returns a new sorted list', () => {
    const list = ['a10', 'a2', 'a1'];
    const sorted = naturalSort(list);
    expect(sorted).toEqual(['a1', 'a2', 'a10']);
    expect(list).toEqual(['a10', 'a2', 'a1']);
  });
});
