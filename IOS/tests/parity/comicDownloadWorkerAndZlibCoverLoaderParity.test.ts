/**
 * comicDownloadWorkerAndZlibCoverLoaderParity.test.ts
 *   ├ `library/ComicDownloadWorker.kt`（**66 行 / 63 非空**）+ 它依赖的
 *   │   `download/DownloadWorker.kt:43-60`（两个失败分类器）→ `@core/library/libraryComicDownload`
 *   └ `library/ZLibraryCoverLoader.kt`（66 行 / 61 非空）→ `@core/library/zLibraryCoverLoader`
 *
 * 本轮实测到的偏差（E214）：
 *
 *  ① `ComicDownloadWorker.kt` 的端口自述「64 lines, 47 non-blank」（旧版），行号整体偏 2；
 *     更实质的是 L59 的
 *     `status = if (DownloadWorker.foregroundStartRestricted(e)) PAUSED else FAILED`
 *     整条缺失 —— 端口恒 FAILED。Android 12+ 的「后台启动受限」因此不会被判成可重试的
 *     PAUSED。
 *  ② `DownloadWorker.foregroundStartRestricted` 与 `failureMessage`（两个重载）
 *     **一个都没有移植**，它们的四条文案（后台启动受限，请重试 / 存储空间不足 /
 *     连接中断，请重试 / 下载失败，请重试）也不在 `strings.ts` 里。端口退化成
 *     `e.message ?? '章节下载失败'`，并外加了 Kotlin 没有的「下载失败：」前缀。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ComicDownloadStatus,
  comicDownloadWorkName,
} from '@core/library/libraryComicDownload';
import {
  DOWNLOAD_FAILED_FALLBACK,
  FAILURE_MESSAGE_MAX_CHARS,
  FOREGROUND_RESTRICTED_CAUSE_DEPTH,
  FOREGROUND_RESTRICTED_CLASS,
  FOREGROUND_RESTRICTED_FAILURE,
  FOREGROUND_RESTRICTED_MESSAGE,
  IO_INTERRUPTED_FAILURE,
  STORAGE_FULL_FAILURE,
  failureMessage,
  failureMessageForError,
  failureMessageForText,
  foregroundStartRestricted,
  isIoFailure,
  javaStringHashCode,
} from '@core/download/downloadWorker';
import {
  COVER_LOADER_CONFIG,
  COVER_USER_AGENT,
  ZLibraryCoverLoader,
  buildCoverRequestHeaders,
  createDefaultCoverLoader,
  redactCoverCookieHeader,
  rememberZLibraryImageLoader,
  type CoverLoaderDeps,
} from '@core/library/zLibraryCoverLoader';
import type { HtmlRuntimeCookieStore } from '@core/source/zlibrary/zLibraryWebViewHelper';
import type { ZLibraryNodeConfigPort } from '@core/source/zlibrary/zLibraryHost';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const WORKER_KT = 'library/ComicDownloadWorker.kt';
const DOWNLOAD_WORKER_KT = 'download/DownloadWorker.kt';
const COVER_KT = 'library/ZLibraryCoverLoader.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① ComicDownloadWorker.kt L19-27 getForegroundInfo
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicDownloadWorker.kt L19-27 前台通知', () => {
  const src = kt(WORKER_KT);

  it('L20-21 渠道 id `comic_downloads`、名字过 tr、重要性 LOW、只在 SDK>=26 建', () => {
    expect(src).toContain('if (android.os.Build.VERSION.SDK_INT>=26) applicationContext.getSystemService(NotificationManager::class.java)');
    expect(src).toContain('NotificationChannel("comic_downloads",com.example.i18n.tr("漫画下载"),NotificationManager.IMPORTANCE_LOW)');
  });

  it('L22-23 标题过 tr、`setOngoing(true)`、下载图标', () => {
    expect(src).toContain('.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(com.example.i18n.tr("正在下载漫画章节")).setOngoing(true)');
  });

  it('L24 动作标签 `"暂停"` 是**裸字面量**（同行的渠道名与标题都包了 tr）', () => {
    // 这一行是「哪些串翻译、哪些不翻译」最容易看错的地方
    expect(src).toContain('.addAction(android.R.drawable.ic_menu_close_clear_cancel,"暂停",WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)).build()');
    const line = src.split(/\r?\n/).find((l) => l.includes('ic_menu_close_clear_cancel'));
    expect(line).toBeDefined();
    expect(line).not.toContain('tr("暂停")');
    // 而同一段里另两处都过了 tr
    expect(src).toContain('com.example.i18n.tr("漫画下载")');
    expect(src).toContain('com.example.i18n.tr("正在下载漫画章节")');
  });

  it('L25-26 通知 id = `id.hashCode() and Int.MAX_VALUE`；SDK>=29 才带 FOREGROUND_SERVICE_TYPE_DATA_SYNC', () => {
    expect(src).toContain('return if(android.os.Build.VERSION.SDK_INT>=29) ForegroundInfo(id.hashCode() and Int.MAX_VALUE,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)');
    expect(src).toContain('else ForegroundInfo(id.hashCode() and Int.MAX_VALUE,notification)');
    // `id` 是 `UUID`，其 hashCode 与 UUID 字符串的 String.hashCode **不同** —— 见 E214 的登记
    expect(src).toContain('id.hashCode() and Int.MAX_VALUE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② ComicDownloadWorker.kt L28-65 doWork 的十步
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicDownloadWorker.kt L28-40 入口与早退', () => {
  const src = kt(WORKER_KT);

  it('L28 `doWork():Result=withContext(Dispatchers.IO)`', () => {
    expect(src).toContain('override suspend fun doWork():Result=withContext(Dispatchers.IO) {');
  });

  it('L29 `inputData.getString("task_id") ?: return failure`', () => {
    expect(src).toContain('val key=inputData.getString("task_id") ?: return@withContext Result.failure()');
  });

  it('L30 整个作业在 `DownloadWorker.withTaskLock(key)` 里（与普通下载共用同一把 32 槽锁）', () => {
    expect(src).toContain('DownloadWorker.withTaskLock(key) {');
    // 锁数组在 DownloadWorker.kt 的 companion 里，不在本文件
    const downloadWorker = kt(DOWNLOAD_WORKER_KT);
    expect(downloadWorker).toContain('private val taskLocks = Array(32) { kotlinx.coroutines.sync.Mutex() }');
    expect(downloadWorker).toContain('val lock = taskLocks[(taskId.hashCode() and Int.MAX_VALUE) % taskLocks.size]');
    // 端口：同一个 32 槽 + 同一个 hashCode 掩码
    expect(repoText('src/core/download/downloadWorker.ts')).toContain('const taskLocks: Mutex[] = Array.from({ length: 32 }, () => new Mutex());');
    expect(repoText('src/core/download/downloadWorker.ts')).toContain('(javaStringHashCode(taskId) & 0x7fffffff) % taskLocks.length');
  });

  it('L31-32 任务缺失 → failure；状态不是 DOWNLOADING → **success**（不是失败）', () => {
    expect(src).toContain('val task=ComicDownloadManager.task(applicationContext,key) ?: return@withTaskLock Result.failure()');
    expect(src).toContain('if(task.status!=ComicDownloadStatus.DOWNLOADING) return@withTaskLock Result.success()');
    // 端口用独立的 'skipped' 值表达这一支（runner 侧映射成 success），注释写明对应关系
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain("if (task.status !== ComicDownloadStatus.DOWNLOADING) return 'skipped';");
  });

  it('L38 已经入库过就跳过导入（靠 `dir.absolutePath` 反查 book 行）', () => {
    expect(src).toContain('if(dao.getBookByFilePath(dir.absolutePath)==null) {');
    expect(repoText('src/core/library/libraryComicDownload.ts')).toContain('if ((await this.bookDao.getBookByFilePath(dir)) === null) {');
  });

  it('L39 书源未安装的文案逐字', () => {
    expect(src).toContain('?: error(com.example.i18n.tr("书源未安装，请重新启用该书源后重试"))');
    expect(repoText('src/core/library/libraryComicDownload.ts')).toContain("throw new Error('书源未安装，请重新启用该书源后重试')");
  });

  it('L40-43 `SourceResult.Success` 取 data、`Error` 抛 exception', () => {
    expect(src).toContain('val images=when(val result=source.getChapterImages(task.chapter.id)) {');
    expect(src).toContain('is SourceResult.Success -> result.data');
    expect(src).toContain('is SourceResult.Error -> throw result.exception');
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('if (images.kind === \'error\') throw images.exception;');
  });

  it('L44-47 七个导入参数：headers / targetDir / 两个 resolver / `concurrency=3` / onProgress', () => {
    expect(src).toContain('headers=source.getChapterImageHeaders(task.chapter.id,images),targetDir=dir,');
    expect(src).toContain('resolveImage={ source.resolveChapterImage(it) },resolveHeaders={ source.getResolvedHeaders(it) },concurrency=3,');
    expect(src).toContain('onProgress={ progress -> ComicDownloadManager.update(key,false) { it.copy(progress=progress) } }).getOrThrow()');
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('concurrency: 3,');
    // `update(key, false)` 的第二个实参是 `persist = false`
    expect(ts).toContain('this.update(key, false, (it) => ({ ...it, progress }));');
  });
});

describe('ComicDownloadWorker.kt L49-61 成功与两种失败', () => {
  const src = kt(WORKER_KT);

  it('L49-51 成功写入在 `NonCancellable` 里：SUCCESS / progress=1f / error=null', () => {
    expect(src).toContain('withContext(NonCancellable) {');
    expect(src).toContain('ComicDownloadManager.update(key) { it.copy(status=ComicDownloadStatus.SUCCESS,progress=1f,error=null) }');
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('status: ComicDownloadStatus.SUCCESS,');
    expect(ts).toContain('progress: 1,');
    expect(ts).toContain('error: null,');
  });

  it('L52 成功文案 `已下载到书架：<书名> · <章节名>`（中点 · 而不是顿号/连字符）', () => {
    expect(src).toContain('ComicDownloadManager.message("已下载到书架：${task.book.title} · ${task.chapter.title}")');
    expect(repoText('src/core/library/libraryComicDownload.ts')).toContain(
      'this.setMessage(`已下载到书架：${task.book.title} · ${task.chapter.title}`);',
    );
  });

  it('L55-57 取消 → PAUSED 后**原样抛出**（不能吞，否则 runner 会当成正常结束）', () => {
    expect(src).toContain('} catch(e:CancellationException) {');
    expect(src).toContain('ComicDownloadManager.update(key) { it.copy(status=ComicDownloadStatus.PAUSED) }');
    expect(src).toContain('throw e');
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('status: ComicDownloadStatus.PAUSED }));');
    expect(ts).toContain('throw e;');
  });

  it('L59 `foregroundStartRestricted(e)` 决定 PAUSED 还是 FAILED（此前整条缺失，恒 FAILED）', () => {
    expect(src).toContain('ComicDownloadManager.update(key) { it.copy(status=if(DownloadWorker.foregroundStartRestricted(e)) ComicDownloadStatus.PAUSED else ComicDownloadStatus.FAILED,error=DownloadWorker.failureMessage(e)) }');
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('const restricted = foregroundStartRestricted(e);');
    expect(ts).toContain('status: restricted ? ComicDownloadStatus.PAUSED : ComicDownloadStatus.FAILED,');
    expect(ts).toContain('const message = failureMessage(e);');
    // 反向：不许再出现「恒 FAILED」与自造前缀
    expect(ts).not.toContain('下载失败：${message}');
    expect(ts).not.toContain("'章节下载失败'");
  });

  it('L60 `message(DownloadWorker.failureMessage(e))` —— 直传，不加任何前缀', () => {
    expect(src).toContain('ComicDownloadManager.message(DownloadWorker.failureMessage(e))');
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('this.setMessage(message);');
  });

  it('L65 `companion object { private val slots=Semaphore(2) }`', () => {
    expect(src).toContain('companion object { private val slots=Semaphore(2) }');
    expect(src).toContain('slots.withPermit {');
    // 端口：模块级常量 + 自己的 AsyncSemaphore（`companion object` 是 Kotlin 的进程级单例）
    const ts = repoText('src/core/library/libraryComicDownload.ts');
    expect(ts).toContain('const WORKER_SLOTS = 2;');
    expect(ts).toContain('private readonly workerSlots = new AsyncSemaphore(WORKER_SLOTS);');
  });

  it('端口：`runWorkerForTask` 的三态与 Kotlin 的两种 Result 对应', () => {
    expect(ComicDownloadStatus.DOWNLOADING).toBe('DOWNLOADING');
    expect(ComicDownloadStatus.PAUSED).toBe('PAUSED');
    expect(ComicDownloadStatus.FAILED).toBe('FAILED');
    expect(ComicDownloadStatus.SUCCESS).toBe('SUCCESS');
    // 唯一作业名与 Kotlin `ComicDownloadManager.workName(id)` 同源
    expect(comicDownloadWorkName('abc')).toContain('abc');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ DownloadWorker.kt L43-60 两个失败分类器（此前整段未移植）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L43-47 foregroundStartRestricted', () => {
  const src = kt(DOWNLOAD_WORKER_KT);

  it('L44 `generateSequence(error) { it.cause }.take(8)`', () => {
    expect(src).toContain('generateSequence(error) { it.cause }.take(8).any {');
    expect(FOREGROUND_RESTRICTED_CAUSE_DEPTH).toBe(8);
  });

  it('L45 类名判据**区分大小写**；L46 message 判据**忽略大小写**', () => {
    expect(src).toContain('it.javaClass.simpleName.contains("ForegroundServiceStartNotAllowed") ||');
    expect(src).toContain('it.message.orEmpty().contains("startForegroundService() not allowed",true)');
    expect(FOREGROUND_RESTRICTED_CLASS).toBe('ForegroundServiceStartNotAllowed');
    expect(FOREGROUND_RESTRICTED_MESSAGE).toBe('startForegroundService() not allowed');
  });

  it('顶层就是该类 → true', () => {
    const error = new Error('boom');
    error.name = 'ForegroundServiceStartNotAllowedException';
    expect(foregroundStartRestricted(error)).toBe(true);
  });

  it('只在**第 3 层 cause** 上 → 仍然 true（这正是「必须走 cause 链」的理由）', () => {
    const root = new Error('not allowed to start service');
    root.name = 'ForegroundServiceStartNotAllowedException';
    const wrapped = new Error('upload failed', { cause: new Error('io', { cause: root }) });
    expect(wrapped.message).not.toContain('Foreground');
    expect(foregroundStartRestricted(wrapped)).toBe(true);
  });

  it('message 分支忽略大小写：`startForegroundService() NOT ALLOWED` 也算', () => {
    expect(foregroundStartRestricted(new TypeError('startForegroundService() NOT ALLOWED'))).toBe(true);
    // 类名分支不忽略大小写
    const lower = new Error('x');
    lower.name = 'foregroundservicestartnotallowed';
    expect(foregroundStartRestricted(lower)).toBe(false);
  });

  it('超过 8 层的 cause **不**算（`take(8)` 真的截断）', () => {
    const root = new Error('startForegroundService() not allowed');
    let current: Error = root;
    for (let i = 0; i < 9; i += 1) current = new Error(`layer ${String(i)}`, { cause: current });
    // 链长 10（含 root），前 8 个都碰不到 root
    expect(foregroundStartRestricted(current)).toBe(false);
    // 把 root 抬到第 8 个（7 层包裹）就能命中
    let near: Error = root;
    for (let i = 0; i < 7; i += 1) near = new Error(`layer ${String(i)}`, { cause: near });
    expect(foregroundStartRestricted(near)).toBe(true);
  });

  it('普通错误 / null / 字符串 → false', () => {
    expect(foregroundStartRestricted(new Error('network'))).toBe(false);
    expect(foregroundStartRestricted(null)).toBe(false);
    expect(foregroundStartRestricted(undefined)).toBe(false);
    expect(foregroundStartRestricted('startForegroundService() not allowed')).toBe(false);
  });
});

describe('DownloadWorker.kt L49-53 failureMessage(message: String)', () => {
  const src = kt(DOWNLOAD_WORKER_KT);

  it('三支分支与文案逐字', () => {
    expect(src).toContain('message.contains("startForegroundService() not allowed",true) || message.contains("ForegroundServiceStartNotAllowed") -> "后台启动受限，请重试"');
    expect(src).toContain('message.contains("ENOSPC",true) -> "存储空间不足"');
    expect(src).toContain('else -> message.lineSequence().firstOrNull()?.take(120)?.ifBlank { null } ?: "下载失败，请重试"');
    expect(FOREGROUND_RESTRICTED_FAILURE).toBe('后台启动受限，请重试');
    expect(STORAGE_FULL_FAILURE).toBe('存储空间不足');
    expect(DOWNLOAD_FAILED_FALLBACK).toBe('下载失败，请重试');
  });

  it('分类行为：两条前台受限判据 / ENOSPC 忽略大小写', () => {
    expect(failureMessageForText('startForegroundService() not allowed')).toBe(FOREGROUND_RESTRICTED_FAILURE);
    expect(failureMessageForText('开始失败：STARTFOREGROUNDSERVICE() NOT ALLOWED')).toBe(FOREGROUND_RESTRICTED_FAILURE);
    expect(failureMessageForText('x ForegroundServiceStartNotAllowed y')).toBe(FOREGROUND_RESTRICTED_FAILURE);
    expect(failureMessageForText('write failed: enospc')).toBe(STORAGE_FULL_FAILURE);
    expect(failureMessageForText('ENOSPC')).toBe(STORAGE_FULL_FAILURE);
    // 类名那半段区分大小写
    expect(failureMessageForText('foregroundservicestartnotallowed')).toBe('foregroundservicestartnotallowed');
  });

  it('只取**首行**、最多 120 字符、首行空白回落兜底', () => {
    expect(failureMessageForText('第一行\n第二行')).toBe('第一行');
    expect(failureMessageForText('a\r\nb')).toBe('a');
    expect(failureMessageForText('a\rb')).toBe('a');
    const long = 'x'.repeat(200);
    expect(failureMessageForText(long)).toHaveLength(FAILURE_MESSAGE_MAX_CHARS);
    expect(failureMessageForText(long)).toBe('x'.repeat(120));
    expect(failureMessageForText('')).toBe(DOWNLOAD_FAILED_FALLBACK);
    expect(failureMessageForText('   \n第二行')).toBe(DOWNLOAD_FAILED_FALLBACK);
  });

  it('恰好 120 字符不截断（`take(120)` 含边界）', () => {
    expect(failureMessageForText('y'.repeat(120))).toBe('y'.repeat(120));
  });
});

describe('DownloadWorker.kt L55-60 failureMessage(error: Throwable)', () => {
  const src = kt(DOWNLOAD_WORKER_KT);

  it('四支分支与文案逐字，顺序即语义', () => {
    expect(src).toContain('foregroundStartRestricted(error) -> "后台启动受限，请重试"');
    expect(src).toContain('error.message.orEmpty().contains("ENOSPC",true) -> "存储空间不足"');
    expect(src).toContain('error is java.io.IOException -> "连接中断，请重试"');
    expect(src).toContain('else -> failureMessage(error.message.orEmpty())');
    expect(IO_INTERRUPTED_FAILURE).toBe('连接中断，请重试');
  });

  it('前台受限优先于 IOException（一个 IOException 带受限文案也给「后台启动受限」）', () => {
    const error = new Error('startForegroundService() not allowed');
    error.name = 'IOException';
    expect(failureMessageForError(error)).toBe(FOREGROUND_RESTRICTED_FAILURE);
  });

  it('IOException → 连接中断；message 为空的 IOException 也**不**落兜底', () => {
    const io = new Error('socket closed');
    io.name = 'IOException';
    expect(failureMessageForError(io)).toBe(IO_INTERRUPTED_FAILURE);
    const empty = new Error('');
    empty.name = 'IOException';
    expect(failureMessageForError(empty)).toBe(IO_INTERRUPTED_FAILURE);
    // 带 `ioError: true` 标记的普通 Error 同样算
    expect(failureMessageForError({ message: 'reset', ioError: true })).toBe(IO_INTERRUPTED_FAILURE);
  });

  it('ENOSPC 优先于 IOException', () => {
    const error = new Error('No space left (ENOSPC)');
    error.name = 'IOException';
    expect(failureMessageForError(error)).toBe(STORAGE_FULL_FAILURE);
  });

  it('其余落到文本重载（首行 / 120 / 兜底）', () => {
    expect(failureMessageForError(new Error('第三章失败\n堆栈'))).toBe('第三章失败');
    expect(failureMessageForError(new Error(''))).toBe(DOWNLOAD_FAILED_FALLBACK);
    expect(failureMessageForError(new Error('   '))).toBe(DOWNLOAD_FAILED_FALLBACK);
    expect(failureMessageForError(null)).toBe(DOWNLOAD_FAILED_FALLBACK);
    expect(failureMessageForError(undefined)).toBe(DOWNLOAD_FAILED_FALLBACK);
    // 非字符串 message 当空串（Kotlin `message.orEmpty()`）
    expect(failureMessageForError({ message: 42 })).toBe(DOWNLOAD_FAILED_FALLBACK);
  });

  it('单入口 `failureMessage` 按 `typeof` 分派两个 Kotlin 重载', () => {
    expect(failureMessage('ENOSPC')).toBe(STORAGE_FULL_FAILURE);
    expect(failureMessage(new Error('ENOSPC'))).toBe(STORAGE_FULL_FAILURE);
    const io = new Error('boom');
    io.name = 'IOException';
    expect(failureMessage(io)).toBe(IO_INTERRUPTED_FAILURE);
    // 传字符串时**不会**走 IOException 分支
    expect(failureMessage('boom')).toBe('boom');
  });

  it('`isIoFailure` 是显式标记（JS 没有 IOException 类型，见 E214）', () => {
    expect(isIoFailure(new Error('x'))).toBe(false);
    expect(isIoFailure({ ioError: true })).toBe(true);
    const io = new Error('x');
    io.name = 'IOException';
    expect(isIoFailure(io)).toBe(true);
    expect(isIoFailure(null)).toBe(false);
    expect(isIoFailure('IOException')).toBe(false);
  });

  it('四条文案的「译 / 不译」与 Kotlin 的 Strings.kt **完全一致**：只有 `存储空间不足` 在词表里', () => {
    const kotlinStrings = kt('i18n/Strings.kt');
    const iosStrings = readFileSync(path.resolve(process.cwd(), 'src/core/i18n/strings.ts'), 'utf8');
    // 唯一进了词表的一条（Kotlin 那边是因为 `ComicParser.kt` 用 `tr("存储空间不足")`）
    expect(kotlinStrings).toContain('"存储空间不足" to');
    expect(iosStrings).toContain('["存储空间不足",');
    /*
     * 另外三条在 Kotlin 的 `DownloadWorker.kt` 里是**裸字面量**（没有包 `tr(...)`），
     * 所以 `Strings.kt` 里也没有它们 —— 端口同样不许把它们塞进词表，否则英文界面下
     * 这几条会变成翻译串，而 Android 永远是中文。
     */
    for (const bare of [FOREGROUND_RESTRICTED_FAILURE, IO_INTERRUPTED_FAILURE, DOWNLOAD_FAILED_FALLBACK]) {
      expect(kotlinStrings).not.toContain(`"${bare}" to`);
      expect(iosStrings).not.toContain(`["${bare}",`);
    }
    // 反向确认这三条确实在 DownloadWorker.kt 里以裸字面量出现
    const downloadWorker = kt(DOWNLOAD_WORKER_KT);
    expect(downloadWorker).toContain(`"${FOREGROUND_RESTRICTED_FAILURE}"`);
    expect(downloadWorker).toContain(`"${IO_INTERRUPTED_FAILURE}"`);
    expect(downloadWorker).toContain(`"${DOWNLOAD_FAILED_FALLBACK}"`);
  });

  it('`javaStringHashCode` 与 JVM 逐位一致（32 槽锁靠它）', () => {
    expect(javaStringHashCode('')).toBe(0);
    expect(javaStringHashCode('a')).toBe(97);
    expect(javaStringHashCode('~~~')).toBe((126 * 31 * 31 + 126 * 31 + 126) | 0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ ZLibraryCoverLoader.kt L12-59 loader 构建
   ══════════════════════════════════════════════════════════════════════════════ */

const cookieStore = (values: Readonly<Record<string, string>>): HtmlRuntimeCookieStore => ({
  setAcceptCookie: () => undefined,
  setAcceptThirdPartyCookies: () => undefined,
  setCookie: () => undefined,
  flush: () => undefined,
  getCookie: (url: string) => values[url] ?? null,
});

const nodeConfig = (domain = 'z-lib.sk'): ZLibraryNodeConfigPort => ({
  nodeDomain: () => domain,
  setNodeDomain: () => undefined,
});

describe('ZLibraryCoverLoader.kt L12-31 单例与客户端配置', () => {
  const src = kt(COVER_KT);

  it('L12-16 KDoc 逐字（为什么必须走和书库同一条网络路径）', () => {
    expect(src).toContain('封面专用图片加载器：走与书库相同的网络路径（DoH 防污染 DNS + 系统代理），');
    expect(src).toContain('否则 covers.1lib.sk 在部分网络下无法加载。');
    expect(src).toContain('全局单例复用，避免每次进入书库都重建 OkHttpClient / Coil。');
  });

  it('L18-19 `@Volatile private var cachedLoader: ImageLoader? = null`', () => {
    expect(src).toContain('@Volatile');
    expect(src).toContain('private var cachedLoader: ImageLoader? = null');
  });

  it('L21-25 双检锁：`cachedLoader ?: synchronized(this) { cachedLoader ?: build().also { … } }`', () => {
    expect(src).toContain('return cachedLoader ?: synchronized(this) {');
    expect(src).toContain('cachedLoader ?: buildLoader(context.applicationContext).also { cachedLoader = it }');
  });

  it('L28-31 `SharedHttpTransport.builder().dns(ZLibraryDns.INSTANCE)` + 10 s / 15 s', () => {
    expect(src).toContain('val clientBuilder = com.example.source.SharedHttpTransport.builder()');
    expect(src).toContain('.dns(ZLibraryDns.INSTANCE)');
    expect(src).toContain('.connectTimeout(10, TimeUnit.SECONDS)');
    expect(src).toContain('.readTimeout(15, TimeUnit.SECONDS)');
    expect(COVER_LOADER_CONFIG).toEqual({ connectTimeoutMs: 10_000, readTimeoutMs: 15_000, useZLibraryDns: true });
  });

  it('L55-58 `.okHttpClient(…).crossfade(true)`', () => {
    expect(src).toContain('.crossfade(true)');
    expect(src).toContain('return ImageLoader.Builder(context)');
    const deps: CoverLoaderDeps = { cookies: cookieStore({}), proxyProvider: null, nodeConfig: nodeConfig() };
    expect(ZLibraryCoverLoader.get(deps).crossfade).toBe(true);
    expect(ZLibraryCoverLoader.get(deps).config).toBe(COVER_LOADER_CONFIG);
  });
});

describe('ZLibraryCoverLoader.kt L33-53 封面请求头拦截器', () => {
  const src = kt(COVER_KT);

  it('L32 注释逐字（浏览器身份 / 防盗链 Referer / 会话 Cookie）', () => {
    expect(src).toContain('// 封面 CDN 可能需要浏览器身份/防盗链 Referer/会话 Cookie');
  });

  it('L36-38 读**两个** cookie：封面 URL 的 + 节点域名的', () => {
    expect(src).toContain('val cookie = CookieManager.getInstance().getCookie(url) ?: ""');
    expect(src).toContain('val nodeCookie = CookieManager.getInstance()');
    expect(src).toContain('.getCookie("https://${ZLibraryNodeConfig.domain}/") ?: ""');
  });

  it('L39-41 `listOf(cookie, nodeCookie).filter { it.isNotBlank() }.joinToString("; ")`', () => {
    expect(src).toContain('val combinedCookie = listOf(cookie, nodeCookie)');
    expect(src).toContain('.filter { it.isNotBlank() }');
    expect(src).toContain('.joinToString("; ")');
    const headers = buildCoverRequestHeaders({
      url: 'https://covers.1lib.sk/x.jpg',
      cookie: 'a=1',
      nodeCookie: 'remix_userkey=k',
      nodeDomain: 'z-lib.sk',
    });
    expect(headers['Cookie']).toBe('a=1; remix_userkey=k');
    // 只有一个非空 → 不带多余的分号
    expect(
      buildCoverRequestHeaders({ url: 'u', cookie: '', nodeCookie: 'b=2', nodeDomain: 'd' })['Cookie'],
    ).toBe('b=2');
    expect(
      buildCoverRequestHeaders({ url: 'u', cookie: 'b=2', nodeCookie: '   ', nodeDomain: 'd' })['Cookie'],
    ).toBe('b=2');
  });

  it('两个都空 → **不设** Cookie 头（`if (combinedCookie.isNotBlank())`）', () => {
    expect(src).toContain('if (combinedCookie.isNotBlank()) {');
    expect(src).toContain('builder.header("Cookie", combinedCookie)');
    const headers = buildCoverRequestHeaders({ url: 'u', cookie: '', nodeCookie: null, nodeDomain: 'd' });
    expect(headers).not.toHaveProperty('Cookie');
    expect(Object.keys(headers)).toEqual(['User-Agent', 'Referer']);
  });

  it('L43-47 User-Agent 是两段拼接的**完整**浏览器串', () => {
    expect(src).toContain('"Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 " +');
    expect(src).toContain('"(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"');
    expect(COVER_USER_AGENT).toBe(
      'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    );
    // 拼接处那个**尾随空格**丢了就会变成 `537.36(KHTML`
    expect(COVER_USER_AGENT).toContain('537.36 (KHTML');
    expect(COVER_USER_AGENT).not.toContain('537.36(KHTML');
  });

  it('L48 Referer 是 `https://<节点域名>/`（结尾带斜杠）', () => {
    expect(src).toContain('.header("Referer", "https://${ZLibraryNodeConfig.domain}/")');
    const headers = buildCoverRequestHeaders({ url: 'u', cookie: '', nodeCookie: '', nodeDomain: 'z-lib.sk' });
    expect(headers['Referer']).toBe('https://z-lib.sk/');
  });

  it('端口：`headersFor(url)` 用**当前**节点域名拼两处（域名是运行期读的）', () => {
    const deps: CoverLoaderDeps = {
      cookies: cookieStore({
        'https://covers.1lib.sk/a.jpg': 'cdn=1',
        'https://z-lib.sk/': 'node=2',
      }),
      proxyProvider: null,
      nodeConfig: nodeConfig('z-lib.sk'),
    };
    ZLibraryCoverLoader.reset();
    const loader = ZLibraryCoverLoader.get(deps);
    ZLibraryCoverLoader.reset();
    expect(loader.headersFor('https://covers.1lib.sk/a.jpg')).toEqual({
      'User-Agent': COVER_USER_AGENT,
      Referer: 'https://z-lib.sk/',
      Cookie: 'cdn=1; node=2',
    });
  });

  it('L54 `SystemProxyResolver.resolve(context)?.let { clientBuilder.proxy(it) }`', () => {
    expect(src).toContain('SystemProxyResolver.resolve(context)?.let { clientBuilder.proxy(it) }');
    const deps: CoverLoaderDeps = { cookies: cookieStore({}), proxyProvider: null, nodeConfig: nodeConfig() };
    ZLibraryCoverLoader.reset();
    expect(ZLibraryCoverLoader.get(deps).proxy).toBeNull();
    ZLibraryCoverLoader.reset();
  });
});

describe('ZLibraryCoverLoader.kt L63-65 与单例语义', () => {
  const src = kt(COVER_KT);

  it('L62-65 `@Composable fun rememberZLibraryImageLoader(context)` 的注释与签名', () => {
    expect(src).toContain('/** 保持原有调用签名：返回全局复用的封面加载器。 */');
    expect(src).toContain('fun rememberZLibraryImageLoader(context: Context): ImageLoader {');
    expect(src).toContain('return ZLibraryCoverLoader.get(context)');
    // 端口保留同名函数（Composable 只是 UI 概念）
    const deps: CoverLoaderDeps = { cookies: cookieStore({}), proxyProvider: null, nodeConfig: nodeConfig() };
    ZLibraryCoverLoader.reset();
    expect(rememberZLibraryImageLoader(deps)).toBe(ZLibraryCoverLoader.get(deps));
    ZLibraryCoverLoader.reset();
  });

  it('全局单例：第二次 `get` 传不同 deps 也返回**同一个** loader', () => {
    ZLibraryCoverLoader.reset();
    const first = ZLibraryCoverLoader.get({
      cookies: cookieStore({ 'https://z-lib.sk/': 'node=1' }),
      proxyProvider: null,
      nodeConfig: nodeConfig('z-lib.sk'),
    });
    const second = ZLibraryCoverLoader.get({
      cookies: cookieStore({ 'https://z-lib.sk/': 'node=2' }),
      proxyProvider: null,
      nodeConfig: nodeConfig('other.host'),
    });
    expect(second).toBe(first);
    // 因此 headers 仍用**第一次**那套 deps（`cachedLoader` 一旦建好就不再换）
    expect(first.headersFor('u')['Referer']).toBe('https://z-lib.sk/');
    expect(ZLibraryCoverLoader.peek()).toBe(first);
    ZLibraryCoverLoader.reset();
    expect(ZLibraryCoverLoader.peek()).toBeNull();
  });

  it('`createDefaultCoverLoader` 走真实节点配置且默认无代理', () => {
    ZLibraryCoverLoader.reset();
    const loader = createDefaultCoverLoader(cookieStore({}));
    expect(loader.proxy).toBeNull();
    expect(loader.crossfade).toBe(true);
    ZLibraryCoverLoader.reset();
  });

  it('`redactCoverCookieHeader` 是端口 ADDITION：只保留键名', () => {
    expect(redactCoverCookieHeader('remix_userkey=abc; node=2')).toBe('remix_userkey=[redacted]; node=[redacted]');
    expect(redactCoverCookieHeader('  ')).toBe('');
    // 没有 `=` 的片段原样保留
    expect(redactCoverCookieHeader('flag; a=1')).toBe('flag; a=[redacted]');
  });

  it('`describeHeadersFor` 把 Cookie 脱敏、其余头不动', () => {
    ZLibraryCoverLoader.reset();
    const loader = ZLibraryCoverLoader.get({
      cookies: cookieStore({ 'https://z-lib.sk/': 'node=secret' }),
      proxyProvider: null,
      nodeConfig: nodeConfig('z-lib.sk'),
    });
    const described = loader.describeHeadersFor('u');
    expect(described['Cookie']).toBe('node=[redacted]');
    expect(described['Referer']).toBe('https://z-lib.sk/');
    expect(described['User-Agent']).toBe(COVER_USER_AGENT);
    ZLibraryCoverLoader.reset();
  });
});
