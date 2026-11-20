/**
 * smallSourceAndDownloadParity.test.ts —— 六个**小文件**的逐条对拍（合计 154 行）。
 *
 * 这些文件在矩阵里一直是 `ADAPTED`：实现早就在，只是缺「读 Kotlin 原文」的测试。
 * 本轮把它们一次性补上（每条断言都从 `androidReference()` 读到的原文派生）：
 *
 *   · `download/DownloadState.kt`（20 行）—— 六态 + 三个字段
 *   · `download/DownloadTransferPolicy.kt`（27 行）—— 续传范围与 validator
 *   · `ui/comic/ComicChapterResume.kt`（26 行）—— `startPage` 的四步决议与钳制
 *   · `source/SourceCapabilities.kt`（29 行）—— 默认值、`requiresLogin`、小说/漫画源互斥
 *   · `data/ReadingTimeSlices.kt`（32 行）—— 跨午夜按墙钟比例切分、末段吸收余数
 *   · `library/SharedWorkLink.kt`（32 行）—— `ciallo://detail` 的严格生成与解析
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DownloadStatePending,
  downloadingState,
  errorState,
  DownloadStateIdle,
  pausedState,
  successState,
} from '@core/download/downloadState';
import { parseRange, validateTail, validator } from '@core/data/downloadTransferPolicy';
import {
  LAST_PAGE_REQUEST,
  comicChapterResumeFromJson,
  comicChapterStartPage,
  createComicChapterResume,
} from '@core/comic/comicChapterResume';
import {
  createSourceCapabilities,
  isComicSource,
  isNovelSource,
  sourceRequiresLogin,
} from '@core/source/sourceCapabilities';
import { ReadingTimeSlices } from '@core/data/readingTimeSlices';
import { sharedWorkLinkCreate, sharedWorkLinkParse } from '@core/library/sharedWorkLink';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('DownloadState.kt：六个状态', () => {
  const KT = kt('download/DownloadState.kt');

  it('Idle / Pending 是无字段的 object，其余四个带字段', () => {
    expect(KT).toContain('object Idle : DownloadState()');
    expect(KT).toContain('object Pending : DownloadState()');
    expect(KT).toContain('val downloadedBytes: Long');
    expect(KT).toContain('val totalBytes: Long');
    expect(KT).toContain('val progress: Float');
    expect(KT).toContain('data class Success(val path: String)');
    expect(KT).toContain('data class Error(val message: String)');

    expect(DownloadStateIdle.kind).toBe('Idle');
    expect(DownloadStatePending.kind).toBe('Pending');
    expect(downloadingState(10, 100, 0.1)).toMatchObject({
      kind: 'Downloading',
      downloadedBytes: 10,
      totalBytes: 100,
      progress: 0.1,
    });
    // Paused 只有两个字节数（Kotlin 没有 progress 字段）
    expect(pausedState(10, 100)).toMatchObject({ kind: 'Paused', downloadedBytes: 10, totalBytes: 100 });
    expect(pausedState(10, 100)).not.toHaveProperty('progress');
    expect(successState('/a.epub')).toMatchObject({ kind: 'Success', path: '/a.epub' });
    expect(errorState('boom')).toMatchObject({ kind: 'Error', message: 'boom' });
  });
});

describe('DownloadTransferPolicy.kt：续传范围', () => {
  const KT = kt('download/DownloadTransferPolicy.kt');

  it('正则 `bytes (\\d+)-(\\d+)/(\\d+)` 且要求 start ≤ end < total', () => {
    expect(KT).toContain('Regex("bytes (\\\\d+)-(\\\\d+)/(\\\\d+)").matchEntire(header?.trim().orEmpty())');
    expect(KT).toContain('takeIf { start <= end && end < total }');

    expect(parseRange('bytes 0-99/100')).toEqual({ start: 0, end: 99, total: 100 });
    expect(parseRange('  bytes 5-9/10  ')).toEqual({ start: 5, end: 9, total: 10 });
    expect(parseRange('bytes 0-100/100')).toBeNull(); // end == total
    expect(parseRange('bytes 9-5/10')).toBeNull(); // start > end
    expect(parseRange('bytes=0-99/100')).toBeNull();
    expect(parseRange(null)).toBeNull();
    expect(parseRange('bytes 0-99/100, 200-299/300')).toBeNull();
  });

  it('validateTail 三条校验：起点、终点=total−1、长度一致（contentLength<0 跳过）', () => {
    expect(KT).toContain('require(range.start == offset && range.end == range.total - 1)');
    expect(KT).toContain('require(contentLength < 0 || contentLength == range.end - range.start + 1)');

    expect(validateTail('bytes 100-199/200', 100, 100)).toBe(200);
    expect(validateTail('bytes 100-199/200', 100, -1)).toBe(200);
    expect(() => validateTail('bytes 100-199/200', 99, 100)).toThrow('服务器返回的续传位置不一致');
    expect(() => validateTail('bytes 100-198/200', 100, 99)).toThrow('服务器返回的续传位置不一致');
    expect(() => validateTail('bytes 100-199/200', 100, 99)).toThrow('续传响应长度不一致');
    expect(() => validateTail('garbage', 0, -1)).toThrow('服务器返回了无效的续传范围');
  });

  it('validator：只认强 ETag（首尾都是 `"`），否则非空 Last-Modified', () => {
    expect(KT).toContain('etag?.takeIf { it.startsWith(\'"\') && it.endsWith(\'"\') }');
    expect(validator('"abc"', 'Mon')).toBe('"abc"');
    expect(validator('W/"abc"', 'Mon')).toBe('Mon'); // 弱 ETag 不用
    expect(validator('"', 'Mon')).toBe('"'); // 单个引号也满足两个谓词（Kotlin 同款）
    expect(validator(null, 'Mon, 01 Jan 2026 00:00:00 GMT')).toBe('Mon, 01 Jan 2026 00:00:00 GMT');
    expect(validator(null, '   ')).toBeNull();
    expect(validator(null, null)).toBeNull();
  });
});

describe('ComicChapterResume.kt：起始页决议', () => {
  const KT = kt('ui/comic/ComicChapterResume.kt');

  it('Int.MAX_VALUE 哨兵 → 最后一页；请求页 ≠ 已存页 → 用请求页', () => {
    expect(KT).toContain('if (requested == Int.MAX_VALUE) count - 1');
    expect(LAST_PAGE_REQUEST).toBe(2147483647);
    expect(comicChapterStartPage({ page: 3, scrollPage: -1, scrollOffset: 0 }, LAST_PAGE_REQUEST, 10, false)).toBe(9);

    // 请求页与已存页不同 → 直接采信请求（用户明确跳转）
    expect(comicChapterStartPage({ page: 3, scrollPage: 6, scrollOffset: 0 }, 5, 10, true)).toBe(5);
  });

  it('竖屏滚动优先 scrollPage；否则回落到 page；全部夹到 [0, count−1]', () => {
    expect(KT).toContain('else if (vertical && scrollPage >= 0) scrollPage');
    const resume = { page: 3, scrollPage: 6, scrollOffset: 0 };
    expect(comicChapterStartPage(resume, 0, 10, true)).toBe(6);
    expect(comicChapterStartPage(resume, 0, 10, false)).toBe(3);
    // 请求页 > 0 且等于已存页 → 走 requested
    expect(comicChapterStartPage({ page: 4, scrollPage: -1, scrollOffset: 0 }, 4, 10, false)).toBe(4);
    // 越界钳制
    expect(comicChapterStartPage({ page: 99, scrollPage: -1, scrollOffset: 0 }, 0, 10, false)).toBe(9);
    expect(comicChapterStartPage({ page: 99, scrollPage: -1, scrollOffset: 0 }, 0, 0, false)).toBe(0);
  });

  it('fromJson 的 `optInt(default).coerceAtLeast(...)` 语义', () => {
    expect(KT).toContain('json.optInt("page", 0).coerceAtLeast(0)');
    expect(KT).toContain('json.optInt("scrollPage", -1).coerceAtLeast(-1)');
    expect(comicChapterResumeFromJson({})).toEqual(createComicChapterResume());
    expect(comicChapterResumeFromJson({ page: -5, scrollPage: -9, scrollOffset: -1 })).toEqual({
      page: 0,
      scrollPage: -1,
      scrollOffset: 0,
    });
    expect(comicChapterResumeFromJson({ page: 7, scrollPage: 2, scrollOffset: 30 })).toEqual({
      page: 7,
      scrollPage: 2,
      scrollOffset: 30,
    });
  });
});

describe('SourceCapabilities.kt：默认值与小说/漫画互斥', () => {
  const KT = kt('source/SourceCapabilities.kt');

  it('默认 search/download 为 true，其余 false；requiresLogin = downloadRequiresLogin', () => {
    expect(KT).toContain('val supportSearch: Boolean = true');
    expect(KT).toContain('val supportDownload: Boolean = true');
    expect(KT).toContain('val supportComic: Boolean = false');
    expect(KT).toContain('val requiresLogin: Boolean get() = downloadRequiresLogin');

    const caps = createSourceCapabilities();
    expect(caps.supportSearch).toBe(true);
    expect(caps.supportDownload).toBe(true);
    for (const key of ['searchRequiresLogin', 'downloadRequiresLogin', 'supportDebug', 'supportImport', 'supportComic', 'supportOnlineText', 'environmentOnly', 'supportEbook'] as const) {
      expect(caps[key]).toBe(false);
    }
    expect(sourceRequiresLogin(createSourceCapabilities({ downloadRequiresLogin: true }))).toBe(true);
  });

  it('isNovelSource：zlibrary 恒定是小说源；否则「非漫画 且（电子书 或 在线文字）」', () => {
    expect(KT).toContain('get() = id == "zlibrary" || (!capabilities.supportComic &&');
    const zlib = { id: 'zlibrary', capabilities: createSourceCapabilities({ supportComic: true }) };
    expect(isNovelSource(zlib as never)).toBe(true);
    const ebook = { id: 'a', capabilities: createSourceCapabilities({ supportEbook: true }) };
    expect(isNovelSource(ebook as never)).toBe(true);
    const onlineText = { id: 'b', capabilities: createSourceCapabilities({ supportOnlineText: true }) };
    expect(isNovelSource(onlineText as never)).toBe(true);
    const comic = { id: 'c', capabilities: createSourceCapabilities({ supportComic: true }) };
    expect(isNovelSource(comic as never)).toBe(false);
    const plain = { id: 'd', capabilities: createSourceCapabilities() };
    expect(isNovelSource(plain as never)).toBe(false);
  });

  it('isComicSource = supportComic && !isNovelSource（两者互斥）', () => {
    expect(KT).toContain('get() = capabilities.supportComic && !isNovelSource');
    const comic = { id: 'c', capabilities: createSourceCapabilities({ supportComic: true }) };
    expect(isComicSource(comic as never)).toBe(true);
    const both = { id: 'e', capabilities: createSourceCapabilities({ supportComic: true, supportEbook: true }) };
    // 同时具备两种能力时按「漫画源」处理（isNovelSource 为 false）
    expect(isNovelSource(both as never)).toBe(false);
    expect(isComicSource(both as never)).toBe(true);
    const zlib = { id: 'zlibrary', capabilities: createSourceCapabilities({ supportComic: true }) };
    expect(isComicSource(zlib as never)).toBe(false);
  });
});

describe('ReadingTimeSlices.kt：跨午夜切分', () => {
  const KT = kt('data/ReadingTimeSlices.kt');

  it('非法输入返回空；跨度上限 7 天（抛「阅读会话时间范围异常」）', () => {
    expect(KT).toContain('if(end<=start || seconds<=0) return emptyList()');
    expect(KT).toContain('require(end-start<=7L*24*60*60*1000)');
    expect(ReadingTimeSlices.split(100, 100, 10)).toEqual([]);
    expect(ReadingTimeSlices.split(200, 100, 10)).toEqual([]);
    expect(ReadingTimeSlices.split(100, 200, 0)).toEqual([]);
    expect(() => ReadingTimeSlices.split(0, 8 * 24 * 60 * 60 * 1000, 10)).toThrow('阅读会话时间范围异常');
    // 恰好 7 天不抛
    expect(ReadingTimeSlices.split(0, 7 * 24 * 60 * 60 * 1000, 10)).toHaveLength(8);
  });

  it('同一天内只有一片，秒数全额；跨午夜按墙钟比例、末段吸收余数', () => {
    expect(KT).toContain('val through=if(stop==end) seconds else (seconds.toDouble()*(stop-start)/(end-start)).toLong()');
    expect(KT).toContain('result.add(ReadingTimeSlice(date,cursor,stop,through-allocated,hour))');

    const start = new Date(2026, 10, 16, 22, 0, 0, 0).getTime();
    const end = new Date(2026, 10, 16, 23, 0, 0, 0).getTime();
    const sameDay = ReadingTimeSlices.split(start, end, 600);
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0]).toMatchObject({ date: '2026-11-16', start, end, seconds: 600, hour: 22 });

    // 22:00 → 次日 02:00，每段 600 秒（4 段）；22 点 2 小时占 2/4 → 300，0 点 2 小时 → 300
    const crossStart = new Date(2026, 10, 16, 22, 0, 0, 0).getTime();
    const crossEnd = new Date(2026, 10, 17, 2, 0, 0, 0).getTime();
    const slices = ReadingTimeSlices.split(crossStart, crossEnd, 600);
    expect(slices).toHaveLength(2);
    expect(slices[0]?.date).toBe('2026-11-16');
    expect(slices[1]?.date).toBe('2026-11-17');
    expect(slices[0]?.hour).toBe(22);
    expect(slices[1]?.hour).toBe(0);
    expect(slices[0]?.seconds).toBe(300);
    expect(slices[1]?.seconds).toBe(300);
    // 总秒数守恒
    expect(slices.reduce((sum, s) => sum + s.seconds, 0)).toBe(600);
    // 时间轴无缝、无重叠
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]?.start).toBe(slices[i - 1]?.end);
    }
  });

  it('三段跨两天时余数归最后一段（累计值相减，不是各自取整）', () => {
    const start = new Date(2026, 10, 16, 20, 0, 0, 0).getTime();
    const end = new Date(2026, 10, 17, 4, 0, 0, 0).getTime();
    const slices = ReadingTimeSlices.split(start, end, 1000);
    expect(slices).toHaveLength(2);
    expect(slices.reduce((sum, s) => sum + s.seconds, 0)).toBe(1000);
    // 20 点那 4 小时占一半 → 500；剩下 500 归次日
    expect(slices[0]?.seconds).toBe(500);
    expect(slices[1]?.seconds).toBe(500);
  });
});

describe('SharedWorkLink.kt：ciallo://detail 链接', () => {
  const KT = kt('library/SharedWorkLink.kt');

  it('只接受非空来源/编号，标题截到 300 字符', () => {
    expect(KT).toContain('require(sourceId.isNotBlank() && bookId.isNotBlank())');
    expect(KT).toContain('require(sourceId.length <= 256 && bookId.length <= 4096)');
    expect(KT).toContain('.appendQueryParameter("title", title.take(300))');

    const link = sharedWorkLinkCreate('ixdzs8', 'book-1', '书名');
    expect(link.startsWith('ciallo://detail?')).toBe(true);
    const parsed = sharedWorkLinkParse(link);
    expect(parsed).toMatchObject({ sourceId: 'ixdzs8', bookId: 'book-1', title: '书名' });

    const longTitle = 'x'.repeat(400);
    expect(sharedWorkLinkParse(sharedWorkLinkCreate('s', 'b', longTitle))?.title).toHaveLength(300);
    expect(() => sharedWorkLinkCreate('  ', 'b', 't')).toThrow();
    expect(() => sharedWorkLinkCreate('s', '', 't')).toThrow();
  });

  it('拒绝带控制字符或 userInfo 的作品编号（账号信息不外泄）', () => {
    expect(KT).toContain('require((sourceId + bookId).none(Char::isISOControl))');
    expect(KT).toContain('require(Uri.parse(bookId).userInfo == null)');
    expect(() => sharedWorkLinkCreate('s', 'a\u0001b', 't')).toThrow();
    // \`Uri.parse('user:pass@host')\` 的 scheme 是 \`user\`、userInfo 为 null；
    // 真正带账号信息的是 \`//user:pass@host\` 这种 authority 形式。
    expect(() => sharedWorkLinkCreate('s', '//user:pass@host/x', 't')).toThrow();
    expect(() => sharedWorkLinkCreate('s'.repeat(257), 'b', 't')).toThrow();
  });

  it('解析严格要求 scheme/host/无 path/无 fragment/无 userInfo/端口 −1，query 必须恰好三个键各一次', () => {
    expect(KT).toContain('uri.scheme != "ciallo" || uri.host != "detail"');
    expect(KT).toContain('uri.queryParameterNames != setOf("source", "id", "title")');
    expect(KT).toContain('uri.toString().length > 20_000');

    expect(sharedWorkLinkParse('ciallo://detail?source=s&id=b&title=t')).toMatchObject({ sourceId: 's', bookId: 'b' });
    expect(sharedWorkLinkParse('ciallo://detail/extra?source=s&id=b&title=t')).toBeNull();
    expect(sharedWorkLinkParse('ciallo://other?source=s&id=b&title=t')).toBeNull();
    expect(sharedWorkLinkParse('ciallo://detail?source=s&id=b')).toBeNull();
    expect(sharedWorkLinkParse('ciallo://detail?source=s&id=b&title=t&extra=1')).toBeNull();
    expect(sharedWorkLinkParse('ciallo://detail?source=s&source=t&id=b&title=t')).toBeNull();
    expect(sharedWorkLinkParse('https://detail?source=s&id=b&title=t')).toBeNull();
    expect(sharedWorkLinkParse(null)).toBeNull();
    // 往返成对
    const round = sharedWorkLinkParse(sharedWorkLinkCreate('src', 'id1', '标题'));
    expect(round).not.toBeNull();
    expect(sharedWorkLinkCreate(round?.sourceId ?? '', round?.bookId ?? '', round?.title ?? '')).toBe(
      sharedWorkLinkCreate('src', 'id1', '标题'),
    );
  });
});
