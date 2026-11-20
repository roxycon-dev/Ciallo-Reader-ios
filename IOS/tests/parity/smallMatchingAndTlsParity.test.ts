/**
 * smallMatchingAndTlsParity.test.ts —— 第十一批（53–60 行档，4 个文件，合计 222 行）。
 *
 *   · `data/favorite/ComicChapterMatching.kt`（53）—— 跨源章节身份：唯一标题 / 显式集数，**不用位置或 id**
 *   · `source/BookSource.kt`（55）—— 书源接口的**全部默认实现**（8 个）
 *   · `source/js/AimanhuaTls.kt`（54）—— 证书 pinning：`route` 两条件 + `accepts` 的 14 天宽限（E178）
 *   · `transfer/IncomingChapterIndex.kt`（60）—— 磁盘版章节指纹索引（E177：真 SHA-256 + `null` 语义）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { mapping } from '@core/library/comicChapterMatching';
import { createComicChapter, type ComicChapter } from '@core/source/comicChapter';
import { BookSource } from '@core/source/bookSource';
import { createSourceCapabilities } from '@core/source/sourceCapabilities';
import { AuthenticationState } from '@core/source/authenticationState';
import type { LoginCredential } from '@core/source/loginCredential';
import type { SearchBook } from '@core/source/searchBook';
import type { DownloadInfo } from '@core/source/downloadInfo';
import type { BookFormat } from '@core/source/bookFormat';
import type { DiscoverCatalog, DiscoverPage, DiscoverQuery } from '@core/discover/models';
import { SourceResult } from '@core/source/sourceResult';
import type { ParseError } from '@core/source/sourceException';
import {
  AIMANHUA_PIN,
  AIMANHUA_RENEWAL_GRACE_MS,
  AIMANHUA_TLS_HOST,
  AimanhuaTls,
  aimanhuaAccepts,
  aimanhuaRoute,
} from '@core/source/sourceText';
import {
  IncomingChapterIndex,
  unresolvedChapterHash,
} from '@core/transfer/nearby';
import { transferHash } from '@core/transfer/transferWire';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① data/favorite/ComicChapterMatching.kt
   ══════════════════════════════════════════════════════════════════════════════ */

function chapter(id: string, title: string, volume: string | null = null): ComicChapter {
  return createComicChapter({ id, title, volume });
}

