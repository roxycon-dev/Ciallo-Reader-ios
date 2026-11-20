/**
 * smallImageAndDomainParity.test.ts —— 第八批（47–49 行档，6 个文件，合计 276 行）。
 *
 *   · `library/MhttuImageDecryptor.kt`（47）—— AES-256-CBC：前 16 字节当 IV、其余当密文
 *   · `data/BookImportBatch.kt`（47）—— 串行导入：去重、取消上抛、失败明细最多 5 条
 *   · `discover/DiscoverNovelDetails.kt`（48）—— 详情页三态 + 下载任务联动
 *   · `source/zlibrary/ZLibraryDomainResolver.kt`（48）—— 换域必须**固化**（E172）
 *   · `mangatranslate/TranslationFailure.kt`（49）—— 10 个常量 + http() 六档 + from() 分支序
 *   · `source/zlibrary/network/SystemProxyResolver.kt`（49）—— 系统代理两条分支
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MHTTU_KEY_SOURCE,
  MhttuImageDecryptor,
  decryptIfNeeded,
  imageExtension,
  isEncryptedHost,
  mhttuKeyBytes,
} from '@core/library/libraryImageBytes';
import { BookImportReport, importBookBatch } from '@core/data/startupDiagnostics';
import {
  ZLibraryDomainResolver,
  createDomainHealthResult,
} from '@core/source/zlibrary/zLibraryDomainResolver';
import type { ZLibraryEndpointProvider } from '@core/source/zlibrary/zLibraryEndpointProvider';
import type { EndpointHealthChecker } from '@core/source/zlibrary/endpointHealthChecker';
import {
  TRANSLATION_CONFIG,
  TRANSLATION_EMPTY,
  TRANSLATION_FORMAT,
  TRANSLATION_MEMORY,
  TRANSLATION_MODELS,
  TRANSLATION_NETWORK,
  TRANSLATION_OCR,
  TRANSLATION_OCR_ENGINE,
  TRANSLATION_PRIVACY,
  TRANSLATION_TIMEOUT,
  TranslationException,
  createTranslationFailure,
  translationFailureException,
  translationFailureForHttpStatus,
  translationFailureFrom,
} from '@core/mangatranslate/translationFailure';
import { SystemProxyResolver } from '@core/source/zlibrary/network/systemProxyResolver';
import type { AsyncCryptoPort } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('MhttuImageDecryptor.kt：AES-256-CBC 图片解密', () => {
  const KT = kt('library/MhttuImageDecryptor.kt');

  it('密钥 = "0B6666A0-BB59-1381-B746-a0E4C9AC" 的前 32 字节', () => {
    expect(KT).toContain('"0B6666A0-BB59-1381-B746-a0E4C9AC".toByteArray(Charsets.UTF_8).copyOf(32)');
    expect(MHTTU_KEY_SOURCE).toBe('0B6666A0-BB59-1381-B746-a0E4C9AC');
    expect(mhttuKeyBytes()).toHaveLength(32);
    // 源串恰好 32 个字符，`copyOf(32)` 不截断
    expect(new TextDecoder().decode(mhttuKeyBytes())).toBe(MHTTU_KEY_SOURCE);
    expect(MHTTU_KEY_SOURCE).toHaveLength(32);
  });

  it('三个 host 规则：tu.mhttu.cc / mhttu.cc / 任意 *.mhttu.cc', () => {
    expect(KT).toContain('host == "tu.mhttu.cc" || host == "mhttu.cc" || host.endsWith(".mhttu.cc")');
    expect(isEncryptedHost('tu.mhttu.cc')).toBe(true);
    expect(isEncryptedHost('mhttu.cc')).toBe(true);
    expect(isEncryptedHost('img.mhttu.cc')).toBe(true);
    expect(isEncryptedHost('mhttu.cc.evil.com')).toBe(false);
    expect(isEncryptedHost('notmhttu.cc')).toBe(false);
  });

  it('≤16 字节或已是图片 → 原样返回，且不调用解密器', async () => {
    expect(KT).toContain('if (data.size <= 16 || isImageBytes(data)) return data');
    let calls = 0;
    const crypto: AsyncCryptoPort = {
      decryptAesCbc: async () => {
        calls += 1;
        return new Uint8Array();
      },
    };
    const tiny = new Uint8Array(16);
    await expect(decryptIfNeeded(tiny, crypto)).resolves.toBe(tiny);
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    await expect(decryptIfNeeded(jpeg, crypto)).resolves.toBe(jpeg);
    expect(calls).toBe(0);
  });

  it('IV = 前 16 字节，密文 = 第 17 字节起；失败回落原数据', async () => {
    expect(KT).toContain('IvParameterSpec(data.copyOfRange(0, 16))');
    expect(KT).toContain('cipher.doFinal(data.copyOfRange(16, data.size))');
    expect(KT).toContain('} catch (e: Exception) {');
    expect(KT).toMatch(/catch \(e: Exception\) \{\r?\n\s+data\r?\n/);
    const payload = new Uint8Array(24);
    for (let i = 0; i < payload.length; i += 1) payload[i] = i;
    let seenIv: Uint8Array | null = null;
    let seenCipher: Uint8Array | null = null;
    const ok: AsyncCryptoPort = {
      decryptAesCbc: async (_key, iv, ciphertext) => {
        seenIv = iv;
        seenCipher = ciphertext;
        return new Uint8Array([0xff, 0xd8, 0xaa]);
      },
    };
    const out = await decryptIfNeeded(payload, ok);
    expect([...(seenIv as unknown as Uint8Array)]).toEqual([...payload.slice(0, 16)]);
    expect([...(seenCipher as unknown as Uint8Array)]).toEqual([...payload.slice(16)]);
    expect([...out]).toEqual([0xff, 0xd8, 0xaa]);

    const failing: AsyncCryptoPort = {
      decryptAesCbc: async () => {
        throw new Error('bad padding');
      },
    };
    await expect(decryptIfNeeded(payload, failing)).resolves.toBe(payload);
  });

  it('imageExtension：JPEG / RIFF(webp) / PNG 按序判定，其余 null', () => {
    expect(KT).toContain('data[0] == 0xFF.toByte() && data[1] == 0xD8.toByte() -> "jpg"');
    expect(imageExtension(new Uint8Array([0xff, 0xd8]))).toBe('jpg');
    expect(imageExtension(new TextEncoder().encode('RIFF0000WEBP'))).toBe('webp');
    expect(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(imageExtension(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(imageExtension(new Uint8Array([0xff]))).toBeNull();
    // 命名空间形状
    expect(Object.keys(MhttuImageDecryptor)).toEqual(
      expect.arrayContaining(['isEncryptedHost', 'decryptIfNeeded', 'imageExtension']),
    );
  });
});

describe('BookImportBatch.kt：串行导入', () => {
  const KT = kt('data/BookImportBatch.kt');

  it('先去重；进度回调三次（开始 / 解析出文件名 / 结束）', async () => {
    expect(KT).toContain('items.distinct().let { files ->');
    expect(KT).toContain('var name = "文件 ${index + 1}"');
    expect(KT).toContain('onProgress(BookImportProgress(index, files.size, name))');
    expect(KT).toContain('onProgress(BookImportProgress(index + 1, files.size, name))');
    const seen: string[] = [];
    const report = await importBookBatch(
      ['a', 'a', 'b'],
      (progress) =>
        seen.push(`${String(progress.completed)}/${String(progress.total)}:${progress.fileName}`),
      async (item, resolved) => {
        resolved(`${item}.epub`);
      },
    );
    expect(report.succeeded).toBe(2);
    expect(seen).toEqual([
      '0/2:文件 1',
      '0/2:a.epub',
      '1/2:a.epub',
      '1/2:文件 2',
      '1/2:b.epub',
      '2/2:b.epub',
    ]);
  });

  it('单文件失败不中断；明细最多 5 条，其余汇总成「另有 N 本失败」', async () => {
    expect(KT).toContain('if (failures.size < 5) failures += "$name：${e.localizedMessage ?: "未知错误"}"');
    expect(KT).toContain('append("\\n另有 ${failed - failures.size} 本失败，请检查文件后重试")');
    const items = Array.from({ length: 8 }, (_, i) => `f${String(i)}`);
    const report = await importBookBatch(
      items,
      () => undefined,
      async (item, resolved) => {
        resolved(item);
        throw new Error('坏文件');
      },
    );
    expect(report.failed).toBe(8);
    expect(report.failures).toHaveLength(5);
    const message = report.message();
    expect(message).toContain('导入完成：成功 0 本，失败 8 本');
    expect(message).toContain('另有 3 本失败，请检查文件后重试');
  });

  it('取消必须原样上抛（不计入失败）', async () => {
    expect(KT).toContain('currentCoroutineContext().ensureActive()');
    expect(KT).toContain('catch (e: CancellationException) {');
    expect(KT).toMatch(/catch \(e: CancellationException\) \{\r?\n\s+throw e/);
    let treated = 0;
    await expect(
      importBookBatch(
        ['a', 'b'],
        () => undefined,
        async () => {
          treated += 1;
          throw new Error('x');
        },
        () => treated >= 1,
      ),
    ).rejects.toThrow();
    expect(treated).toBe(1);
  });

  it('报告文案：成功/失败计数 + 明细换行拼接', () => {
    expect(new BookImportReport(2, 1, ['a：坏']).message()).toBe(
      '导入完成：成功 2 本，失败 1 本\na：坏',
    );
  });
});

describe('DiscoverNovelDetails.kt：详情页三态', () => {
  const KT = kt('discover/DiscoverNovelDetails.kt');
  const TSX = readFileSync('src/ui/components/discover/DiscoverNovelDetails.tsx', 'utf8');

  it('book 为 null 直接返回；loading 初始 true；两个兜底文案逐字', () => {
    expect(KT).toContain('if (book == null) return');
    expect(KT).toContain('var loading by remember(book.sourceId, book.id) { mutableStateOf(true) }');
    expect(KT).toContain('is SourceResult.Error -> error = result.exception.message ?: "详情暂时无法加载"');
    expect(KT).toContain('catch (e: CancellationException) { throw e }');
    expect(KT).toContain('catch (e: Exception) { error = e.message ?: "详情暂时无法加载" }');
    expect(KT).toContain('finally { loading = false }');
    expect(TSX).toContain('详情暂时无法加载');
    // ⚠️ Kotlin 传了 `flightKey = local?.id?.toString()`（共享封面飞入动画的 key），
    // TS 的 `NovelDetailSheet` 没有这个 prop —— 已登记 E173。
    expect(KT).toContain('flightKey = local?.id?.toString()');
    expect(TSX).not.toContain('flightKey');
  });

  it('下载任务 id = DownloadManager.taskId(sourceId, id)；缺失时 Idle', () => {
    expect(KT).toContain('val task = com.example.download.DownloadManager.taskId(book.sourceId, book.id)');
    expect(KT).toContain('val state = downloads[task] ?: DownloadState.Idle');
    expect(TSX).toContain('taskId(');
  });

  it('「阅读」只在有本地书时可用；下载成功会触发本地书重查', () => {
    expect(KT).toContain('LaunchedEffect(book.sourceId, book.id, state is DownloadState.Success) { local = model.localNovel(book) }');
    expect(KT).toContain('onRead = { local?.let(onRead) }');
    expect(KT).toContain('flightKey = local?.id?.toString()');
  });
});

describe('ZLibraryDomainResolver.kt：换域必须固化（E172）', () => {
  const KT = kt('source/zlibrary/ZLibraryDomainResolver.kt');

  it('五个方法都只转调注入的 provider / healthChecker', () => {
    expect(KT).toContain('private val endpointProvider = ZLibraryEndpointProvider(context, credentialStorage)');
    expect(KT).toContain('private val healthChecker = EndpointHealthChecker(context)');
    expect(KT).toContain('endpointProvider.getEndpoint(forceRefresh = forceScan)');
    expect(KT).toContain('endpointProvider.nextEndpoint(excluded)');
    expect(KT).toContain('endpointProvider.saveCache(domain)');
    expect(KT).toContain('endpointProvider.invalidateCache()');
  });

  it('resolveNextDomain 走 nextEndpoint（= scan + adoptLiveNode），不是裸 scan', async () => {
    const providerFile = readFileSync(
      'src/core/source/zlibrary/zLibraryEndpointProvider.ts',
      'utf8',
    );
    // Kotlin L114-117 的三步在这一层
    expect(providerFile).toContain('async nextEndpoint(excluded: ReadonlySet<string>): Promise<string | null>');
    expect(providerFile).toContain('this.adoptLiveNode(winner)');
    // Kotlin KDoc：perdered mirror 必须落盘
    const kotlinProvider = kt('source/zlibrary/ZLibraryEndpointProvider.kt');
    expect(kotlinProvider).toContain('Persist the working mirror so restarting does not return to the failed one.');
    expect(kotlinProvider).toContain('suspend fun nextEndpoint(excluded: Set<String>): String?');
    expect(kotlinProvider).toContain('scanForLiveNode(excluded)?.also { adoptLiveNode(it) }');

    const adopted: string[] = [];
    const provider = {
      getEndpoint: async (force: boolean) => (force ? 'forced.example' : 'cached.example'),
      nextEndpoint: async (excluded: ReadonlySet<string>) => {
        adopted.push([...excluded].join(','));
        return 'next.example';
      },
      saveCache: async () => undefined,
      invalidateCache: async () => undefined,
    } as unknown as ZLibraryEndpointProvider;
    const resolver = new ZLibraryDomainResolver(provider, {} as EndpointHealthChecker);
    await expect(resolver.resolveNextDomain(new Set(['bad.example']))).resolves.toBe('next.example');
    expect(adopted).toEqual(['bad.example']);
    await expect(resolver.resolveDomain(true)).resolves.toBe('forced.example');
    await expect(resolver.resolveDomain()).resolves.toBe('cached.example');
  });

  it('checkDomainHealth 透传五个字段；DomainHealthResult.error 默认 null', async () => {
    expect(KT).toContain('data class DomainHealthResult(');
    expect(KT).toContain('val error: String? = null');
    const checker = {
      checkHealth: async () => ({ isAvailable: true, rtt: 42, isCloudflare: false, error: '' }),
    } as unknown as EndpointHealthChecker;
    const resolver = new ZLibraryDomainResolver({} as ZLibraryEndpointProvider, checker);
    await expect(resolver.checkDomainHealth('a.example')).resolves.toEqual({
      domain: 'a.example',
      isAvailable: true,
      rtt: 42,
      isCloudflare: false,
      error: '',
    });
    expect(createDomainHealthResult({ domain: 'd', isAvailable: false, rtt: 0, isCloudflare: true })).toEqual({
      domain: 'd',
      isAvailable: false,
      rtt: 0,
      isCloudflare: true,
      error: null,
    });
  });
});

describe('TranslationFailure.kt：10 个常量与两张映射表', () => {
  const KT = kt('mangatranslate/TranslationFailure.kt');

  it('九个固定常量 + 两个 fallback；code 与 retryable 逐条对齐', () => {
    expect(KT).toContain('val Privacy = TranslationFailure("privacy", "隐私模式禁止在线翻译，请关闭隐私模式后再试")');
    expect(KT).toContain('val Ocr = TranslationFailure("ocr", "文字识别未成功，请检查清晰度或选择原文语言", true)');
    expect(KT).toContain('val OcrEngine = TranslationFailure("ocr_init", "OCR 引擎加载失败，请关闭翻译后重新开启", true)');
    expect(KT).toContain('val Empty = TranslationFailure("empty", "未获得有效译文，请检查原文语言或切换翻译引擎", true)');
    expect(KT).toContain('val Config = TranslationFailure("config", "请先配置 AI 地址和模型名")');
    expect(KT).toContain('val Format = TranslationFailure("format", "服务返回的译文格式不正确，请更换模型或重试", true)');
    expect(KT).toContain('val Timeout = TranslationFailure("timeout", "翻译请求超时，请检查网络或换用更快的模型", true)');
    expect(KT).toContain('val Network = TranslationFailure("network", "无法连接翻译服务，请检查网络和代理设置", true)');

    const expected: Array<[typeof TRANSLATION_PRIVACY, string, boolean]> = [
      [TRANSLATION_PRIVACY, 'privacy', false],
      [TRANSLATION_MODELS, 'models', false],
      [TRANSLATION_OCR, 'ocr', true],
      [TRANSLATION_OCR_ENGINE, 'ocr_init', true],
      [TRANSLATION_EMPTY, 'empty', true],
      [TRANSLATION_CONFIG, 'config', false],
      [TRANSLATION_FORMAT, 'format', true],
      [TRANSLATION_TIMEOUT, 'timeout', true],
      [TRANSLATION_NETWORK, 'network', true],
      [TRANSLATION_MEMORY, 'memory', false],
    ];
    for (const [failure, code, retryable] of expected) {
      expect(failure.code).toBe(code);
      expect(failure.retryable).toBe(retryable);
    }
  });

  it('description 是**读取时**翻译（getter），不是构造期冻结的字符串', () => {
    expect(KT).toContain('val description: String get() = com.example.i18n.tr(rawDescription)');
    expect(KT).toContain('在构造参数里调 `tr()`');
    const descriptor = Object.getOwnPropertyDescriptor(TRANSLATION_PRIVACY, 'description');
    expect(typeof descriptor?.get).toBe('function');
    // 默认语言（中文）下取到原文
    expect(TRANSLATION_PRIVACY.description).toBe('隐私模式禁止在线翻译，请关闭隐私模式后再试');
  });

  it('http(status)：401/403 auth、402 quota、404 endpoint、429 limited、5xx service、其余 request', () => {
    expect(KT).toContain('401, 403 -> TranslationFailure("auth", "服务拒绝访问（$status），请检查 API Key 或切换引擎")');
    expect(translationFailureForHttpStatus(401)).toMatchObject({ code: 'auth', retryable: false });
    expect(translationFailureForHttpStatus(403).code).toBe('auth');
    expect(translationFailureForHttpStatus(402).code).toBe('quota');
    expect(translationFailureForHttpStatus(404).code).toBe('endpoint');
    expect(translationFailureForHttpStatus(429)).toMatchObject({ code: 'limited', retryable: true });
    expect(translationFailureForHttpStatus(500)).toMatchObject({ code: 'service', retryable: true });
    expect(translationFailureForHttpStatus(599).code).toBe('service');
    expect(translationFailureForHttpStatus(400)).toMatchObject({ code: 'request', retryable: false });
    // 状态码要出现在文案里
    expect(translationFailureForHttpStatus(403).description).toContain('403');
    expect(translationFailureForHttpStatus(503).description).toContain('503');
  });

  it('from(error)：TranslationException 透传 → 超时 → 网络 → 内存 → 参数 → internal', () => {
    expect(KT).toContain('is TranslationException -> error.failure');
    const original = createTranslationFailure('custom', '自定义');
    expect(translationFailureFrom(translationFailureException(original))).toBe(original);

    const timeout = new Error('x');
    timeout.name = 'TimeoutError';
    expect(translationFailureFrom(timeout)).toBe(TRANSLATION_TIMEOUT);
    expect(translationFailureFrom(new TypeError('fetch failed'))).toBe(TRANSLATION_NETWORK);
    // 端口用 message 启发式代表 `OutOfMemoryError`（JS 没有该错误类型，见文件头 ADAPTATIONS）
    expect(translationFailureFrom(new RangeError('allocation failed'))).toBe(TRANSLATION_MEMORY);
    expect(translationFailureFrom(new RangeError('Invalid typed array length')).code).toBe('input');
    // RangeError 的 message 不含 allocation/memory → 落到 IllegalArgumentException 那一档（input）
    expect(translationFailureFrom(new RangeError('bad length')).code).toBe('input');
    expect(translationFailureFrom(new Error('boom')).code).toBe('internal');
    expect(translationFailureFrom(new Error('boom')).retryable).toBe(true);
  });

  it('TranslationException 的 message 就是 failure.description', () => {
    expect(KT).toContain('class TranslationException(val failure: TranslationFailure) : Exception(failure.description)');
    const failure = createTranslationFailure('x', '出错了', true);
    const error = translationFailureException(failure);
    expect(error).toBeInstanceOf(TranslationException);
    expect(error.message).toBe('出错了');
    expect(error.failure).toBe(failure);
  });
});

describe('SystemProxyResolver.kt：两条分支', () => {
  const KT = kt('source/zlibrary/network/SystemProxyResolver.kt');

  it('分支一：defaultProxy 且 host 非空、port > 0；异常落到分支二', () => {
    expect(KT).toContain('val info = cm?.defaultProxy');
    expect(KT).toContain('if (info != null && !info.host.isNullOrBlank() && info.port > 0)');
    expect(KT).toContain('Proxy(Proxy.Type.HTTP, InetSocketAddress(info.host, info.port))');
    expect(
      SystemProxyResolver.resolve({
        defaultProxy: () => ({ host: '127.0.0.1', port: 7890 }),
        selectDefaultProxy: () => ({ host: 'fallback', port: 1 }),
      }),
    ).toEqual({ host: '127.0.0.1', port: 7890 });
  });

  it('分支一不成立时回落 selectDefaultProxy("https://zlib.invalid")', () => {
    expect(KT).toContain('?.select(URI("https://zlib.invalid"))');
    expect(KT).toContain('?.firstOrNull { it.type() == Proxy.Type.HTTP }');
    let asked: string | null = null;
    const resolved = SystemProxyResolver.resolve({
      defaultProxy: () => ({ host: '   ', port: 7890 }),
      selectDefaultProxy: (uri) => {
        asked = uri;
        return { host: 'proxy.example', port: 8080 };
      },
    });
    expect(resolved).toEqual({ host: 'proxy.example', port: 8080 });
    expect(asked).toBe('https://zlib.invalid');
    // port <= 0 也回落
    expect(
      SystemProxyResolver.resolve({
        defaultProxy: () => ({ host: 'h', port: 0 }),
        selectDefaultProxy: () => null,
      }),
    ).toBeNull();
  });

  it('没有宿主注入 / 两端都抛：返回 null，不抛错', () => {
    expect(KT).toContain('fun resolve(context: Context?): Proxy?');
    expect(SystemProxyResolver.resolve(null)).toBeNull();
    expect(
      SystemProxyResolver.resolve({
        defaultProxy: () => {
          throw new Error('binder');
        },
        selectDefaultProxy: () => ({ host: 'x', port: 1 }),
      }),
    ).toEqual({ host: 'x', port: 1 });
    expect(
      SystemProxyResolver.resolve({
        defaultProxy: () => {
          throw new Error('binder');
        },
        selectDefaultProxy: () => {
          throw new Error('selector');
        },
      }),
    ).toBeNull();
  });
});
