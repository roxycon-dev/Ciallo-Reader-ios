import type { HttpClient } from '@platform/interfaces';
import { ParseError, NetworkError, BookNotFound } from '../sourceException';
import { executeSourceRequest, decodeCharset, headerOf } from './sourceHttp';
import { parseHtmlDocument } from './jsoup';

export function sourceResponseProblem(text: string, expectJson = false): string | null {
  const body = text.replace(/^[\s\uFEFF]+/u, '');
  if (!body) return '源站返回空响应，请稍后重试';
  if (!body.startsWith('<')) return null;
  const sample = body.slice(0, 32768);
  if (/<title[^>]*>\s*(Just a moment|Attention Required|Access denied|Forbidden|Service Unavailable)/i.test(sample) || /\/cdn-cgi\/challenge-platform\//i.test(sample)) return '源站返回验证或拦截页面，请在书源管理完成站点验证或稍后重试';
  return expectJson ? '源站返回网页而非接口数据，请稍后重试或切换该源线路' : null;
}
export function sourceResponseText(bytes: Uint8Array, headers: Record<string, string>): string {
  const type = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  const prefix = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 4096));
  let charset = /charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(type)?.[1]
    ?? (prefix.trimStart().startsWith('<') ? /charset\s*=\s*["']?\s*(gbk|gb2312|gb18030)/i.exec(prefix)?.[1] : undefined);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be';
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) charset = 'utf-8';
  if (charset) return decodeCharset(bytes, charset).replace(/^\uFEFF/u, '');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); }
  catch { return decodeCharset(bytes, 'gb18030'); }
}
export interface GuestVerification { (url: string, userAgent: string): Promise<{ cookie?: string; html?: string }> }
export class GuestNovelTransport {
  constructor(private readonly http: HttpClient, readonly home: string, readonly name: string,
    private readonly hosts: Set<string> = new Set([new URL(home).host]), private readonly verify?: GuestVerification) {}
  async html(url: string, xbook = false): Promise<string> {
    const parsed = new URL(url), base = new URL(this.home);
    if (!this.hosts.has(parsed.host) || parsed.protocol !== base.protocol || parsed.username || parsed.password) throw new ParseError('源站页面地址异常');
    const userAgent = xbook ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' : 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36';
    let cookie = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try { response = await executeSourceRequest(this.http, url, { headers: { 'User-Agent': userAgent, Referer: this.home, Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}) }, maxBytes: xbook ? 8 * 1024 * 1024 : 6 * 1024 * 1024, timeoutMs: 40_000 }); }
      catch (error) { if (attempt === 2 || error instanceof Error && error.name === 'AbortError') throw error; await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 800)); continue; }
      if (response.status === 404) throw new BookNotFound();
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 800)); continue; }
      if (response.status < 200 || response.status >= 300) throw new NetworkError(`${this.name} 暂时无法免登录访问（HTTP ${response.status}）`);
      const final = new URL(response.url ?? url);
      if (!this.hosts.has(final.host) || final.protocol !== parsed.protocol || final.username || final.password) throw new ParseError('源站跳转到了其他网站');
      const html = sourceResponseText(response.body, response.headers);
      const content = xbook && parseHtmlDocument(html).selectFirst('article.reading-text, #search-books, main header h1, section ol li a[href*="/book/"]');
      const problem = content ? null : sourceResponseProblem(html);
      if (problem && xbook && this.verify && attempt === 0) { const solved = await this.verify(url, userAgent); cookie = solved.cookie ?? ''; if (cookie) continue; }
      if (problem) throw new ParseError(problem);
      if (html.includes('\uFFFD')) throw new ParseError('源站文字编码异常，未导入不完整文本');
      return html;
    }
    throw new NetworkError('源站读取失败');
  }
  async json(url: string, maxBytes = 6 * 1024 * 1024): Promise<Record<string, unknown>> {
    const response = await executeSourceRequest(this.http, url, { headers: { Accept: 'application/json' }, timeoutMs: 40_000, maxBytes });
    if (response.status < 200 || response.status >= 300) throw new NetworkError(`${this.name} 返回 HTTP ${response.status}`);
    const text = sourceResponseText(response.body, { ...response.headers, 'Content-Type': headerOf(response, 'content-type') ?? 'application/json;charset=utf-8' });
    const problem = sourceResponseProblem(text, true); if (problem) throw new ParseError(problem);
    try { const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
    catch { throw new ParseError('接口数据不完整或 JSON 格式异常，请稍后重试'); }
  }
}
