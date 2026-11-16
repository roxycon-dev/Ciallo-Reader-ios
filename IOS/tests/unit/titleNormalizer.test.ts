import { describe, expect, it } from 'vitest';
import { compact, normalize, usableVariant } from '../../src/core/data/titleNormalizer';

describe('titleNormalizer', () => {
  it('folds traditional 無職転生 → 无职转生', () => {
    expect(normalize('無職転生')).toBe('无职转生');
  });

  it('compact removes spaces', () => {
    expect(compact('Mushoku Tensei')).toBe('mushokutensei');
    expect(compact('無職転生')).toBe('无职转生');
  });

  it('NFKC + lowercase + punctuation → space', () => {
    expect(normalize('Ｆｕｌｌ！Ｍｅｔａｌ')).toBe('full metal');
  });

  it('usableVariant requires length >= 2', () => {
    expect(usableVariant('无')).toBe(false);
    expect(usableVariant('无职')).toBe(true);
    expect(usableVariant('   ')).toBe(false);
  });
});
