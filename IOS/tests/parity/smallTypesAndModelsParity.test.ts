/**
 * smallTypesAndModelsParity.test.ts —— 第四批**小文件**（合计 155 行，12 个文件）。
 *
 *   · `data/ReadingStats.kt`（0 字节 / 1 行空文件）—— 什么都没有，端口也不许编
 *   · `source/storage/SourceStorage.kt`（11）—— 七个 suspend 方法的接口
 *   · `ReaderApplication.kt`（11）—— `onCreate` 只有 `StartupDiagnostics.install(this)`
 *   · `ui/comic/MangaJaNaiGpu.kt`（12）—— 四个 JNI 入口 + `loadLibrary("mangajanai")`
 *   · `source/zlibrary/RemoteEndpointConfig.kt`（13）—— 四个字段
 *   · `source/ComicChapter.kt`（13）—— 四个默认值
 *   · `source/DownloadInfo.kt`（13）—— `format` 默认 `epub`
 *   · `download/DownloadRequest.kt`（13）—— 九个字段 + 三个默认值
 *   · `library/LibraryError.kt`（13）—— 八个分支 + `message` 语义
 *   · `data/AppUpdateCleanupReceiver.kt`（17）—— action 守卫 → `goAsync` → finally
 *   · `source/SourceResult.kt`（18）—— `map` / `getOrNull`
 *   · `source/BookFormat.kt`（21）—— 六个字段 + eapi 两个变体键
 *
 * 本轮挖到两处真漂移（E167 / E168）：
 *   ① `ReaderApplication` 被移植成「启动顺序表」——Kotlin 只有一句 `install`；
 *   ② 包替换接收器在 action 不匹配时也调 `finish()` ——Kotlin 的 `return` 在
 *      `goAsync()` 之前，那条分支压根没有 `result.finish()`。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ReaderApplication } from '@core/ui/parityMisc';
import type { SourceStorage } from '@core/source/storage/sourceStorage';
import { createRemoteEndpointConfig } from '@core/source/zlibrary/remoteEndpointConfig';
import { createComicChapter } from '@core/source/comicChapter';
import { createDownloadInfo } from '@core/source/downloadInfo';
import type { DownloadRequest } from '@core/download/downloadRequest';
import {
  LibraryError,
  libraryErrorMessage,
} from '@core/library/libraryTypes';
import {
  ACTION_MY_PACKAGE_REPLACED,
  PACKAGE_REPLACED_ACTION,
  createAppUpdateCleanupReceiver,
} from '@core/update/appUpdateCleanupReceiver';
import {
  SourceResult,
  isErrorSourceResult,
  isSuccessSourceResult,
  sourceError,
  sourceSuccess,
} from '@core/source/sourceResult';
import { createBookFormat } from '@core/source/bookFormat';
import { BookNotFound, NetworkError } from '@core/source/sourceException';
import type { MangaJaNaiGpuPort } from '@core/comic/mangaJaNaiFullRuntime';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('data/ReadingStats.kt：空文件', () => {
  const path = androidReference('app/src/main/java/com/example/data/ReadingStats.kt');

  it('Kotlin 侧 0 字节、0 条声明 —— 端口不得凭空造一个 ReadingStats 模块', () => {
    expect(readFileSync(path).length).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('');
    // `ui/components/ReadingStats.kt`（212 行）才是真身，它有自己的端口；
    // data/ 下这个空文件不产生任何 `src/core/data/readingStats.ts`。
    expect(existsSync('src/core/data/readingStats.ts')).toBe(false);
    expect(existsSync('src/ui/lib/readingStats.ts')).toBe(true);
  });
});

describe('SourceStorage.kt：七个 suspend 方法', () => {
  const KT = kt('source/storage/SourceStorage.kt');

  it('接口恰好七个方法，名称与参数逐字（顺序也一致）', () => {
    const expected = [
      'suspend fun saveSourceState(sourceId: String, enabled: Boolean)',
      'suspend fun getSourceStates(): Map<String, Boolean>',
      'suspend fun saveActiveSourceId(sourceId: String)',
      'suspend fun getActiveSourceId(): String?',
      'suspend fun saveCustomSourceJson(sourceId: String, jsonContent: String)',
      'suspend fun getCustomSourceJsons(): Map<String, String>',
      'suspend fun removeCustomSourceJson(sourceId: String)',
    ];
    for (const line of expected) expect(KT).toContain(line);
    expect(KT).toContain('interface SourceStorage {');
    // 顺序：七个方法在原文里就是这七行，按出现位置递增
    const positions = expected.map((line) => KT.indexOf(line));
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i] as number).toBeGreaterThan(positions[i - 1] as number);
    }
  });

  it('TS 端七个方法同名、`Map` → `Record`、`String?` → `string | null`', () => {
    const fake: SourceStorage = {
      saveSourceState: async () => undefined,
      getSourceStates: async () => ({}),
      saveActiveSourceId: async () => undefined,
      getActiveSourceId: async () => null,
      saveCustomSourceJson: async () => undefined,
      getCustomSourceJsons: async () => ({}),
      removeCustomSourceJson: async () => undefined,
    };
    expect(Object.keys(fake)).toEqual([
      'saveSourceState',
      'getSourceStates',
      'saveActiveSourceId',
      'getActiveSourceId',
      'saveCustomSourceJson',
      'getCustomSourceJsons',
      'removeCustomSourceJson',
    ]);
    return expect(fake.getActiveSourceId()).resolves.toBeNull();
  });
});

describe('ReaderApplication.kt：onCreate 只有一句 install', () => {
  const KT = kt('ReaderApplication.kt');

  it('Kotlin 只调 `StartupDiagnostics.install(this)`，没有启动顺序表', () => {
    expect(KT).toContain('class ReaderApplication : Application()');
    expect(KT).toContain('override fun onCreate()');
    expect(KT).toContain('super.onCreate()');
    expect(KT).toContain('StartupDiagnostics.install(this)');
    // 原文里没有这些字样 —— 端口此前把它们编进了 startupOrder（E167）
    expect(KT).not.toContain('startupOrder');
    expect(KT).not.toContain('bookCache');
    expect(KT).not.toContain('downloads');
  });

  it('端口 onCreate 只转发 install，不再有 startupOrder', () => {
    const app = new ReaderApplication();
    expect(Object.keys(app)).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(app, 'startupOrder')).toBe(false);
    const calls: string[] = [];
    app.onCreate(() => calls.push('install'));
    expect(calls).toEqual(['install']);
  });
});

describe('MangaJaNaiGpu.kt：四个 JNI 入口', () => {
  const KT = kt('ui/comic/MangaJaNaiGpu.kt');

  it('loadLibrary("mangajanai") + create/run/save/destroy 的签名逐字', () => {
    expect(KT).toContain('JNI entry points stay named across R8. All calls use the shared JaNai page lock.');
    expect(KT).toContain('internal object MangaJaNaiGpu');
    expect(KT).toContain('init { System.loadLibrary("mangajanai") }');
    expect(KT).toContain('external fun create(param: String, weights: String, cache: String): Long');
    expect(KT).toContain('external fun run(handle: Long, input: ByteBuffer, output: ByteBuffer, side: Int)');
    expect(KT).toContain('external fun save(handle: Long)');
    expect(KT).toContain('external fun destroy(handle: Long)');
  });

  it('端口四个方法同序同参；`create` 返回 0 表示拿不到句柄', () => {
    const calls: string[] = [];
    const gpu: MangaJaNaiGpuPort = {
      create: (param, weights, cache) => {
        calls.push(`create:${param}:${weights}:${cache}`);
        return 0; // Kotlin：JNI create 失败 → 0
      },
      run: (handle, input, output, side) => {
        calls.push(`run:${String(handle)}:${String(input.length)}:${String(output.length)}:${String(side)}`);
      },
      save: (handle) => calls.push(`save:${String(handle)}`),
      destroy: (handle) => calls.push(`destroy:${String(handle)}`),
    };
    expect(Object.keys(gpu)).toEqual(['create', 'run', 'save', 'destroy']);
    const handle = gpu.create('param.json', 'weights.param', 'c.vkcache');
    expect(handle).toBe(0);
    gpu.run(handle, new Float32Array(3), new Float32Array(3), 16);
    gpu.save(handle);
    gpu.destroy(handle);
    expect(calls).toEqual([
      'create:param.json:weights.param:c.vkcache',
      'run:0:3:3:16',
      'save:0',
      'destroy:0',
    ]);
  });
});

describe('RemoteEndpointConfig.kt：四个字段', () => {
  const KT = kt('source/zlibrary/RemoteEndpointConfig.kt');

  it('url / priority / updatedAt / version，全部必填；`Long` → `number`', () => {
    expect(KT).toContain('data class RemoteEndpointConfig(');
    expect(KT).toContain('val url: String,');
    expect(KT).toContain('val priority: Int,');
    expect(KT).toContain('val updatedAt: Long,');
    expect(KT).toContain('val version: String');
    expect(KT).toContain('去掉 Moshi @JsonClass');
    const config = createRemoteEndpointConfig({
      url: 'https://z-lib.sk',
      priority: 3,
      updatedAt: 1_700_000_000_000,
      version: '1.2.0',
    });
    expect(config).toEqual({
      url: 'https://z-lib.sk',
      priority: 3,
      updatedAt: 1_700_000_000_000,
      version: '1.2.0',
    });
  });
});

describe('ComicChapter.kt：四个默认值', () => {
  const KT = kt('source/ComicChapter.kt');

  it('id/title 必填，volume=null、order=0f、external=false、externalUrl=null', () => {
    expect(KT).toContain('data class ComicChapter(');
    expect(KT).toContain('val id: String,');
    expect(KT).toContain('val title: String,');
    expect(KT).toContain('val volume: String? = null,');
    expect(KT).toContain('val order: Float = 0f,');
    expect(KT).toContain('val external: Boolean = false,');
    expect(KT).toContain('val externalUrl: String? = null');
    expect(createComicChapter({ id: 'c1', title: '第 1 话' })).toEqual({
      id: 'c1',
      title: '第 1 话',
      volume: null,
      order: 0,
      external: false,
      externalUrl: null,
    });
    // 显式值不被默认覆盖（外部章节要带外链）
    expect(
      createComicChapter({
        id: 'c2',
        title: 'Ex',
        volume: 'Vol.2',
        order: 1.5,
        external: true,
        externalUrl: 'https://x/2',
      }),
    ).toMatchObject({ volume: 'Vol.2', order: 1.5, external: true, externalUrl: 'https://x/2' });
  });
});

describe('DownloadInfo.kt：format 默认 epub', () => {
  const KT = kt('source/DownloadInfo.kt');

  it('六个字段：url/fileName 必填，format=epub、size=null、headers 空表、referer=null', () => {
    expect(KT).toContain('@Immutable');
    expect(KT).toContain('data class DownloadInfo(');
    expect(KT).toContain('val url: String,');
    expect(KT).toContain('val fileName: String,');
    expect(KT).toContain('val format: String = "epub",');
    expect(KT).toContain('val size: Long? = null,');
    expect(KT).toContain('val headers: Map<String, String> = emptyMap(),');
    expect(KT).toContain('val referer: String? = null');
    expect(createDownloadInfo({ url: 'https://x/a.epub', fileName: 'a.epub' })).toEqual({
      url: 'https://x/a.epub',
      fileName: 'a.epub',
      format: 'epub',
      size: null,
      headers: {},
      referer: null,
    });
  });
});

describe('DownloadRequest.kt：九个字段', () => {
  const KT = kt('download/DownloadRequest.kt');

  it('六个必填 + coverUrl/novelSnapshot/replaceExistingNovel 三个默认值', () => {
    expect(KT).toContain('data class DownloadRequest(');
    expect(KT).toContain('val bookId: String,');
    expect(KT).toContain('val title: String,');
    expect(KT).toContain('val author: String,');
    expect(KT).toContain('val sourceId: String,');
    expect(KT).toContain('val downloadUrl: String,');
    expect(KT).toContain('val format: String,');
    expect(KT).toContain('val coverUrl: String? = null,');
    expect(KT).toContain('val novelSnapshot: com.example.source.SearchBook? = null,');
    expect(KT).toContain('val replaceExistingNovel: Boolean = false');

    const request: DownloadRequest = {
      bookId: 'b1',
      title: '书名',
      author: '作者',
      sourceId: 'zlibrary',
      downloadUrl: 'https://x/a.epub',
      format: 'epub',
    };
    expect(Object.keys(request)).toHaveLength(6);
    // 三个可空项在 TS 里 optional，Kotlin 里默认 null/false —— 语义等价
    expect(request.coverUrl).toBeUndefined();
    expect(request.replaceExistingNovel).toBeUndefined();
  });
});

describe('LibraryError.kt：八个分支', () => {
  const KT = kt('library/LibraryError.kt');

  it('sealed class : Exception()，五个 object + 三个 data class', () => {
    expect(KT).toContain('sealed class LibraryError : Exception() {');
    expect(KT).toContain('object NetworkUnavailable : LibraryError()');
    expect(KT).toContain('data class NetworkDetail(override val message: String) : LibraryError()');
    expect(KT).toContain('object SourceUnavailable : LibraryError()');
    expect(KT).toContain('object AuthenticationRequired : LibraryError()');
    expect(KT).toContain('object CloudflareBlocked : LibraryError()');
    expect(KT).toContain('object InvalidFile : LibraryError()');
    expect(KT).toContain('data class ParseFailed(override val message: String) : LibraryError()');
    expect(KT).toContain(
      'data class Unknown(override val message: String, val causeException: Throwable? = null) : LibraryError()',
    );
  });

  it('`message` 语义：五个 object 为 null，三个 data class 带原文', () => {
    expect(libraryErrorMessage(LibraryError.NetworkUnavailable)).toBeNull();
    expect(libraryErrorMessage(LibraryError.SourceUnavailable)).toBeNull();
    expect(libraryErrorMessage(LibraryError.AuthenticationRequired)).toBeNull();
    expect(libraryErrorMessage(LibraryError.CloudflareBlocked)).toBeNull();
    expect(libraryErrorMessage(LibraryError.InvalidFile)).toBeNull();
    expect(libraryErrorMessage(LibraryError.NetworkDetail('HTTP 503'))).toBe('HTTP 503');
    expect(libraryErrorMessage(LibraryError.ParseFailed('bad html'))).toBe('bad html');
    expect(libraryErrorMessage(LibraryError.Unknown('boom'))).toBe('boom');
  });

  it('`Unknown` 的 causeException 可空、默认 null', () => {
    const withoutCause = LibraryError.Unknown('x') as { kind: string; causeException: unknown };
    expect(withoutCause.kind).toBe('Unknown');
    expect(withoutCause.causeException).toBeNull();
    const cause = new Error('root');
    const withCause = LibraryError.Unknown('x', cause) as { causeException: unknown };
    expect(withCause.causeException).toBe(cause);
  });

  it('八个分支的 kind 互不相同（= Kotlin 的八个子类）', () => {
    const kinds = [
      LibraryError.NetworkUnavailable,
      LibraryError.NetworkDetail('m'),
      LibraryError.SourceUnavailable,
      LibraryError.AuthenticationRequired,
      LibraryError.CloudflareBlocked,
      LibraryError.InvalidFile,
      LibraryError.ParseFailed('m'),
      LibraryError.Unknown('m'),
    ].map((error) => error.kind);
    expect(kinds).toEqual([
      'NetworkUnavailable',
      'NetworkDetail',
      'SourceUnavailable',
      'AuthenticationRequired',
      'CloudflareBlocked',
      'InvalidFile',
      'ParseFailed',
      'Unknown',
    ]);
    expect(new Set(kinds).size).toBe(8);
  });
});

describe('AppUpdateCleanupReceiver.kt：action 守卫与 finally', () => {
  const KT = kt('data/AppUpdateCleanupReceiver.kt');

  it('action 不匹配直接 return（在 goAsync 之前），因此不调 finish', () => {
    expect(KT).toContain('if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return');
    expect(KT).toContain('val result = goAsync()');
    // 守卫在 goAsync 之前
    expect(KT.indexOf('intent.action != Intent.ACTION_MY_PACKAGE_REPLACED')).toBeLessThan(
      KT.indexOf('val result = goAsync()'),
    );
    expect(PACKAGE_REPLACED_ACTION).toBe('android.intent.action.MY_PACKAGE_REPLACED');
    expect(ACTION_MY_PACKAGE_REPLACED).toBe('android.intent.action.MY_PACKAGE_REPLACED');
  });

  it('不匹配时不清理、不 finish（E168 修正点）', async () => {
    let cleaned = 0;
    let finished = 0;
    const receiver = createAppUpdateCleanupReceiver({
      cleanupInstalled: async () => {
        cleaned += 1;
        return true;
      },
    });
    await receiver.onReceive(null, () => {
      finished += 1;
    });
    await receiver.onReceive('android.intent.action.BOOT_COMPLETED', () => {
      finished += 1;
    });
    expect(cleaned).toBe(0);
    expect(finished).toBe(0);
  });

  it('匹配时清理一次并在 finally 里 finish 一次', async () => {
    expect(KT).toContain('finally { result.finish() }');
    expect(KT).toContain('AppUpdateStore(context.applicationContext).cleanupInstalled()');
    let cleaned = 0;
    let finished = 0;
    const receiver = createAppUpdateCleanupReceiver({
      cleanupInstalled: async () => {
        cleaned += 1;
        return true;
      },
    });
    await receiver.onReceive(ACTION_MY_PACKAGE_REPLACED, () => {
      finished += 1;
    });
    expect(cleaned).toBe(1);
    expect(finished).toBe(1);
  });

  it('清理抛错也被吸收，finish 仍恰好一次（Kotlin `runCatching` + `finally`）', async () => {
    let finished = 0;
    const seen: unknown[] = [];
    const receiver = createAppUpdateCleanupReceiver(
      {
        cleanupInstalled: async () => {
          throw new Error('storage gone');
        },
      },
      (error) => seen.push(error),
    );
    await receiver.onReceive(ACTION_MY_PACKAGE_REPLACED, () => {
      finished += 1;
    });
    expect(finished).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('清理是**分离的**异步任务（Kotlin `Thread { … }.start()`），goAsync 结果不外抛', async () => {
    expect(KT).toContain('Thread {');
    expect(KT).toContain('.start()');
    const receiver = createAppUpdateCleanupReceiver({
      cleanupInstalled: async () => Promise.reject(new Error('x')),
    });
    await expect(
      receiver.onReceive(ACTION_MY_PACKAGE_REPLACED, () => undefined),
    ).resolves.toBeUndefined();
  });
});

describe('SourceResult.kt：map / getOrNull', () => {
  const KT = kt('source/SourceResult.kt');

  it('Success(data) / Error(exception)；`map` 只变换成功分支', () => {
    expect(KT).toContain('sealed class SourceResult<out T> {');
    expect(KT).toContain('data class Success<out T>(val data: T) : SourceResult<T>()');
    expect(KT).toContain('data class Error(val exception: SourceException) : SourceResult<Nothing>()');
    expect(KT).toContain('is Success -> Success(transform(data))');
    expect(KT).toContain('is Error -> Error(exception)');

    const ok = sourceSuccess(2);
    expect(isSuccessSourceResult(ok)).toBe(true);
    const mapped = SourceResult.map(ok, (value) => value * 3);
    expect(SourceResult.getOrNull(mapped)).toBe(6);

    const failure = sourceError(new NetworkError('HTTP 500'));
    expect(isErrorSourceResult(failure)).toBe(true);
    const untouched = SourceResult.map(failure, () => 'never');
    expect(isErrorSourceResult(untouched)).toBe(true);
    expect((untouched as unknown as { exception: NetworkError }).exception.message).toBe('HTTP 500');
    expect(SourceResult.getOrNull(untouched)).toBeNull();
  });

  it('`getOrNull()` 对 object 型错误也返回 null（Kotlin `is Error -> null`）', () => {
    expect(KT).toContain('is Success -> data');
    expect(KT).toContain('is Error -> null');
    expect(SourceResult.getOrNull(sourceError(new BookNotFound()))).toBeNull();
    // getOrNull 对假值数据不改写：0 / '' 原样返回
    expect(SourceResult.getOrNull(sourceSuccess(0))).toBe(0);
    expect(SourceResult.getOrNull(sourceSuccess(''))).toBe('');
  });
});

describe('BookFormat.kt：六个字段', () => {
  const KT = kt('source/BookFormat.kt');

  it('format 必填；其余五个默认 null（eapi 变体键也在）', () => {
    expect(KT).toContain('@Immutable');
    expect(KT).toContain('data class BookFormat(');
    expect(KT).toContain('val format: String,');
    expect(KT).toContain('val downloadUrl: String? = null,');
    expect(KT).toContain('val size: Long? = null,');
    expect(KT).toContain('val sizeText: String? = null,');
    expect(KT).toContain('val eapiId: String? = null,');
    expect(KT).toContain('val eapiHash: String? = null');
    expect(KT).toContain('[downloadUrl] 非空表示该格式已有可直接下载的链接');
    expect(createBookFormat({ format: 'pdf' })).toEqual({
      format: 'pdf',
      downloadUrl: null,
      size: null,
      sizeText: null,
      eapiId: null,
      eapiHash: null,
    });
    expect(
      createBookFormat({ format: 'epub', downloadUrl: '/dl/1', size: 10, sizeText: '10 B', eapiId: '5', eapiHash: 'ab' }),
    ).toMatchObject({ downloadUrl: '/dl/1', size: 10, sizeText: '10 B', eapiId: '5', eapiHash: 'ab' });
  });
});