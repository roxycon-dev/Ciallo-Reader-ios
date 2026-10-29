import { describe, expect, it } from 'vitest';
import { detailLinkResolve, detailLinkValid } from '@core/source/detailLink';

/**
 * 期望值按 Kotlin 源码字面量推演。Kotlin 源：source/DetailLink.kt L7-18。
 */

describe('detailLink (Kotlin DetailLink.kt)', () => {
  describe('valid (L7-12)', () => {
    it('accepts a normal https link', () => {
      expect(detailLinkValid('https://example.com/book/1')).toBe('https://example.com/book/1');
    });

    it('normalises the URL the same way okhttp does', () => {
      // okhttp `HttpUrl.toString()` keeps the path exactly and drops a default port
      expect(detailLinkValid('https://example.com:443/a')).toBe('https://example.com/a');
    });

    it('rejects blank / null / undefined', () => {
      expect(detailLinkValid('')).toBeNull();
      expect(detailLinkValid('   ')).toBeNull();
      expect(detailLinkValid(null)).toBeNull();
      expect(detailLinkValid(undefined)).toBeNull();
    });

    it('rejects control characters (Char::isISOControl)', () => {
      expect(detailLinkValid('https://example.com/a\u0000b')).toBeNull();
      expect(detailLinkValid('https://example.com/a\u007fb')).toBeNull();
      expect(detailLinkValid('https://example.com/a\u009fb')).toBeNull();
    });

    it('rejects a link carrying user-info', () => {
      expect(detailLinkValid('https://user:pass@example.com/a')).toBeNull();
      expect(detailLinkValid('https://user@example.com/a')).toBeNull();
    });

    it('rejects a non-URL string', () => {
      expect(detailLinkValid('not a url')).toBeNull();
      // A bare scheme is not parseable by either implementation
      expect(detailLinkValid('mailto:')).toBeNull();
    });
  });

  describe('resolve (L14-18)', () => {
    const base = 'https://example.com/dir/';

    it('returns an absolute link untouched', () => {
      expect(detailLinkResolve('https://other.com/x', base)).toBe('https://other.com/x');
    });

    it('resolves a relative path against the base', () => {
      expect(detailLinkResolve('book/2', base)).toBe('https://example.com/dir/book/2');
      expect(detailLinkResolve('/root/3', base)).toBe('https://example.com/root/3');
    });

    it('re-validates the resolved link (a user-info base fails closed)', () => {
      expect(detailLinkResolve('book/4', 'https://u:p@example.com/')).toBeNull();
    });

    it('returns null for a blank relative path or an unusable base', () => {
      expect(detailLinkResolve('', base)).toBeNull();
      expect(detailLinkResolve('book/5', 'not a base')).toBeNull();
    });
  });
});
