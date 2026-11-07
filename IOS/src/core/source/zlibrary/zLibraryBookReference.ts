import type { SearchBook } from '@core/source/searchBook';

export function zLibraryBookUrl(id: string, domain: string): string {
  let suffix = '/' + id.replace(/^\/+/, '');
  try { const original = new URL(id); suffix = original.pathname + original.search; } catch { /* relative id */ }
  const url = new URL('https://' + domain);
  const path = new URL(suffix.startsWith('//') ? '/' + suffix.replace(/^\/+/, '') : suffix, url.origin);
  url.pathname = path.pathname; url.search = path.search;
  return url.toString();
}

export function zLibraryApiKey(id: string): [string, string] | null {
  let path = '/' + id.replace(/^\/+/, '');
  try { path = new URL(id).pathname; } catch { /* relative id */ }
  const match = /^\/book\/(\d+)\/([a-f0-9]+)(?:\/|$)/i.exec(path);
  return match ? [match[1]!, match[2]!] : null;
}

export function shouldRetryZLibraryDownload(message: string): boolean {
  const text = message.toLowerCase();
  return !['上限', '额度', '限制', 'limit', 'quota', '频繁', '429', 'too many requests', '空间', 'enospc',
    '无法保存', '无法替换', '入库'].some((word) => text.includes(word));
}

export function uniqueZLibraryEdition(books: readonly SearchBook[], expected: SearchBook, format?: string | null): SearchBook | null {
  const normalize = (value: string) => value.replace(/\s/g, '').toLowerCase();
  const matching = new Map(books.filter((candidate) => normalize(candidate.title) === normalize(expected.title) &&
    (!expected.author.trim() || expected.author === '未知作者' || normalize(candidate.author) === normalize(expected.author)) &&
    (!format?.trim() || candidate.format.toLowerCase() === format.toLowerCase())).map((book) => [book.id, book]));
  return matching.size === 1 ? matching.values().next().value ?? null : null;
}
