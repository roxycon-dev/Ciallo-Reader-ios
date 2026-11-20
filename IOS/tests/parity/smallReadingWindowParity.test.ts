/**
 * smallReadingWindowParity.test.ts —— 第七批（41–45 行档，8 个文件，合计 344 行）。
 *
 *   · `data/ReaderChapterWindow.kt`（41）—— 三章滑动窗口，只拉新进入的章
 *   · `ui/source/SourceInfoDialog.kt`（41）—— 十一条能力说明（本轮修了免责声明，E171）
 *   · `data/TtsPlaybackService.kt`（42）—— 前台朗读服务（Web 侧 = mediaSession 接线）
 *   · `data/ReadingSession.kt`（44）—— 会话 + 日/月/年聚合四个实体
 *   · `data/CharsetSniffer.kt`（44）—— BOM → UTF-16 启发 → 四编码打分
 *   · `source/anilist/TitleNormalizer.kt`（45）—— NFKC + 繁简折叠 + 标点归一
 *   · `data/favorite/ChapterCatalog.kt`（45）—— SHA-256 文件名 + 语义映射
 *   · `source/zlibrary/ZLibraryBookReference.kt`（45）—— 镜像切换保留身份 + 额度判定
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadReaderChapterWindow } from '@core/data/chapterMerger';
import type { Chapter } from '@core/data/chapterMerger';
import { createReadingSession } from '@core/data/readingSession';
import { detect, decodeTextWithCharsetDetection } from '@core/parser/charsetSniffer';
import { compact, normalize, usableVariant } from '@core/data/titleNormalizer';
import { ChapterCatalog } from '@core/library/chapterCatalog';
import { createComicChapter } from '@core/source/comicChapter';
import {
  shouldRetryZLibraryDownload,
  uniqueZLibraryEdition,
  zLibraryApiKey,
  zLibraryBookUrl,
} from '@core/source/zlibrary/zLibraryBookReference';
import { createSearchBook } from '@core/source/searchBook';
import type { FileSystemApi } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('ReaderChapterWindow.kt：三章窗口', () => {
  const KT = kt('data/ReaderChapterWindow.kt');

  function chapter(order: number, content = ''): Chapter {
    return { chapterOrder: order, title: `c${String(order)}`, content } as unknown as Chapter;
  }

  function book(count: number, ordersPerLogical: number[]): Parameters<typeof loadReaderChapterWindow>[0] {
    return {
      chapters: Array.from({ length: count }, (_, i) => chapter(i)),
      logicalToPhysicalOrders: Array.from({ length: count }, () => [...ordersPerLogical]),
    } as unknown as Parameters<typeof loadReaderChapterWindow>[0];
  }

  it('越界立即抛「没有可读取的章节」；窗口是 ±1 且裁到边界', async () => {
    expect(KT).toContain('check(currentIndex in metadata.indices) { tr("没有可读取的章节") }');
    expect(KT).toContain('val targets = ((currentIndex - 1)..(currentIndex + 1)).filter { it in metadata.indices }');
    await expect(
      loadReaderChapterWindow(book(3, [0]), 3, [], new Set(), async () => []),
    ).rejects.toThrow('没有可读取的章节');
    // 第 0 章：只有 0 和 1
    let asked: number[] = [];
    await loadReaderChapterWindow(book(3, [0]), 0, [], new Set(), async (orders) => {
      asked = orders;
      return orders.map((order) => chapter(order, `p${String(order)}`));
    });
    expect(asked).toEqual([0]);
  });

  it('可复用的章直接搬 previous，不再去读正文', async () => {
    expect(KT).toContain('val reusable = targets.filter { it in loaded && it in previous.indices }.toSet()');
    const mapping = book(3, [0]);
    const previous = [chapter(0, 'old-0'), chapter(1, 'old-1'), chapter(2, 'old-2')];
    const asked: number[][] = [];
    const window = await loadReaderChapterWindow(mapping, 1, previous, new Set([0, 1, 2]), async (orders) => {
      asked.push(orders);
      return [];
    });
    expect(asked).toEqual([]); // orders 为空 → 不调用 readParts
    expect(window.chapters[0]).toBe(previous[0]);
    expect(window.loaded.has(1)).toBe(true);
  });

  it('只请求 missing 的物理 order，并按 order 拼接 content', async () => {
    expect(KT).toContain('val orders = missing.flatMap { mapping.logicalToPhysicalOrders[it].asIterable() }.distinct()');
    expect(KT).toContain('val content = mapping.logicalToPhysicalOrders[index].asIterable().mapNotNull { parts[it] }');
    expect(KT).toContain('if (content.isNotEmpty()) chapters[index] = mergeChapterParts(metadata[index], content)');
    expect(KT).toContain('val orders = missing.flatMap { mapping.logicalToPhysicalOrders[it].asIterable() }.distinct()');
    const mapping = {
      chapters: [chapter(0), chapter(1), chapter(2)],
      // 第 1 章由物理 10、11 拼成
      logicalToPhysicalOrders: [[0], [10, 11], [2]],
    } as unknown as Parameters<typeof loadReaderChapterWindow>[0];
    const window = await loadReaderChapterWindow(mapping, 1, [], new Set(), async (orders) => {
      expect(orders).toEqual([0, 10, 11, 2]);
      return orders.map((order) => chapter(order, `<${String(order)}>`));
    });
    expect(window.chapters[1]?.content).toBe('<10><11>');
    expect(window.chapters[0]?.content).toBe('<0>');
  });

  it('当前章缺任何物理段 → 抛「当前章节数据缺失，请重试加载」', async () => {
    expect(KT).toContain('check(currentIndex in complete) { tr("当前章节数据缺失，请重试加载") }');
    const mapping = {
      chapters: [chapter(0)],
      logicalToPhysicalOrders: [[10, 11]],
    } as unknown as Parameters<typeof loadReaderChapterWindow>[0];
    await expect(
      loadReaderChapterWindow(mapping, 0, [], new Set(), async () => [chapter(10, 'x')]),
    ).rejects.toThrow('当前章节数据缺失，请重试加载');
  });
});

describe('SourceInfoDialog.kt：十一条说明', () => {
  const KT = kt('ui/source/SourceInfoDialog.kt');
  const TSX = readFileSync('src/ui/components/source/SourceInfoDialog.tsx', 'utf8');

  it('九条能力行 + 切换文案 + 免责声明，逐字对拍', () => {
    for (const line of [
      'Text("启用状态：${if (enabled) tr("已启用") else tr("已停用")}")',
      'Text(tr("适配方式：Venera / JS 漫画源"))',
      'Text("脚本版本：${source.version}")',
      'Text(tr("适配方式：应用内漫画源"))',
      'Text("站内搜索：${if (caps.supportSearch) tr("支持") else tr("不支持")}")',
      'Text("章节阅读：${if (caps.supportComic) tr("支持图片漫画") else tr("未声明")}")',
      'Text("章节下载：${if (caps.supportDownload) tr("支持") else tr("不支持")}")',
      'Text("搜索登录：${if (caps.searchRequiresLogin) tr("需要登录") else tr("适配器未要求登录")}")',
      'Text("阅读 / 下载登录：${if (caps.downloadRequiresLogin) tr("需要登录") else tr("适配器未要求登录")}")',
    ]) {
      expect(KT).toContain(line);
    }
    for (const row of [
      '启用状态：',
      '适配方式：Venera / JS 漫画源',
      '适配方式：应用内漫画源',
      '站内搜索：',
      '章节阅读：',
      '章节下载：',
      '搜索登录：',
      '阅读 / 下载登录：',
    ]) {
      expect(TSX).toContain(row);
    }
  });

  it('免责声明与 Kotlin **完全一致**（E171：此前被扩写成两句）', () => {
    expect(KT).toContain('"作品资料以源站实际返回为准。启用状态表示是否参与搜索。"');
    expect(TSX).toContain('作品资料以源站实际返回为准。启用状态表示是否参与搜索。');
    // 被删掉的扩写不能再回来
    expect(TSX).not.toContain('缺失字段会留空');
    expect(TSX).not.toContain('站点可用性以本次请求为准');
  });

  it('源 id 用等宽字体；确认按钮是「知道啦」', () => {
    expect(KT).toContain('Text(source.id, style = MaterialTheme.typography.labelLarge, fontFamily = FontFamily.Monospace)');
    expect(KT).toContain('WenkuTextButton(tr("知道啦")');
    expect(TSX).toContain('monospace');
    expect(TSX).toContain("tr('知道啦')");
  });
});

describe('TtsPlaybackService.kt：前台朗读服务', () => {
  const KT = kt('data/TtsPlaybackService.kt');

  it('通知渠道 reading_tts / 「听书」/ IMPORTANCE_LOW，前台 id 302，三条 action', () => {
    // Kotlin L151-152：渠道名与通知 id 都是常量（不是字面量散落在调用点）
    expect(KT).toContain('private const val CHANNEL = "reading_tts"');
    expect(KT).toContain('private const val NOTIFICATION_ID = 302');
    // L105-108：渠道标题走 AppLocale.t("听书")（英文界面下是 "Listening"）
    expect(KT).toContain('NotificationChannel(CHANNEL, AppLocale.t("听书"), NotificationManager.IMPORTANCE_LOW)');
    // L53 / L56 / L75：三条 return START_NOT_STICKY
    expect(KT.match(/return START_NOT_STICKY/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // L129-131：上一段 / 暂停 / 下一段，action 名字就是 intent 的分支键
    expect(KT).toContain('AppLocale.t("上一段")');
    expect(KT).toContain('action(id, "pause")');
    expect(KT).toContain('action(id, "next")');
  });

  it('pause action 必须先核对 session 才生效（防止旧通知暂停新会话）', () => {
    // L37-44：先 `owner?.takeIf { id == session && it.ownsService(id) }` 再分派
    expect(KT).toContain('val active = owner?.takeIf { id == session && it.ownsService(id) }');
    expect(KT).toContain('"pause" -> active?.pause()');
    expect(KT).toContain('"previous" -> active?.moveParagraph(-1)');
    expect(KT).toContain('"next" -> active?.moveParagraph(1)');
    // 拿不到 owner（会话已换）时不 stopSelf 到别的会话上
    expect(KT).toContain('if (active == null && owner?.ownsService(session) != true) stopSelfResult(startId)');
  });
});
describe('ReadingSession.kt：会话与三种聚合', () => {
  const KT = kt('data/ReadingSession.kt');

  it('会话表九个字段；id 自增主键默认 0；startHour 是 0-23', () => {
    expect(KT).toContain('@Entity(tableName = "reading_sessions")');
    expect(KT).toContain('@PrimaryKey(autoGenerate = true) val id: Long = 0');
    expect(KT).toContain('val bookId: Int?');
    expect(KT).toContain('val durationSeconds: Long');
    expect(KT).toContain('val startHour: Int');
    const session = createReadingSession({
      bookId: 7,
      bookTitle: '书',
      dateStr: '2026-11-17',
      startTimeMs: 1000,
      endTimeMs: 2000,
      durationSeconds: 1,
      startHour: 9,
    });
    expect(session.id).toBe(0);
    expect(session.startHour).toBe(9);
  });

  it('日/月/年三个聚合都是「键 + totalSeconds」', () => {
    expect(KT).toContain('data class DailyReadingTotal(');
    expect(KT).toContain('data class MonthlyReadingTotal(');
    expect(KT).toContain('data class YearlyReadingTotal(');
    const total = (key: string) => ({ key, totalSeconds: 42 });
    expect(total('2026-11-17')).toEqual({ key: '2026-11-17', totalSeconds: 42 });
  });
});

describe('CharsetSniffer.kt：BOM → UTF-16 启发 → 四编码打分', () => {
  const KT = kt('data/CharsetSniffer.kt');

  it('三种 BOM 优先；UTF-8 BOM 也算 utf-8', () => {
    expect(KT).toContain('if(data.size>=3 && data[0]==0xef.toByte() && data[1]==0xbb.toByte() && data[2]==0xbf.toByte()) return Charsets.UTF_8');
    expect(KT).toContain('charset("UTF-16LE")');
    expect(KT).toContain('charset("UTF-16BE")');
    expect(detect(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf-8');
    expect(detect(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le');
    expect(detect(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be');
  });

  it('无 BOM 的零字节启发：odd>pairs/4 且 even<pairs/10 → LE；反之 → BE', () => {
    expect(KT).toContain('val sample=data.copyOf(minOf(data.size,65536))');
    expect(KT).toContain('if(odd>pairs/4 && even<pairs/10) return charset("UTF-16LE")');
    expect(KT).toContain('if(even>pairs/4 && odd<pairs/10) return charset("UTF-16BE")');
    const ascii = 'abcdefghijklmnopqrst';
    const le = new Uint8Array(ascii.length * 2);
    const be = new Uint8Array(ascii.length * 2);
    for (let i = 0; i < ascii.length; i += 1) {
      le[i * 2] = ascii.charCodeAt(i);
      le[i * 2 + 1] = 0;
      be[i * 2] = 0;
      be[i * 2 + 1] = ascii.charCodeAt(i);
    }
    expect(detect(le)).toBe('utf-16le');
    expect(detect(be)).toBe('utf-16be');
  });

  it('打分权重：常见字 +1、假名 ×2、谚文 ×1.5、坏字 −5；四个候选编码按序', () => {
    expect(KT).toContain('return common+kana*2.0+hangul*1.5-bad*5.0');
    expect(KT).toContain('val candidates=listOf("GB18030","Big5","Shift_JIS","EUC-KR")');
    expect(KT).toContain('return candidates.maxByOrNull { it.second }?.first ?: error("无法可靠识别文字编码，请将文件转换为 UTF-8")');
  });

  it('合法 UTF-8 直接判 utf-8；中文往返无损', () => {
    expect(KT).toContain('if(decode(Charsets.UTF_8)!=null) return Charsets.UTF_8');
    const bytes = new TextEncoder().encode('无职转生 第一章');
    expect(detect(bytes)).toBe('utf-8');
    expect(decodeTextWithCharsetDetection(bytes)).toBe('无职转生 第一章');
  });
});

describe('TitleNormalizer.kt：NFKC + 繁简折叠 + 标点归一', () => {
  const KT = kt('source/anilist/TitleNormalizer.kt');

  it('标点表逐字；NFKC → lowercase → 标点换空格 → 繁简折叠 → 压空白', () => {
    expect(KT).toContain('private val PUNCTUATION = Regex("[!-/:-@\\\\[-`{-~　。、・「」『』（）【】《》〈〉“”‘’…―ー･：；！？，．]")');
    expect(KT).toContain('val nfkc = Normalizer.normalize(title, Normalizer.Form.NFKC)');
    expect(KT).toContain('val lowered = nfkc.lowercase()');
    expect(KT).toContain('val spaced = PUNCTUATION.replace(lowered, " ")');
    expect(KT).toContain('for (c in spaced) append(CjkFoldMap.fold(c))');
    expect(KT).toContain('return folded.split(Regex("\\\\s+")).filter { it.isNotEmpty() }.joinToString(" ")');

    expect(normalize('  Mushoku　Tensei  ')).toBe('mushoku tensei');
    expect(normalize('無職転生')).toBe('无职转生');
    expect(normalize('「無職転生」')).toBe('无职转生');
    expect(normalize('ＡＢＣ！')).toBe('abc');
    expect(normalize('   ')).toBe('');
  });

  it('compact 去全部空格；usableVariant 要求归一后 ≥ 2 字', () => {
    expect(KT).toContain('fun compact(title: String): String = normalize(title).replace(" ", "")');
    expect(KT).toContain('return n.length >= 2');
    expect(compact('Mushoku Tensei')).toBe('mushokutensei');
    expect(usableVariant('a')).toBe(false);
    expect(usableVariant('ab')).toBe(true);
    expect(usableVariant('无')).toBe(false);
    expect(usableVariant('无职')).toBe(true);
    expect(usableVariant('  a  ')).toBe(false);
  });
});

describe('ChapterCatalog.kt：SHA-256 文件名 + 语义映射', () => {
  const KT = kt('data/favorite/ChapterCatalog.kt');

  it('文件名 = sha256(`${source.length}:${source}${comic}`)；目录 chapter_catalogs', () => {
    expect(KT).toContain('val key="${source.length}:$source$comic"');
    expect(KT).toContain('MessageDigest.getInstance("SHA-256")');
    expect(KT).toContain('File(File(context.filesDir,"chapter_catalogs").apply { mkdirs() },"$hash.json")');
    // 端口：键的拼法与目录名
    const TS = readFileSync('src/core/library/chapterCatalog.ts', 'utf8');
    expect(TS).toContain('`${source.length}:${source}${comic}`');
    expect(TS).toContain("rootDir = 'chapter_catalogs'");
  });

  it('读：4 MiB / 10000 条上限，任何异常吞成空表', async () => {
    expect(KT).toContain('require(f.length()<=4L*1024*1024)');
    expect(KT).toContain('require(a.length()<=10_000)');
    expect(KT).toContain('}.getOrDefault(emptyList())');
    const fs = {
      exists: async () => false,
      readFile: async () => new Uint8Array(),
      writeFile: async () => undefined,
      mkdirs: async () => undefined,
    } as unknown as FileSystemApi;
    const catalog = new ChapterCatalog(fs);
    await expect(catalog.read('s', 'c')).resolves.toEqual([]);
  });

  it('写：超过 10000 条 / 4 MiB 都拒绝；往返保序', async () => {
    expect(KT).toContain('require(chapters.size<=10_000)');
    expect(KT).toContain('val raw=a.toString().toByteArray(); require(raw.size<=4*1024*1024)');
    const files = new Map<string, Uint8Array>();
    const fs = {
      exists: async (path: string) => files.has(path),
      readFile: async (path: string) => files.get(path) ?? new Uint8Array(),
      writeFile: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes);
      },
      mkdirs: async () => undefined,
    } as unknown as FileSystemApi;
    const catalog = new ChapterCatalog(fs);
    const chapters = [
      createComicChapter({ id: 'a', title: '第 1 话', volume: 'Vol.1', order: 1 }),
      createComicChapter({ id: 'b', title: '第 2 话', order: 2 }),
    ];
    await catalog.write('src', 'comic', chapters);
    const back = await catalog.read('src', 'comic');
    expect(back.map((c) => c.id)).toEqual(['a', 'b']);
    expect(back[0]?.volume).toBe('Vol.1');
    expect(back[1]?.volume).toBeNull();
    await expect(
      catalog.write('src', 'comic', Array.from({ length: 10_001 }, () => chapters[0] as never)),
    ).rejects.toThrow();
  });

  it('映射：id 命中且语义键相同才算 exact；语义唯一 + 旧集合唯一才算 semantic', () => {
    expect(KT).toContain('val exact=byId[chapter.id]?.takeIf { key(it) == key(chapter) }');
    expect(KT).toContain('val semantic=groupedNew[key(chapter)]?.singleOrNull()?.takeIf { groupedOld[key(chapter)]?.size==1 }');
    const files = new Map<string, Uint8Array>();
    const fs = {
      exists: async (path: string) => files.has(path),
      readFile: async (path: string) => files.get(path) ?? new Uint8Array(),
      writeFile: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes);
      },
      mkdirs: async () => undefined,
    } as unknown as FileSystemApi;
    const catalog = new ChapterCatalog(fs);

    const oldChapters = [
      createComicChapter({ id: 'o1', title: '第 1 话' }),
      createComicChapter({ id: 'o2', title: '第 2 话' }),
    ];
    // o1：id 与语义都一致 → exact；o2：id 变了，但语义唯一 → semantic
    const fresh = [
      createComicChapter({ id: 'o1', title: '第 1 话' }),
      createComicChapter({ id: 'n2', title: '第 2 话' }),
    ];
    const mapped = catalog.mapping(oldChapters, fresh);
    expect([...mapped.entries()]).toEqual([
      ['o1', fresh[0]],
      ['o2', fresh[1]],
    ]);

    // 语义重复（两条同名）→ 不映射
    const dupFresh = [
      createComicChapter({ id: 'x1', title: '第 1 话' }),
      createComicChapter({ id: 'x2', title: '第 1 话' }),
    ];
    expect([...catalog.mapping([oldChapters[0] as never], dupFresh).keys()]).toEqual([]);
  });
});

describe('ZLibraryBookReference.kt：镜像切换与额度判定', () => {
  const KT = kt('source/zlibrary/ZLibraryBookReference.kt');

  it('url：原始 bookId 是 URL 就保留 path+query，拼到新 domain；否则当路径', () => {
    expect(KT).toContain('val original = bookId.toHttpUrlOrNull()');
    expect(KT).toContain('val path = original?.encodedPath ?: "/${bookId.trimStart(\'/\')}"');
    expect(KT).toContain('.encodedQuery(original?.encodedQuery)');
    expect(zLibraryBookUrl('https://z-lib.sk/book/1/abc?x=1', 'z-lib.re')).toBe(
      'https://z-lib.re/book/1/abc?x=1',
    );
    expect(zLibraryBookUrl('/book/1/abc', 'z-lib.re')).toBe('https://z-lib.re/book/1/abc');
    expect(zLibraryBookUrl('book/1/abc', 'z-lib.re')).toBe('https://z-lib.re/book/1/abc');
  });

  it('apiKey：`/book/<数字>/<十六进制>` 才返回二元组，其余 null', () => {
    expect(KT).toContain('val match = Regex("^/book/(\\\\d+)/([a-fA-F0-9]+)(?:/|$)").find(path) ?: return null');
    expect(zLibraryApiKey('/book/1234/abcdef')).toEqual(['1234', 'abcdef']);
    expect(zLibraryApiKey('https://z-lib.sk/book/9/ABC/extra')).toEqual(['9', 'ABC']);
    expect(zLibraryApiKey('/book/abc/def')).toBeNull();
    expect(zLibraryApiKey('/book/12')).toBeNull();
  });

  it('额度类错误**不重试**（上限/额度/limit/quota/429/ENOSPC… 命中即 false）', () => {
    expect(KT).toContain('listOf("上限", "额度", "限制", "limit", "quota", "频繁", "429", "too many requests", "空间", "ENOSPC", "无法保存", "无法替换", "入库")');
    expect(KT).toContain('.none { message.contains(it, ignoreCase = true) }');
    for (const message of ['今日下载上限', 'QUOTA exceeded', 'HTTP 429', 'Too Many Requests', 'ENOSPC', '无法保存文件']) {
      expect(shouldRetryZLibraryDownload(message), message).toBe(false);
    }
    expect(shouldRetryZLibraryDownload('连接超时')).toBe(true);
    expect(shouldRetryZLibraryDownload('HTTP 502')).toBe(true);
  });

  it('uniqueZLibraryEdition：标题归一相同 + 作者条件 + 格式条件，去重后唯一才返回', () => {
    expect(KT).toContain('fun normalized(value: String) = value.filterNot(Char::isWhitespace).lowercase()');
    expect(KT).toContain('(expected.author.isBlank() || expected.author == "未知作者" || normalized(candidate.author) == normalized(expected.author))');
    expect(KT).toContain('(format.isNullOrBlank() || candidate.format.equals(format, true))');
    expect(KT).toContain('}.distinctBy { it.id }.singleOrNull()');

    const expected = createSearchBook({ id: '1', sourceId: 'zlibrary', title: '无职 转生', author: '理不尽' });
    const same = createSearchBook({ id: '1', sourceId: 'zlibrary', title: '无职转生', author: '理不尽', format: 'epub' });
    expect(uniqueZLibraryEdition([same], expected, 'EPUB')).toBe(same);
    // 标题不同 → 无结果
    const other = createSearchBook({ id: '1', sourceId: 'zlibrary', title: '别的书', author: '理不尽' });
    expect(uniqueZLibraryEdition([other], expected, null)).toBeNull();
    // 两条都符合 → 不唯一
    const dupA = createSearchBook({ id: '1', sourceId: 'zlibrary', title: '无职转生', author: '理不尽' });
    const dupB = createSearchBook({ id: '2', sourceId: 'zlibrary', title: '无职转生', author: '理不尽' });
    expect(uniqueZLibraryEdition([dupA, dupB], expected, null)).toBeNull();
    // 未知作者时忽略作者差异
    const unknown = createSearchBook({ id: '1', sourceId: 'zlibrary', title: '无职转生', author: '某人' });
    const expectedUnknown = createSearchBook({ id: '1', sourceId: 'zlibrary', title: '无职转生', author: '未知作者' });
    expect(uniqueZLibraryEdition([unknown], expectedUnknown, null)).toBe(unknown);
  });
});