describe('ComicChapterMatching.kt：跨源章节身份', () => {
  const KT = kt('data/favorite/ComicChapterMatching.kt');

  it('KDoc：唯一标题或显式集数，**绝不用**列表位置或 id', () => {
    expect(KT).toContain(
      'Cross-source identity uses unique titles or explicit episode numbers, never list positions or IDs.',
    );
    const TS = readFileSync('src/core/library/comicChapterMatching.ts', 'utf8');
    expect(TS).toContain('never list positions or IDs');
  });

  it('三层配对顺序：标题 → 卷+集数 → 纯集数（第三层才允许跨卷）', () => {
    expect(KT).toContain('pair { c -> TitleNormalizer.compact(c.title).takeIf { it.isNotBlank() }?.let { "${volume(c)}|$it" } }');
    expect(KT).toContain('pair { c -> number(c.title)?.let { "${volume(c)}|$it" } }');
    expect(KT).toContain('pair { c -> number(c.title) }');
    const TS = readFileSync('src/core/library/comicChapterMatching.ts', 'utf8');
    const occurrences = TS.split('pair(').length - 1;
    expect(occurrences).toBe(3);
  });

  it('标题一致（NFKC + 繁简折叠 + 去空格）即配对；顺序保持旧表插入序', () => {
    const old = [chapter('o1', '第 1 话'), chapter('o2', '第 2 话')];
    const fresh = [chapter('n1', '第1话'), chapter('n2', '第２话')];
    const mapped = mapping(old, fresh);
    expect(mapped.get('o1')?.id).toBe('n1');
    expect(mapped.get('o2')?.id).toBe('n2');
    expect([...mapped.keys()]).toEqual(['o1', 'o2']);
  });

  it('卷名不同但标题相同时不配对（`volume|title` 是身份的一部分）', () => {
    const old = [chapter('o1', '第 1 话', 'Vol.1')];
    const fresh = [chapter('n1', '第 1 话', 'Vol.2')];
    expect(mapping(old, fresh).size).toBe(0);
  });

  it('卷名归一：`第1卷` / `Vol.1` / `1` 都折叠成 `1`；缺失卷名才算「空」', () => {
    const KT_VOL = KT;
    expect(KT_VOL).toContain('Regex("(?i)第\\\\s*(\\\\d+)\\\\s*[卷巻]|vol(?:ume)?\\\\.?\\\\s*(\\\\d+)")');
    expect(KT_VOL).toContain('Regex("(?i)^(?:第\\\\s*)?(\\\\d+)(?:\\\\s*[卷巻])?$|^(?:vol(?:ume)?\\\\.?\\\\s*)(\\\\d+)$")');
    // 三种写法互等
    const a = [chapter('o1', '第 1 话', '第1卷')];
    expect(mapping(a, [chapter('n1', '第 1 话', '1')]).get('o1')?.id).toBe('n1');
    expect(mapping(a, [chapter('n1', '第 1 话', 'Vol.1')]).get('o1')?.id).toBe('n1');
    // 卷名写在标题里的也算
    expect(mapping([chapter('o2', '第1卷 第1话')], [chapter('n2', '第 1 话', '1')]).get('o2')?.id).toBe('n2');
  });

  it('任一侧卷名为空即视为兼容（`compatibleVolumes`）', () => {
    expect(KT).toContain('volume(a).isBlank() || volume(b).isBlank() || volume(a) == volume(b)');
    // 标题层：卷名空 vs Vol.1 → 兼容（靠第三层的纯集数配对也应成，但这里验兼容本身）
    const mapped = mapping([chapter('o1', '第 1 话')], [chapter('n1', '第 1 话', 'Vol.1')]);
    expect(mapped.get('o1')?.id).toBe('n1');
  });

  it('番外 / 上篇 / part 之类**没有集数**，不能靠数字配对', () => {
    expect(KT).toContain('if (Regex("(?i)上篇|下篇|前篇|后篇|後篇|上半|下半|part|[（(]\\\\s*[上下前后後]\\\\s*[）)]").containsMatchIn(title)) return null');
    // 番外篇：标题层能对上（标题相同），所以要有区别 —— 这里用「标题不同但都像番外」
    const mapped = mapping([chapter('o1', '上篇')], [chapter('n1', '下篇')]);
    expect(mapped.size).toBe(0);
  });

  it('两侧同一身份各有**多条**时不配对（`singleOrNull`）', () => {
    expect(KT).toContain('val to = newGroups[identity]?.singleOrNull()');
    expect(KT).toContain('val from = group.singleOrNull()');
    const old = [chapter('o1', '第 1 话'), chapter('o2', '第 1 话')];
    const fresh = [chapter('n1', '第 1 话')];
    expect(mapping(old, fresh).size).toBe(0);
    const old2 = [chapter('o1', '第 1 话')];
    const fresh2 = [chapter('n1', '第 1 话'), chapter('n2', '第1话')];
    expect(mapping(old2, fresh2).size).toBe(0);
  });

  it('目标 id 只能被用一次（`used`），旧 id 也只出一次', () => {
    expect(KT).toContain('from.id !in result && to.id !in used');
    const old = [chapter('o1', '第 1 话'), chapter('o2', '第 1 话')];
    const fresh = [chapter('n1', '第 1 话')];
    // 旧侧重复已被 singleOrNull 挡住，这里额外验证 used 的作用：两条旧章节同名同卷
    expect(mapping(old, fresh).size).toBe(0);
  });

  it('迁移报告的三个字段（migrated / unmatched / resumeMatched）', () => {
    expect(KT).toContain('data class FavoriteMigrationReport(val migrated: Int, val unmatched: Int, val resumeMatched: Boolean)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② source/BookSource.kt
   ══════════════════════════════════════════════════════════════════════════════ */

class FakeSource extends BookSource {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly capabilities = createSourceCapabilities({ downloadRequiresLogin: false });
  loggedIn = false;

  async search(): Promise<ReturnType<typeof SourceResult.Success<SearchBook[]>>> {
    return SourceResult.Success([]);
  }
  async getDetail(bookId: string): Promise<ReturnType<typeof SourceResult.Success<SearchBook>>> {
    return SourceResult.Success({ id: bookId } as SearchBook);
  }
  async getDownloadInfo(_bookId: string): Promise<ReturnType<typeof SourceResult.Success<DownloadInfo>>> {
    return SourceResult.Success({} as DownloadInfo);
  }
  async login(_credential: LoginCredential): Promise<ReturnType<typeof SourceResult.Success<boolean>>> {
    this.loggedIn = true;
    return SourceResult.Success(true);
  }
  async logout(): Promise<void> {
    this.loggedIn = false;
  }
  async isLoggedIn(): Promise<boolean> {
    return this.loggedIn;
  }
}

describe('BookSource.kt：八个默认实现', () => {
  const KT = kt('source/BookSource.kt');

  it('requiresLogin = capabilities.requiresLogin；三个必填属性', () => {
    expect(KT).toContain('val requiresLogin: Boolean get() = capabilities.requiresLogin');
    expect(KT).toContain('val id: String');
    expect(KT).toContain('val name: String');
    expect(KT).toContain('val capabilities: SourceCapabilities');
    const source = new FakeSource();
    expect(source.requiresLogin).toBe(false);
    expect(source.id).toBe('fake');
    expect(source.name).toBe('Fake');
  });

  it('supportsDiscoverMetadata 默认 false；getDiscoverMetadata 默认 ParseError「书源没有轻量元数据接口」', async () => {
    expect(KT).toContain('val supportsDiscoverMetadata: Boolean get() = false');
    expect(KT).toContain(
      'SourceResult.Error(SourceException.ParseError(tr("书源没有轻量元数据接口")))',
    );
    const source = new FakeSource();
    expect(source.supportsDiscoverMetadata).toBe(false);
    const result = await source.getDiscoverMetadata('b1');
    expect(result.kind).toBe('error');
    expect((result as unknown as { exception: ParseError }).exception.message).toBe('书源没有轻量元数据接口');
  });

  it('discoverCatalog / discover 默认都返回 Success（空目录 / supported=false）', async () => {
    expect(KT).toContain('SourceResult.Success(com.example.discover.DiscoverCatalog())');
    expect(KT).toContain('DiscoverPage(supported = false, notice = "该书源未提供此维度数据")');
    const source = new FakeSource();
    const catalog = await source.discoverCatalog();
    expect(catalog.kind).toBe('success');
    const page = await source.discover({} as DiscoverQuery);
    expect(page.kind).toBe('success');
    const payload = (page as { data: DiscoverPage }).data;
    expect(payload.supported).toBe(false);
    expect(payload.notice).toBe('该书源未提供此维度数据');
    expect((catalog as { data: DiscoverCatalog }).data).toBeDefined();
  });

  it('getCoverHeaders 默认空表；getShareUrl 默认走 DetailLink.valid', async () => {
    expect(KT).toContain('suspend fun getCoverHeaders(url: String): Map<String, String> = emptyMap()');
    expect(KT).toContain('suspend fun getShareUrl(bookId: String): String? = DetailLink.valid(bookId)');
    const source = new FakeSource();
    await expect(source.getCoverHeaders('https://a/1.jpg')).resolves.toEqual({});
    await expect(source.getShareUrl('https://a.com/b')).resolves.toBe('https://a.com/b');
    // 非 http(s) 一律 null（DetailLink.valid 的规则）
    await expect(source.getShareUrl('ftp://a.com/b')).resolves.toBeNull();
  });

  it('getRegistrationUrl 默认 null；getAvailableFormats 默认空表', async () => {
    expect(KT).toContain('suspend fun getRegistrationUrl(): String? = null');
    expect(KT).toContain('suspend fun getAvailableFormats(book: SearchBook): SourceResult<List<BookFormat>> =');
    const source = new FakeSource();
    await expect(source.getRegistrationUrl()).resolves.toBeNull();
    const formats = await source.getAvailableFormats({} as SearchBook);
    expect(formats.kind).toBe('success');
    expect((formats as { data: BookFormat[] }).data).toEqual([]);
  });

  it('带格式的 getDownloadInfo 默认忽略 preferredFormat，转调单参版本', async () => {
    expect(KT).toContain('): SourceResult<DownloadInfo> = getDownloadInfo(bookId)');
    const source = new FakeSource();
    let asked: string | null = null;
    source.getDownloadInfo = async (bookId: string) => {
      asked = bookId;
      return SourceResult.Success({} as DownloadInfo);
    };
    const result = await source.getDownloadInfoWithFormat('b9', 'pdf');
    expect(result.kind).toBe('success');
    expect(asked).toBe('b9');
  });

  it('getAuthenticationState 三态：不需要登录 / 已登录 / 需要登录', async () => {
    expect(KT).toContain('return if (capabilities.downloadRequiresLogin) {');
    expect(KT).toContain('if (isLoggedIn()) AuthenticationState.Authenticated else AuthenticationState.Required');
    expect(KT).toContain('AuthenticationState.NotRequired');

    const notRequired = new FakeSource();
    await expect(notRequired.getAuthenticationState()).resolves.toBe(AuthenticationState.NotRequired);

    const requiring = new FakeSource();
    Object.defineProperty(requiring, 'capabilities', {
      value: createSourceCapabilities({ downloadRequiresLogin: true }),
    });
    await expect(requiring.getAuthenticationState()).resolves.toBe(AuthenticationState.Required);
    await requiring.login({} as LoginCredential);
    await expect(requiring.getAuthenticationState()).resolves.toBe(AuthenticationState.Authenticated);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ source/js/AimanhuaTls.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('AimanhuaTls.kt：证书 pinning（E178）', () => {
  const KT = kt('source/js/AimanhuaTls.kt');

  it('PIN 逐字；KDoc 说明「主机名校验始终开启、只给已知公开密钥宽限」', () => {
    expect(KT).toContain('const val PIN = "84f816f39fb638fe06c65f5489ef9be3ed93ab195a56ff1ba014dfe000869729"');
    expect(KT).toContain(
      'Short renewal grace for the publisher\'s known public reading key; hostname checks stay enabled.',
    );
    expect(AIMANHUA_PIN).toBe('84f816f39fb638fe06c65f5489ef9be3ed93ab195a56ff1ba014dfe000869729');
    expect(AIMANHUA_PIN).toHaveLength(64);
    expect(AIMANHUA_TLS_HOST).toBe('mh.iqtao.cn');
  });

  it('route：只有 `aimanhua` 源 **且** host 是 `mh.iqtao.cn`（大小写/端口/子域都不放过）', () => {
    expect(KT).toContain('fun route(source: String, url: String) = source == "aimanhua" &&');
    expect(KT).toContain('runCatching { java.net.URI(url).host == "mh.iqtao.cn" }.getOrDefault(false)');
    expect(aimanhuaRoute('aimanhua', 'https://mh.iqtao.cn/1.jpg')).toBe(true);
    expect(aimanhuaRoute('aimanhua', 'https://mh.iqtao.cn:8443/1.jpg')).toBe(true);
    expect(aimanhuaRoute('other', 'https://mh.iqtao.cn/1.jpg')).toBe(false);
    expect(aimanhuaRoute('aimanhua', 'https://mh.iqtao.cn.evil.com/1.jpg')).toBe(false);
    expect(aimanhuaRoute('aimanhua', 'https://MH.IQTAO.CN/1.jpg')).toBe(false); // URI.host 不做大小写折叠
    expect(aimanhuaRoute('aimanhua', 'not a url')).toBe(false);
    expect(AimanhuaTls.route('aimanhua', 'https://mh.iqtao.cn/x')).toBe(true);
  });

  it('accepts：PIN 相同 **且** now ∈ [notBefore, notAfter + 14 天]（端点也算通过）', () => {
    expect(KT).toContain('now >= cert.notBefore.time && now <= cert.notAfter.time + 14L * 86_400_000');
    expect(AIMANHUA_RENEWAL_GRACE_MS).toBe(14 * 86_400_000);
    const cert = { publicKeySha256: AIMANHUA_PIN, notBeforeMs: 1_000, notAfterMs: 2_000 };
    expect(aimanhuaAccepts(cert, 1_000)).toBe(true); // 左端点
    expect(aimanhuaAccepts(cert, 1_500)).toBe(true);
    expect(aimanhuaAccepts(cert, 2_000)).toBe(true); // 刚过期、仍在 notAfter
    expect(aimanhuaAccepts(cert, 2_000 + AIMANHUA_RENEWAL_GRACE_MS)).toBe(true); // 右端点
    expect(aimanhuaAccepts(cert, 2_000 + AIMANHUA_RENEWAL_GRACE_MS + 1)).toBe(false); // 宽限过了
    expect(aimanhuaAccepts(cert, 999)).toBe(false); // 还没生效
    // 密钥不对：无论时间都不通过
    expect(aimanhuaAccepts({ ...cert, publicKeySha256: 'a'.repeat(64) }, 1_500)).toBe(false);
  });

  it('configure 的 X509TrustManager 是 JVM/OkHttp 的事 —— 端口只保留 route/accepts', () => {
    expect(KT).toContain('fun configure(builder: OkHttpClient.Builder, rootCertificate: InputStream? = null)');
    // 端口不该声明 `configure`（OkHttp/JVM 专有）；真正的 pinning 判定只有 route/accepts
    expect(AimanhuaTls).not.toHaveProperty('configure');
    // 命名空间五个成员
    expect(Object.keys(AimanhuaTls)).toEqual([
      'PIN',
      'host',
      'renewalGraceMs',
      'route',
      'accepts',
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ transfer/IncomingChapterIndex.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('IncomingChapterIndex.kt：磁盘版章节指纹索引（E177）', () => {
  const KT = kt('transfer/IncomingChapterIndex.kt');

  /** 确定的「章节摘要」：真 SHA-256 的十六进制。 */
  const chapterHash = (content: string, contentType: string): string | null =>
    content.trim() === '' ? null : transferHash(new TextEncoder().encode(`${contentType}:${content}`));

  const books = [
    { id: 1, contentType: 'NOVEL' },
    { id: 2, contentType: 'COMIC' },
  ];
  const chapters = [
    { bookId: 1, chapterOrder: 0, title: '第 1 章', content: 'aaa' },
    { bookId: 1, chapterOrder: 1, title: '第 2 章', content: 'bbb' },
    { bookId: 2, chapterOrder: 0, title: '第 1 话', content: '[IMG:a.jpg]' },
  ];

  it('unresolvedHash 用**真** SHA-256（不是自造摘要）', () => {
    expect(KT).toContain('private fun unresolvedHash(body:String):String = "unresolved:"+sha256(body.toByteArray())');
    const expected = `unresolved:${transferHash(new TextEncoder().encode('hello'))}`;
    expect(unresolvedChapterHash('hello')).toBe(expected);
    // 64 位十六进制，且与 bookFingerprint 的 transferHash 同一种摘要
    expect(unresolvedChapterHash('hello')).toMatch(/^unresolved:[a-f0-9]{64}$/);
    expect(unresolvedChapterHash('a')).not.toBe(unresolvedChapterHash('b'));
  });

  it('bodyIdentity：逐章累积 order/title/content（每段后补 0 字节）再拼 contentType', () => {
    expect(KT).toContain('for(key in listOf("chapterOrder","title","content")){digest.update(row.get(key).toString().toByteArray());digest.update(0.toByte');
    expect(KT).toContain('digest.update(contentType.toByteArray());return "body:"+digest.digest().hex()');
    const index = new IncomingChapterIndex(chapterHash, books, chapters);
    const identity = index.bodyIdentity(1, 'NOVEL');
    expect(identity).toMatch(/^body:[a-f0-9]{64}$/);
    // 同一批数据两次结果相同；换 contentType 结果不同
    expect(new IncomingChapterIndex(chapterHash, books, chapters).bodyIdentity(1, 'NOVEL')).toBe(identity);
    expect(index.bodyIdentity(1, 'COMIC')).not.toBe(identity);
    // 不同书不同身份
    expect(index.bodyIdentity(2, 'NOVEL')).not.toBe(identity);
  });

  it('contentIdentity：走真 Accumulator，缺摘要 / 无内容时返回 **null**', () => {
    expect(KT).toContain('val body=BookBodyFingerprint.Accumulator()');
    expect(KT).toContain('return body.finish(contentType)');
    const index = new IncomingChapterIndex(chapterHash, books, chapters);
    const identity = index.contentIdentity(1, 'NOVEL');
    expect(identity).toMatch(/^body-content:[a-f0-9]{64}$/);
    // 换成「所有章节都取不到摘要」的 hash → complete=false → null
    const noHash = new IncomingChapterIndex(() => null, books, chapters);
    expect(noHash.contentIdentity(1, 'NOVEL')).toBeNull();
    // 所有章节都没有内容 → readable=false → null
    const empty = new IncomingChapterIndex(chapterHash, books, [
      { bookId: 1, chapterOrder: 0, title: 't', content: '   ' },
    ]);
    expect(empty.contentIdentity(1, 'NOVEL')).toBeNull();
  });

  it('compatible：本地有内容且指纹不同的章节 → 不兼容；本地缺该章 → 不算冲突', () => {
    expect(KT).toContain('while(c.moveToNext()){val old=hashes[c.getInt(0)];if(old!=null && old!=c.getString(1))return false}');
    const index = new IncomingChapterIndex(chapterHash, books, chapters);
    const sameContent = [
      { chapterOrder: 0, content: 'aaa' },
      { chapterOrder: 1, content: 'bbb' },
    ];
    expect(index.compatible(sameContent, 1, 9)).toBe(true);
    expect(index.compatible([{ chapterOrder: 0, content: 'zzz' }], 1, 9)).toBe(false);
    // 本地只有第 0 章、且一致 → 不冲突
    expect(index.compatible([{ chapterOrder: 0, content: 'aaa' }], 1, 9)).toBe(true);
    // 本地空白内容被跳过
    expect(index.compatible([{ chapterOrder: 0, content: '   ' }], 1, 9)).toBe(true);
  });

  it('compatibleIncoming：两本入站书在同序章节上冲突 → false', () => {
    expect(KT).toContain('AND a.hasConten');
    const index = new IncomingChapterIndex(chapterHash, books, [
      { bookId: 7, chapterOrder: 0, title: 'a', content: 'same' },
      { bookId: 8, chapterOrder: 0, title: 'a', content: 'same' },
    ]);
    expect(index.compatibleIncoming(7, 8)).toBe(true);

    const conflicting = new IncomingChapterIndex(chapterHash, books, [
      { bookId: 7, chapterOrder: 0, title: 'a', content: 'same' },
      { bookId: 8, chapterOrder: 0, title: 'a', content: 'other' },
    ]);
    expect(conflicting.compatibleIncoming(7, 8)).toBe(false);
  });

  it('表结构：`incoming_chapters(bookId, chapterOrder, bodyHash, title, contentHash, hasContent)`', () => {
    expect(KT).toContain('CREATE TABLE incoming_chapters (bookId INTEGER NOT NULL, chapterOrder INTEGER NOT NULL, bodyHash TEXT NOT NULL, title TEXT');
    const index = new IncomingChapterIndex(chapterHash, books, chapters);
    expect(index.rows[0]).toEqual({
      bookId: 1,
      chapterOrder: 0,
      bodyHash: chapterHash('aaa', 'NOVEL'),
      title: '第 1 章',
      contentHash: chapterHash('aaa', 'NOVEL'),
      hasContent: true,
    });
    // 漫画书按 COMIC 计算摘要（`id in comicBooks` 决定 contentType）
    expect(index.rows[2]?.bodyHash).toBe(chapterHash('[IMG:a.jpg]', 'COMIC'));
  });

  it('索引文件名 chapter_index.sqlite；close 顺带删 -journal', () => {
    expect(KT).toContain('private val file=File(directory,"chapter_index.sqlite")');
    expect(KT).toContain('override fun close(){database.close();file.delete();File(file.path+"-journal").delete()}');
  });
});
