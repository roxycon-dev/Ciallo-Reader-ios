import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BookContentAccumulator, BookContentFingerprint, portableRawBodyIdentity } from '@core/transfer/bookFingerprint';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
describe('resource-aware Android transfer book identity', () => {
  it('merges relocated novel images by their bytes and never by their old path', async () => {
    const hash = sha('same image bytes'), lookup = vi.fn(async () => hash), fingerprint = new BookContentFingerprint(lookup);
    const first = await fingerprint.chapter('前[IMG:/android/cover.png]后', 'NOVEL'), moved = await fingerprint.chapter('前[IMG:@FILES@/ios/cover.png]后', 'NOVEL');
    expect(first).toBe(sha(`前[IMG:sha256:${hash}]后`)); expect(moved).toBe(first);
    expect(await new BookContentFingerprint(async () => sha('different image')).chapter('前[IMG:/android/cover.png]后', 'NOVEL')).not.toBe(first);
  });
  it('hashes a comic page directly and hashes public image URLs without making a request', async () => {
    const lookup = vi.fn(async () => sha('page')), fingerprint = new BookContentFingerprint(lookup);
    expect(await fingerprint.chapter('  @FILES@/comics/page.jpg  ', 'COMIC')).toBe(sha(`[IMG:sha256:${sha('page')}]`));
    const url = 'https://example.org/page.jpg';
    expect(await fingerprint.chapter(url, 'COMIC')).toBe(sha(`[IMG:sha256:url:${sha(url)}]`)); expect(lookup).toHaveBeenCalledTimes(1);
  });
  it('keeps missing-image and empty-book identities unresolved instead of collapsing editions', async () => {
    const fingerprint = new BookContentFingerprint(async () => null);
    expect(await fingerprint.chapter('缺图[IMG:missing.jpg]', 'NOVEL')).toBeNull();
    expect(await fingerprint.book([{ chapterOrder: 0, title: '空章', content: ' ' }], 'NOVEL')).toBeNull();
    expect(await fingerprint.book([], 'COMIC')).toBeNull();
  });
  it('caches local resource lookups and treats read failures as unresolved while propagating cancellation', async () => {
    const lookup = vi.fn(async () => { throw new Error('File missing'); }), fingerprint = new BookContentFingerprint(lookup);
    await fingerprint.chapter('[IMG:gone]', 'NOVEL'); await fingerprint.chapter('[IMG:gone]', 'NOVEL'); expect(lookup).toHaveBeenCalledOnce();
    const cancelled = new BookContentFingerprint(async () => { throw new DOMException('Cancelled', 'AbortError'); });
    await expect(cancelled.chapter('[IMG:page]', 'NOVEL')).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('matches Android order/title/content-hash/NUL accumulation and supports stable repeated finish', () => {
    const body = new BookContentAccumulator(), content = sha('正文'); body.add(0, '第一章', content, true);
    const expected = 'body-content:' + sha(`0\0第一章\0${content}\0NOVEL`);
    expect(body.finish('NOVEL')).toBe(expected); expect(body.finish('NOVEL')).toBe(expected);
    expect(body.finish('COMIC')).not.toBe(expected);
  });
  it('matches the raw body fallback and normalizes only the device root', () => {
    const book = { title: '书籍', author: '作者', filePath: '/local/imports/book.epub', contentType: 'NOVEL', totalChapters: 1 };
    const chapters = [{ chapterOrder: 0, title: '第一章', content: '文[IMG:/local/image.jpg]' }];
    expect(portableRawBodyIdentity(book, chapters, '/local')).toBe('body:' + sha('0\0第一章\0文[IMG:@FILES@/image.jpg]\0NOVEL'));
    expect(portableRawBodyIdentity({ ...book, totalChapters: 0 }, [], '/local')).not.toBe(portableRawBodyIdentity({ ...book, totalChapters: 0, title: '另一本书' }, [], '/local'));
  });
});
