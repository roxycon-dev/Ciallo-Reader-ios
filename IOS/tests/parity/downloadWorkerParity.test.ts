/**
 * downloadWorkerParity.test.ts —— `download/DownloadWorker.kt`（**484 行 / 468 非空**）。
 *
 * 本轮（第 74 轮）实测到的偏差（E216）：
 *
 *  ① `Result.retry()` 这一档在端口里**不存在**（`DownloadWorkerResult` 只有 success/failure/skipped），
 *     而 Kotlin L362 / L371 两处都返回它 —— 任何网络抖动都被写成 `FAILED` 永久失败。
 *  ② `shouldRetryPublicNovel`（L61-67）**从未移植**，`PublicNovelSources.ids`（L29）也没移植。
 *  ③ 六码 `408/429/500/502/503/504`（L203-204）在 Kotlin 抛 `IOException("网络暂时不可用")` → 重试；
 *     端口并进「下载失败（HTTP n）」的普通 Error → 直接失败。
 *  ④ L262 的 `if (total > 0 && downloaded != total)` 被写成 `downloaded !== total` —— 服务器不给
 *     `Content-Length` 时（`contentLength()` 为 -1）**恒真**，任何分块响应都判「下载不完整」；
 *     且抛的是普通 Error 而非 `EOFException`（IOException 子类），于是不走重试。
 *  ⑤ zlibrary 的 `DEFAULT_USER_AGENT` / `Accept` / `Accept-Language`（L177-183）三头全缺。
 *  ⑥ `allowSession` 缺子域放行（L189-190），且缺 `syncFromRawCookieString` 回灌。
 *  ⑦ L205-208 的 401/403 两支被压成一支（缺 `WholeBookNovelSources` 分支）。
 *
 * 仍未闭环的三处（已在 E216 末尾逐条列出，下一轮补齐，因此本文件**不给** `DownloadWorker.kt` 报 PORTED）：
 *   - L212-216 `zLibraryDownloadPageError(peekBody(32 * 1024).string())` —— 需要 `HttpResponse.peek`；
 *   - L191-192 `EncryptedCookieJar.syncFromRawCookieString(cookie, host)` —— 需要 `deps.cookieJar`；
 *   - L455-473 `verifyGuestNovel` —— 需要 `GuestNovelIntegrity.epub` 的 titles + `AutoNovelSource.getChapters`。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CDN_HOST_MARKERS,
  DOWNLOAD_FAILED_FALLBACK,
  FAILURE_MESSAGE_MAX_CHARS,
  IO_INTERRUPTED_FAILURE,
  NETWORK_ERROR_CLASS,
  PUBLIC_NOVEL_RETRY_LIMIT,
  RETRYABLE_HTTP_STATUSES,
  STORAGE_FULL_FAILURE,
  eofError,
  failureMessage,
  foregroundStartRestricted,
  ioError,
  isHtmlError,
  isIoFailure,
  javaStringHashCode,
  joinPath,
  nameWithoutExtension,
  shouldRetryPublicNovel,
  stripSensitiveHeadersOnCrossHost,
} from '@core/download/downloadWorker';
import { PUBLIC_NOVEL_SOURCE_IDS, ZLIBRARY_QUOTA_MARKERS, ZLIBRARY_QUOTA_MESSAGE, zLibraryDownloadPageError } from '@core/source/sourceText';
import { DEFAULT_ACCEPT, DEFAULT_ACCEPT_LANG, DEFAULT_USER_AGENT } from '@core/source/zlibrary/network/zLibraryHttpClient';
import type { HttpResponse } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const KT = 'download/DownloadWorker.kt';
const TS = 'src/core/download/downloadWorker.ts';

/** 只看非注释行 —— 负断言必须避开自己写的说明（已踩过多次假阳性）。 */
function codeOnly(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① DownloadWorker.kt L38-74 companion：四个常量 + 两个分类器 + 锁
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L38-74 companion', () => {
  const src = kt(KT);

  it('L39-41 `Semaphore(2)` / 32 槽 `taskLocks` / `CHANNEL = "book_downloads"`', () => {
    expect(src).toContain('private val slots = Semaphore(2)');
    expect(src).toContain('private val taskLocks = Array(32) { kotlinx.coroutines.sync.Mutex() }');
    expect(src).toContain('private const val CHANNEL = "book_downloads"');
    const ts = repoText(TS);
    expect(ts).toContain('const slots = new Semaphore(2);');
    expect(ts).toContain('const taskLocks: Mutex[] = Array.from({ length: 32 }, () => new Mutex());');
  });

  it('L70 `taskLocks[(taskId.hashCode() and Int.MAX_VALUE) % size]` —— 端口同掩码', () => {
    expect(src).toContain('val lock = taskLocks[(taskId.hashCode() and Int.MAX_VALUE) % taskLocks.size]');
    expect(repoText(TS)).toContain('(javaStringHashCode(taskId) & 0x7fffffff) % taskLocks.length');
    // `and Int.MAX_VALUE` = 清掉符号位；JS 用 `& 0x7fffffff`
    expect(javaStringHashCode('download_42') & 0x7fffffff).toBeGreaterThanOrEqual(0);
    expect((javaStringHashCode('~~~') | 0) & 0x7fffffff).toBe((126 * 31 * 31 + 126 * 31 + 126) & 0x7fffffff);
  });

  it('L61-67 `shouldRetryPublicNovel` 四条判据逐字', () => {
    expect(src).toContain('internal fun shouldRetryPublicNovel(sourceId: String, error: Exception, attempt: Int): Boolean {');
    expect(src).toContain('if (sourceId !in com.example.source.impl.PublicNovelSources.ids || attempt >= 5) return false');
    expect(src).toContain('if (error.message?.contains("ENOSPC", true) == true) return false');
    expect(src).toContain('return error is java.io.IOException && error !is java.io.FileNotFoundException ||');
    expect(src).toContain('error is com.example.source.SourceException.NetworkError &&');
    expect(src).toContain('(error.cause is java.io.IOException || Regex("HTTP (?:408|429|5[0-9]{2})\\\\b").containsMatchIn(error.message.orEmpty()))');
    expect(PUBLIC_NOVEL_RETRY_LIMIT).toBe(5);
  });

  it('L29 `PublicNovelSources.ids` 是**四个**源，不是 9 个 `WholeBookNovelSources`', () => {
    const publicNovel = kt('source/impl/PublicNovelSource.kt');
    expect(publicNovel).toContain('val ids = setOf("quanben", "ihuaben", "sfacg", "fanqie")');
    expect([...PUBLIC_NOVEL_SOURCE_IDS].sort()).toEqual(['fanqie', 'ihuaben', 'quanben', 'sfacg']);
    // 与 9 个整本源不同：多了 auto_novel / wenku8_library / ixdzs8 / xbookcn / alicesw
    expect(PUBLIC_NOVEL_SOURCE_IDS.has('auto_novel')).toBe(false);
    expect(PUBLIC_NOVEL_SOURCE_IDS.has('ixdzs8')).toBe(false);
  });
});

describe('shouldRetryPublicNovel 的六种输入', () => {
  it('非公共小说源 → false（哪怕错误可重试）', () => {
    expect(shouldRetryPublicNovel('zlibrary', ioError('socket reset'), 0)).toBe(false);
    expect(shouldRetryPublicNovel('auto_novel', ioError('socket reset'), 0)).toBe(false);
    expect(shouldRetryPublicNovel('quanben', ioError('socket reset'), 0)).toBe(true);
  });

  it('attempt >= 5 → false（L62 的第二个条件）', () => {
    expect(shouldRetryPublicNovel('quanben', ioError('x'), 4)).toBe(true);
    expect(shouldRetryPublicNovel('quanben', ioError('x'), 5)).toBe(false);
    expect(shouldRetryPublicNovel('quanben', ioError('x'), 9)).toBe(false);
  });

  it('ENOSPC 一律不重试（L63）—— 哪怕它是 IOException', () => {
    expect(shouldRetryPublicNovel('quanben', ioError('write failed: ENOSPC'), 0)).toBe(false);
    expect(shouldRetryPublicNovel('quanben', ioError('enospc'), 0)).toBe(false);
  });

  it('IOException 且非 FileNotFoundException → true；FileNotFoundException → false', () => {
    expect(shouldRetryPublicNovel('sfacg', ioError('connection reset'), 0)).toBe(true);
    const notFound = ioError('no such file');
    notFound.name = 'FileNotFoundException';
    expect(shouldRetryPublicNovel('sfacg', notFound, 0)).toBe(false);
    // 普通 Error 既不是 IOException 也不是 NetworkError
    expect(shouldRetryPublicNovel('sfacg', new Error('boom'), 0)).toBe(false);
  });

  it('NetworkError 需要 IO cause 或 408/429/5xx 才重试（L65-66）', () => {
    const network = (message: string, cause?: unknown): Error => {
      const error = new Error(message);
      error.name = NETWORK_ERROR_CLASS;
      if (cause !== undefined) (error as { cause?: unknown }).cause = cause;
      return error;
    };
    expect(shouldRetryPublicNovel('fanqie', network('HTTP 502'), 0)).toBe(true);
    expect(shouldRetryPublicNovel('fanqie', network('HTTP 408'), 0)).toBe(true);
    expect(shouldRetryPublicNovel('fanqie', network('HTTP 429'), 0)).toBe(true);
    expect(shouldRetryPublicNovel('fanqie', network('HTTP 503'), 0)).toBe(true);
    expect(shouldRetryPublicNovel('fanqie', network('HTTP 404'), 0)).toBe(false);
    expect(shouldRetryPublicNovel('fanqie', network('HTTP 403'), 0)).toBe(false);
    // 有 IO cause 就重试，与 message 无关
    expect(shouldRetryPublicNovel('fanqie', network('whatever', ioError('reset')), 0)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② DownloadWorker.kt L90-107 getForegroundInfo / doWork
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L90-107 前台通知与入口', () => {
  const src = kt(KT);

  it('L92-93 渠道名与标题都是**裸字面量**（同文件里没有一处 tr）', () => {
    expect(src).toContain('NotificationChannel(CHANNEL, "书籍下载", NotificationManager.IMPORTANCE_LOW)');
    expect(src).toContain('.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("正在下载书籍")');
    // 整个 companion + getForegroundInfo 段落里 `tr(` 只在 L141/151/163/209/220/225/227/231/248 出现，
    // 通知相关的三处（渠道名/标题/缺省标题）都不翻译 —— 英文界面下仍是中文，与 Android 一致
    const head = src.split('override suspend fun doWork')[0] ?? '';
    expect(head).not.toContain('tr(');
  });

  it('L97 缺省标题是 `"书籍下载"`，L98 `setProgress(0, 0, true)`', () => {
    expect(src).toContain('.setContentText(inputData.getString("title") ?: "书籍下载").setOngoing(true)');
    expect(src).toContain('.setProgress(0, 0, true).build()');
  });

  it('L99-101 通知 id = `id.hashCode() and Int.MAX_VALUE`；SDK29 才带 DATA_SYNC', () => {
    expect(src).toContain('val notificationId = id.hashCode() and Int.MAX_VALUE');
    expect(src).toContain('return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)');
    expect(src).toContain('else ForegroundInfo(notificationId, notification)');
  });

  it('L105 `inputData.getString("book_id") ?: Result.failure()`，L106 `withTaskLock(taskId) { performTask() }`', () => {
    expect(src).toContain('val taskId = inputData.getString("book_id") ?: return@withContext Result.failure()');
    expect(src).toContain('withTaskLock(taskId) { performTask() }');
  });

  it('L104 / L109 两层都是 `withContext(Dispatchers.IO)`', () => {
    expect(src).toContain('override suspend fun doWork(): Result = withContext(Dispatchers.IO) {');
    expect(src).toContain('private suspend fun performTask(recoveries: Int = 0, failedNodes: Set<String> = emptySet()): Result = withContext(Dispatchers.IO) {');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ DownloadWorker.kt L109-129 前置七步
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L109-129 前置校验', () => {
  const src = kt(KT);

  it('L114 PAUSED / CANCELLED → **success**（不是 failure）', () => {
    expect(src).toContain('if (task.status == DownloadStatus.PAUSED || task.status == DownloadStatus.CANCELLED) return@withContext Result.success()');
    // 端口用独立的 'skipped' 表达这一支（平台任务层映射成 success）
    expect(repoText(TS)).toContain("if (task.status === 'PAUSED' || task.status === 'CANCELLED') return 'skipped';");
  });

  it('L115 downloads 目录 = `File(context.filesDir, "downloads")` + mkdirs', () => {
    expect(src).toContain('val downloads = File(context.filesDir, "downloads").apply { mkdirs() }');
    expect(repoText(TS)).toContain('const downloadsDir = deps.downloadsDir;');
  });

  it('L116-117 格式先 lowercase + trim，再 `[a-z0-9]{1,10}`', () => {
    expect(src).toContain('val format = task.format.lowercase().trim()');
    expect(src).toContain('if (!format.matches(Regex("[a-z0-9]{1,10}"))) return@withContext Result.failure()');
    const ts = repoText(TS);
    expect(ts).toContain('const format = task.format.toLowerCase().trim();');
    expect(ts).toContain('if (!/^[a-z0-9]{1,10}$/.test(format)) return \'failure\';');
  });

  it('L118-119 `finalFile.canonicalFile.parentFile != downloads.canonicalFile` → failure', () => {
    expect(src).toContain('val finalFile = File(task.filePath)');
    expect(src).toContain('if (finalFile.canonicalFile.parentFile != downloads.canonicalFile) return@withContext Result.failure()');
    const ts = repoText(TS);
    expect(ts).toContain('const parent = finalFile.replace(/\\\\/g, \'/\').split(\'/\').slice(0, -1).join(\'/\');');
    expect(ts).toContain('if (parent !== downloadsNorm) return \'failure\';');
  });

  it('L120-121 temp / resume 同目录同名、只换扩展名', () => {
    expect(src).toContain('val temp = File(downloads, "${finalFile.nameWithoutExtension}.tmp")');
    expect(src).toContain('val resume = File(downloads, "${finalFile.nameWithoutExtension}.resume")');
    expect(nameWithoutExtension('/d/book.epub')).toBe('book');
    expect(joinPath('/d', 'book.tmp')).toBe('/d/book.tmp');
    expect(repoText(TS)).toContain('`${nameWithoutExtension(finalFile)}.tmp`');
    expect(repoText(TS)).toContain('`${nameWithoutExtension(finalFile)}.resume`');
  });

  it('L124-128 已存的 `download:` 头优先，旧 inputData 只补**缺的**两个键', () => {
    expect(src).toContain('val savedHeaders=secrets.read("download:$taskId")?.let { JSONObject(it) } ?: JSONObject()');
    expect(src).toContain('inputData.getString("referer")?.takeIf { it.isNotBlank() }?.let { if(!savedHeaders.has("Referer")) savedHeaders.put("Referer",it) }');
    expect(src).toContain('inputData.getString("cookie")?.takeIf { it.isNotBlank() }?.let { if(!savedHeaders.has("Cookie")) savedHeaders.put("Cookie",it) }');
    const ts = repoText(TS);
    expect(ts).toContain("if (referer != null && referer.trim() !== '' && !('Referer' in savedHeaders)) {");
    expect(ts).toContain("if (cookieLegacy != null && cookieLegacy.trim() !== '' && !('Cookie' in savedHeaders)) {");
  });

  it('L133-134 公共小说源按 `maxOf(temp.length(), downloadedBytes)` 记进度', () => {
    expect(src).toContain('if (task.sourceId in com.example.source.impl.PublicNovelSources.ids) maxOf(temp.length(), task.downloadedBytes) else temp.length()');
    const ts = repoText(TS);
    expect(ts).toContain('const reportedLen = PUBLIC_NOVEL_SOURCE_IDS.has(task.sourceId)');
    expect(ts).toContain('? Math.max(tempLen, task.downloadedBytes)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ DownloadWorker.kt L136-172 跳过已下载 + 三个生成分支
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L136-172 复用已完成文件与三种整本生成', () => {
  const src = kt(KT);

  it('L136-138 三个条件同时成立才跳过下载（url 匹配 + complete 为真）', () => {
    expect(src).toContain('if (!(finalFile.isFile && metadata?.optString("url") == task.downloadUrl && metadata.optBoolean("complete"))) {');
    const ts = repoText(TS);
    expect(ts).toContain('const completedLocal =');
    expect(ts).toContain('finalExists && metadata != null && metadata.url === task.downloadUrl && metadata.complete === true;');
  });

  it('L141 / L151 / L163 三处 `require(format == "epub") { tr("此源整本下载格式为 EPUB") }`', () => {
    expect((src.match(/require\(format == "epub"\) \{ tr\("此源整本下载格式为 EPUB"\) \}/g) ?? []).length).toBe(3);
    expect(repoText('src/core/i18n/strings.ts')).toContain('["此源整本下载格式为 EPUB",');
  });

  it('L148 / L160 / L172 三个生成分支 + L276 换包都写 `complete=false` 的 resume', () => {
    // 四处同形：PublicNovel / Xbookcn / AliceSw 各一次，ixdzs8 换包再补一次
    const hits = src.match(/resume\.writeText\(JSONObject\(\)\.put\("url", task\.downloadUrl\)\.put\("complete", false\)\.toString\(\)\)/g) ?? [];
    expect(hits).toHaveLength(4);
    // L236 是另一形态（validator/total 链式），不含 url
    expect(src).toContain('.put("total", total).put("complete", false).toString())');
  });

  it('三种源的判定顺序：PublicNovel → Xbookcn → AliceSw → 直连', () => {
    const publicAt = src.indexOf('val publicNovel = com.example.source.impl.PublicNovelSources.create(context, task.sourceId)');
    const xbookAt = src.indexOf('task.sourceId == com.example.source.impl.XbookcnSource.SOURCE_ID');
    const aliceAt = src.indexOf('task.sourceId == com.example.source.impl.AliceSwSource.SOURCE_ID');
    expect(publicAt).toBeGreaterThan(0);
    expect(xbookAt).toBeGreaterThan(publicAt);
    expect(aliceAt).toBeGreaterThan(xbookAt);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ DownloadWorker.kt L174-196 请求头
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L174-196 请求头', () => {
  const src = kt(KT);

  it('L174-176 只有 url 匹配且 validator 非空才续传，否则 offset 归零', () => {
    expect(src).toContain('var offset = temp.takeIf { it.isFile }?.length() ?: 0L');
    expect(src).toContain('val validator = metadata?.optString("validator")?.takeIf { it.isNotBlank() }');
    expect(src).toContain('if (metadata?.optString("url") != task.downloadUrl || validator == null) offset = 0L');
    const ts = repoText(TS);
    expect(ts).toContain('if (metadata?.url !== task.downloadUrl || validator == null) {');
  });

  it('L177-183 UA 两支 + zlibrary 的 Accept / Accept-Language', () => {
    expect(src).toContain('.header("User-Agent", if (task.sourceId == "zlibrary")');
    expect(src).toContain('com.example.source.zlibrary.network.ZLibraryHttpClient.DEFAULT_USER_AGENT else "Mozilla/5.0 (Linux; Android) CialloReader/1.1")');
    expect(src).toContain('.header("Accept", com.example.source.zlibrary.network.ZLibraryHttpClient.DEFAULT_ACCEPT)');
    expect(src).toContain('.header("Accept-Language", com.example.source.zlibrary.network.ZLibraryHttpClient.DEFAULT_ACCEPT_LANG)');
    const ts = repoText(TS);
    expect(ts).toContain("'User-Agent': zlibrary ? DEFAULT_USER_AGENT : 'Mozilla/5.0 (Linux; Android) CialloReader/1.1',");
    expect(ts).toContain("baseHeaders['Accept'] = DEFAULT_ACCEPT;");
    expect(ts).toContain("baseHeaders['Accept-Language'] = DEFAULT_ACCEPT_LANG;");
    // 三个常量的值来自 zLibraryHttpClient，不是就地编造
    expect(DEFAULT_USER_AGENT).toContain('Chrome/120.0.0.0 Mobile Safari/537.36');
    expect(DEFAULT_ACCEPT_LANG).toBe('zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
    expect(DEFAULT_ACCEPT.length).toBeGreaterThan(20);
  });

  it('L184 四个头**永不**从 savedHeaders 透传（Cookie/Range/If-Range/Accept-Encoding）', () => {
    expect(src).toContain('requestHeaders.filterKeys { !it.equals("Cookie",true) && !it.equals("Range",true) && !it.equals("If-Range",true) && !it.equals("Accept-Encoding",true) }.forEach { (key,value) -> builder.header(key,value) }');
    const ts = repoText(TS);
    expect(ts).toContain("lower !== 'cookie' &&");
    expect(ts).toContain("lower !== 'range' &&");
    expect(ts).toContain("lower !== 'if-range' &&");
    expect(ts).toContain("lower !== 'accept-encoding'");
  });

  it('L189-190 `allowSession` 放行子域（`host == sessionHost || host.endsWith(".$sessionHost")`）', () => {
    expect(src).toContain('val allowSession = task.sourceId != "zlibrary" ||');
    expect(src).toContain('(sessionHost != null && (host == sessionHost || host.endsWith(".$sessionHost")))');
    const ts = repoText(TS);
    expect(ts).toContain('const allowSession =');
    expect(ts).toContain('!zlibrary || (sessionHost !== null && (host === sessionHost || host.endsWith(`.${sessionHost}`)));');
  });

  it('L193 四个 CDN 主机不吃会话 Cookie', () => {
    expect(src).toContain('listOf("ncdn", "cdn-zlib", "s3proxy", "dln").none { it in host }');
    expect([...CDN_HOST_MARKERS]).toEqual(['ncdn', 'cdn-zlib', 's3proxy', 'dln']);
    expect(repoText(TS)).toContain('!CDN_HOST_MARKERS.some((h) => host.includes(h))');
  });

  it('L194 `Range` + `If-Range`（If-Range 用 validator 本身，不是 weak/strong 改写）', () => {
    expect(src).toContain('if (offset > 0) builder.header("Range", "bytes=$offset-").header("If-Range", validator!!)');
    const ts = repoText(TS);
    expect(ts).toContain("baseHeaders['Range'] = `bytes=${offset}-`;");
    expect(ts).toContain("baseHeaders['If-Range'] = validator;");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ DownloadWorker.kt L198-270 响应处理
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L198-231 状态码与断点', () => {
  const src = kt(KT);

  it('L202 416 只在 offset>0 且未重启过时重启**一次**', () => {
    expect(src).toContain('if (response.code == 416 && offset > 0 && !rangeRestarted) return@withResponse true');
    expect(src).toContain('// A 416 is not proof of file completeness. Restart safely once.');
    const ts = repoText(TS);
    expect(ts).toContain('if (response.status === 416 && offset > 0 && !rangeRestarted) return true;');
    expect(ts).toContain('rangeRestarted = true;');
  });

  it('L203-204 六码抛 IOException，下游据此重试', () => {
    expect(src).toContain('if (response.code in setOf(408,429,500,502,503,504))');
    expect(src).toContain('throw java.io.IOException("网络暂时不可用（HTTP ${response.code}）")');
    expect([...RETRYABLE_HTTP_STATUSES].sort((a, b) => a - b)).toEqual([408, 429, 500, 502, 503, 504]);
    const ts = repoText(TS);
    expect(ts).toContain('if (RETRYABLE_HTTP_STATUSES.has(response.status)) {');
    expect(ts).toContain('throw ioError(`网络暂时不可用（HTTP ${response.status}）`);');
  });

  it('六码的 IOException 语义：`isIoFailure(ioError(...))` 为真，普通 Error 为假', () => {
    const error = ioError('网络暂时不可用（HTTP 502）');
    expect(isIoFailure(error)).toBe(true);
    expect(error.name).toBe('IOException');
    expect((error as { ioError?: boolean }).ioError).toBe(true);
    expect(isIoFailure(new Error('网络暂时不可用（HTTP 502）'))).toBe(false);
    // 走 shouldRetryPublicNovel 时，502 的普通 Error 不重试而 ioError 重试
    expect(shouldRetryPublicNovel('quanben', error, 0)).toBe(true);
    expect(shouldRetryPublicNovel('quanben', new Error('网络暂时不可用（HTTP 502）'), 0)).toBe(false);
  });

  it('L205-211 401/403 两支 + 429 + else，文案逐字', () => {
    expect(src).toContain('401, 403 -> if (com.example.source.WholeBookNovelSources.contains(task.sourceId))');
    expect(src).toContain('"源站拒绝免登录下载，请稍后重试或换源（HTTP ${response.code}）"');
    expect(src).toContain('else "下载授权已失效，请重新登录或重新获取链接（HTTP ${response.code}）"');
    expect(src).toContain('429 -> tr("请求过于频繁，请稍后重试（HTTP 429）")');
    expect(src).toContain('else -> "下载失败（HTTP ${response.code}）"');
    const ts = repoText(TS);
    expect(ts).toContain('? WHOLE_BOOK_NOVEL_SOURCE_IDS.has(task.sourceId)');
    expect(ts).toContain('? `源站拒绝免登录下载，请稍后重试或换源（HTTP ${response.status}）`');
    expect(ts).toContain(': `下载授权已失效，请重新登录或重新获取链接（HTTP ${response.status}）`');
  });

  it('L209 的 429 分支在原文里是**死代码**（L203 先命中同一码）', () => {
    // Kotlin 顺序上 L203 的集合在 L205 的 when 之前，429 永远走前者
    const collectAt = src.indexOf('if (response.code in setOf(408,429,500,502,503,504))');
    const whenAt = src.indexOf('429 -> tr("请求过于频繁，请稍后重试（HTTP 429）")');
    expect(collectAt).toBeGreaterThan(0);
    expect(whenAt).toBeGreaterThan(collectAt);
    expect(RETRYABLE_HTTP_STATUSES.has(429)).toBe(true);
    // 端口保持同一顺序（不为「修活」它而调换）
    const ts = repoText(TS);
    expect(ts.indexOf('if (RETRYABLE_HTTP_STATUSES.has(response.status))')).toBeLessThan(
      ts.indexOf('? \'请求过于频繁，请稍后重试（HTTP 429）\''),
    );
  });

  it('L212-216 isHtmlError 命中 → error(quota ?: 「服务器返回了验证或错误页…」)', () => {
    expect(src).toContain('val quota = if (task.sourceId == "zlibrary")');
    expect(src).toContain('com.example.source.zlibrary.zLibraryDownloadPageError(response.peekBody(32 * 1024).string()) else null');
    expect(src).toContain('error(quota ?: "服务器返回了验证或错误页，下载链接可能已过期，请重新获取链接")');
    // 端口：先问配额页（32 KiB 预读样本），命中就用它的文案，否则回落到固定文案
    const ts = codeOnly(repoText(TS));
    expect(ts).toContain('zLibraryDownloadPageError(new TextDecoder().decode(response.body))');
    expect(ts).toContain("quota ?? '服务器返回了验证或错误页，下载链接可能已过期，请重新获取链接'");
    // 预读上限就是 Kotlin `peekBody(32 * 1024)`
    expect(ts).toContain('RESPONSE_PEEK_BYTES = 32 * 1024');
  });

  it('L217 `error("下载响应为空")`', () => {
    expect(src).toContain('val body = response.body ?: error("下载响应为空")');
  });

  it('L219-220 206 但 offset 为 0 → 「服务器意外返回部分文件」', () => {
    expect(src).toContain('val append = response.code == 206 && offset > 0');
    expect(src).toContain('require(append) { tr("服务器意外返回部分文件") }');
    expect(repoText(TS)).toContain("throw new Error('服务器意外返回部分文件');");
  });

  it('L221-225 206 的三条校验：Content-Range / ETag+Last-Modified / 上一轮 total', () => {
    expect(src).toContain('total = DownloadTransferPolicy.validateTail(response.header("Content-Range"), offset, body.contentLength())');
    expect(src).toContain('val returned = DownloadTransferPolicy.validator(response.header("ETag"), response.header("Last-Modified"))');
    expect(src).toContain('require(returned == null || returned == validator) { tr("续传文件版本发生变化，请重新下载") }');
    expect(src).toContain('require(previousTotal <= 0 || previousTotal == total) { tr("续传文件大小发生变化") }');
    const ts = repoText(TS);
    expect(ts).toContain("total = validateTail(headerValue(response.headers, 'Content-Range') ?? null, offset, bodyLength);");
    expect(ts).toContain("throw new Error('续传文件版本发生变化，请重新下载');");
    expect(ts).toContain("throw new Error('续传文件大小发生变化');");
  });

  it('L226-229 非 206 → 必须 200，offset 归零，total = Content-Length', () => {
    expect(src).toContain('require(response.code == 200) { tr("服务器未返回完整文件") }');
    expect(src).toContain('offset = 0L');
    expect(src).toContain('total = body.contentLength()');
    expect(repoText(TS)).toContain("throw new Error('服务器未返回完整文件');");
  });

  it('L231 存储空间：`total - offset + 16 MiB` 余量', () => {
    expect(src).toContain('require(total <= 0 || downloads.usableSpace >= total - offset + 16L * 1024 * 1024) { tr("存储空间不足，请清理后重试") }');
    const ts = repoText(TS);
    expect(ts).toContain('if (!(total <= 0 || usable >= total - offset + 16 * 1024 * 1024)) {');
    expect(ts).toContain("throw new Error('存储空间不足，请清理后重试');");
  });
});

describe('DownloadWorker.kt L232-265 流式写入', () => {
  const src = kt(KT);

  it('L232 注释说明「先截断再换元数据」的次序', () => {
    expect(src).toContain('// Truncate before replacing metadata: a crash cannot pair an old prefix with a new validator.');
  });

  it('L233-236 resume **先**写、数据后写（同一次 FileOutputStream 打开）', () => {
    const openAt = src.indexOf('FileOutputStream(temp, append).use { out ->');
    const writeAt = src.indexOf('resume.writeText(JSONObject().put("url", task.downloadUrl).put("validator", nextValidator ?: "")');
    const loopAt = src.indexOf('body.byteStream().use { input ->');
    expect(openAt).toBeGreaterThan(0);
    expect(writeAt).toBeGreaterThan(openAt);
    expect(loopAt).toBeGreaterThan(writeAt);
    const ts = repoText(TS);
    expect(ts.indexOf('await writeResume(fs, resume, {')).toBeLessThan(ts.indexOf('for await (const body of response.chunks)'));
  });

  it('L241 缓冲区 64 KiB', () => {
    expect(src).toContain('val buffer = ByteArray(64 * 1024)');
    expect(repoText(TS)).toContain('for (let i = 0; i < body.length; i += 64 * 1024) {');
  });

  it('L248 超长保护 `downloaded <= total`', () => {
    expect(src).toContain('require(total <= 0 || downloaded <= total) { tr("下载数据超过声明长度") }');
    expect(repoText(TS)).toContain("if (downloaded + slice.length > total) throw new Error('下载数据超过声明长度');");
  });

  it('L250 / L255 两档节流：UI 300 ms、DB 2000 ms', () => {
    expect(src).toContain('if (now - lastUi >= 300) {');
    expect(src).toContain('if (now - lastDb >= 2000) {');
    const ts = repoText(TS);
    expect(ts).toContain('if (nowMs - lastUi >= 300) {');
    expect(ts).toContain('if (nowMs - lastDb >= 2000) {');
  });

  it('L253 进度用 `(downloaded / total).coerceIn(0f, 1f)`，total=0 时给 0', () => {
    expect(src).toContain('if (total > 0) (downloaded.toFloat() / total).coerceIn(0f, 1f) else 0f');
    expect(repoText(TS)).toContain('total > 0 ? clamp01(downloaded / total) : 0');
  });

  it('L261-262 `out.flush()` 后 `if(total>0 && downloaded!=total) throw EOFException`', () => {
    expect(src).toContain('out.flush()');
    expect(src).toContain('if(total>0 && downloaded!=total) throw java.io.EOFException("文件下载不完整，将尝试续传")');
    const ts = repoText(TS);
    expect(ts).toContain('if (total > 0 && downloaded !== total) {');
    expect(ts).toContain("throw eofError('文件下载不完整，将尝试续传');");
  });

  it('`total > 0` 前置是真的必需：total 未知时不许抛', () => {
    // 服务器不给 Content-Length → Kotlin 的 body.contentLength() 是 -1
    const total: number = -1;
    const downloaded: number = 4096;
    expect(downloaded !== total).toBe(true); // 端口旧写法：恒真 → 必抛
    expect(total > 0 && downloaded !== total).toBe(false); // Kotlin 写法：不抛
    expect(total > 0 && 0 !== total).toBe(false);
    expect(0 > 0).toBe(false);
  });

  it('`eofError` 是 IOException 的子类语义（name 保留 + ioError 标记）', () => {
    const error = eofError('文件下载不完整，将尝试续传');
    expect(error.name).toBe('EOFException');
    expect(isIoFailure(error)).toBe(true);
    expect((error as { ioError?: boolean }).ioError).toBe(true);
    // 因此它落进「非 zlibrary 的 IOException」重试支
    expect(shouldRetryPublicNovel('quanben', error, 0)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ DownloadWorker.kt L271-342 ixdzs8 / EOF 阶段 / 导入 / 收尾
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L271-297 TXT 换包与 EOF 阶段', () => {
  const src = kt(KT);

  it('L271-272 只有 `ixdzs8` + `txt` 才换包；prepare 返回 null 时报「网文源未返回 TXT 打包文件，请重试」', () => {
    expect(src).toContain('if (task.sourceId == "ixdzs8" && format == "txt") {');
    expect(src).toContain('val text = NovelTextArchive.prepare(temp) ?: error("网文源未返回 TXT 打包文件，请重试")');
    const ts = repoText(TS);
    expect(ts).toContain("if (task.sourceId === 'ixdzs8' && format === 'txt') {");
    expect(ts).toContain("throw new Error('网文源未返回 TXT 打包文件，请重试');");
  });

  it('L275-277 换包前写 `complete=false` 的 resume，改名两条 check', () => {
    expect(src).toContain('// The text bytes cannot resume against the archive\'s validator.');
    expect(src).toContain('check(temp.delete() && text.renameTo(temp)) { "无法保存小说文本" }');
    expect(src).toContain('} finally { text.delete() }');
    const ts = repoText(TS);
    expect(ts).toContain('await writeResume(fs, resume, { url: task.downloadUrl, complete: false });');
    expect(ts).toContain('await renameFile(fs, textPath, temp);');
    expect(ts).toContain('await deleteQuietly(fs, textPath);');
  });

  it('L282-284 EOF 是独立阶段：进度写 1f 且 total=文件长度', () => {
    expect(src).toContain('// EOF is a distinct phase; it is not a transfer stuck at 99%.');
    expect(src).toContain('dao.updateProgressAndStatus(taskId, DownloadStatus.DOWNLOADING, temp.length(), temp.length(), null, progress=1f)');
    expect(src).toContain('DownloadProgressBroadcaster.updateState(taskId, DownloadState.Downloading(temp.length(),temp.length(),1f))');
    const ts = repoText(TS);
    expect(ts).toContain("status: 'DOWNLOADING',");
    expect(ts).toContain('progress: 1,');
  });

  it('L285-287 完整性校验：`htmlErrorHint` 优先，actualFormat 可改扩展名', () => {
    expect(src).toContain('val integrity = DownloadFileValidator.validateFileIntegrity(temp, format)');
    expect(src).toContain('require(integrity.valid) { integrity.htmlErrorHint ?: "下载文件格式校验失败" }');
    expect(src).toContain('val actualFormat = integrity.actualFormat ?: format');
    const ts = repoText(TS);
    expect(ts).toContain("throw new Error(integrity.htmlErrorHint ?? '下载文件格式校验失败');");
    expect(ts).toContain('const actualFormat = integrity.actualFormat ?? format;');
  });

  it('L290-292 改扩展名两条 check 的文案', () => {
    expect(src).toContain('val actualFile = File(downloads, "${finalFile.nameWithoutExtension}.$actualFormat")');
    expect(src).toContain('check(!actualFile.exists() || actualFile.delete()) { "无法替换旧下载文件" }');
    expect(src).toContain('check(temp.renameTo(actualFile)) { "无法保存下载文件" }');
  });

  it('L295-296 complete 元数据保留其它键（`put("complete", true)` 而不是重建）', () => {
    expect(src).toContain('val completeMetadata = runCatching { JSONObject(resume.readText()) }.getOrDefault(JSONObject())');
    expect(src).toContain('resume.writeText(completeMetadata.put("complete", true).toString())');
    expect(repoText(TS)).toContain('await writeResume(fs, resume, { ...completeMetadata, complete: true });');
  });
});

describe('DownloadWorker.kt L298-342 导入与收尾', () => {
  const src = kt(KT);

  it('L298-301 取消 / 文件损坏两条文案', () => {
    expect(src).toContain('var latest = dao.getTaskById(taskId) ?: error("下载任务已取消")');
    expect(src).toContain('require(integrity.valid) { tr("下载文件损坏，请重新下载") }');
    const ts = repoText(TS);
    expect(ts).toContain("throw new Error('下载任务已取消');");
    expect(ts).toContain("throw new Error('下载文件损坏，请重新下载');");
  });

  it('L305-308 pending 三个条件（整本源 + sourceId + originalBookId）', () => {
    expect(src).toContain('val novel = novelStore.pending(taskId)?.takeIf {');
    expect(src).toContain('com.example.source.WholeBookNovelSources.contains(task.sourceId) && it.book.sourceId == task.sourceId &&');
    expect(src).toContain('it.book.id == DownloadManager.originalBookId(task.id, task.sourceId)');
    const ts = repoText(TS);
    expect(ts).toContain('isWholeBookNovelSource(task.sourceId)');
    expect(ts).toContain('pending.book.id === originalBookId(task.id, task.sourceId)');
  });

  it('L313-327 换包前比对指纹：相同则拒绝并保留本地版本', () => {
    expect(src).toContain('if (novel.replace && old != null && baseline?.hasRevision == true &&');
    expect(src).toContain('"源站整本下载包尚未更新，已保留本地版本；请稍后重试"');
    const ts = repoText(TS);
    expect(ts).toContain("throw new Error('源站整本下载包尚未更新，已保留本地版本；请稍后重试');");
  });

  it('L328 / L330-331 两条导入路径（整本 vs 单文件）', () => {
    expect(src).toContain('repository.importDownloadedNovel(Uri.fromFile(file), novel.book.copy(format = latest.format), novel.replace).getOrThrow()');
    expect(src).toContain('else repository.importBookFromUri(Uri.fromFile(file), "${task.title}.${latest.format}", task.sourceId,');
    const ts = repoText(TS);
    expect(ts).toContain('await importer.importDownloadedNovel(');
    expect(ts).toContain('await importer.importBookFromUri(');
  });

  it('L332-342 NonCancellable 收尾五步：imported / COMPLETED / secrets.remove / checkpoint.clear / Success', () => {
    expect(src).toContain('// Once import commits, finish bookkeeping even if pause arrives at that boundary.');
    expect(src).toContain('withContext(NonCancellable) {');
    expect(src).toContain('if (novel != null) novelStore.imported(taskId)');
    expect(src).toContain('GuestNovelCheckpoint.clear(temp)');
    expect(src).toContain('DownloadProgressBroadcaster.updateState(taskId, DownloadState.Success(file.absolutePath))');
    const ts = repoText(TS);
    expect(ts).toContain('await novels.imported(taskId);');
    expect(ts).toContain('await secrets.remove(`download:${taskId}`);');
    expect(ts).toContain('await clearGuestNovelCheckpoint(fs, temp)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑧ DownloadWorker.kt L345-436 三个 catch 与 recordInterruption
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L345-363 取消与前台受限', () => {
  const src = kt(KT);

  it('L345-347 CancellationException → recordInterruption 后**原样抛出**', () => {
    expect(src).toContain('} catch (e: CancellationException) {');
    expect(src).toContain('recordInterruption(taskId, temp, total)');
    expect(src).toContain('throw e');
    const ts = repoText(TS);
    expect(ts).toContain("await dao.updateProgressAndStatus(taskId, 'PAUSED', len, total, null);");
  });

  it('L349-354 阻塞 IO 的取消：先记 PAUSED 再 `ensureActive()` 重抛', () => {
    expect(src).toContain('// Cancelling a blocking socket can throw IOException before the next suspension.');
    expect(src).toContain('if (!currentCoroutineContext().isActive) {');
    expect(src).toContain('currentCoroutineContext().ensureActive()');
  });

  it('L355 `val message = failureMessage(e)` —— 端口已接上（E214 遗留闭环）', () => {
    expect(src).toContain('val message = failureMessage(e)');
    const ts = codeOnly(repoText(TS));
    expect(ts).toContain('let message = failureMessage(e);');
    // 反向：自造的两句都不许再出现
    expect(ts).not.toContain("'下载或入库失败'");
    expect(ts).not.toContain("rawMessage.toUpperCase().includes('ENOSPC')");
    // 分类器本身的行为
    expect(failureMessage(new Error('ENOSPC'))).toBe(STORAGE_FULL_FAILURE);
    expect(failureMessage(ioError('socket closed'))).toBe(IO_INTERRUPTED_FAILURE);
    expect(failureMessage(new Error(''))).toBe(DOWNLOAD_FAILED_FALLBACK);
    expect(failureMessage(new Error('长'.repeat(200)))).toHaveLength(FAILURE_MESSAGE_MAX_CHARS);
  });

  it('L356-363 前台受限 → `runAttemptCount < 5` 决定 PENDING+retry / PAUSED+failure', () => {
    expect(src).toContain('if(foregroundStartRestricted(e)) {');
    expect(src).toContain('val retry=runAttemptCount<5');
    expect(src).toContain('dao.updateProgressAndStatus(taskId,if(retry) DownloadStatus.PENDING else DownloadStatus.PAUSED,');
    expect(src).toContain('maxOf(temp.length(),latest.downloadedBytes),total,message)');
    expect(src).toContain('return@withContext if(retry) Result.retry() else Result.failure()');
    const ts = repoText(TS);
    expect(ts).toContain('if (foregroundStartRestricted(e)) {');
    expect(ts).toContain('const retry = attempt < PUBLIC_NOVEL_RETRY_LIMIT;');
    expect(ts).toContain("await dao.updateProgressAndStatus(taskId, retry ? 'PENDING' : 'PAUSED', len, total, message);");
    expect(ts).toContain("return retry ? 'retry' : 'failure';");
  });

  it('`foregroundStartRestricted` 走 cause 链，深层包裹也能识别', () => {
    const root = new Error('startForegroundService() not allowed');
    const wrapped = new Error('io', { cause: new Error('upper', { cause: root }) });
    expect(foregroundStartRestricted(wrapped)).toBe(true);
    expect(foregroundStartRestricted(ioError('socket closed'))).toBe(false);
  });
});

describe('DownloadWorker.kt L364-421 网络重试与 zlibrary 恢复', () => {
  const src = kt(KT);

  it('L364-372 两条重试判据 + `网络暂时中断，将从已保存章节继续下载` + retry', () => {
    expect(src).toContain('if (shouldRetryPublicNovel(task.sourceId, e, runAttemptCount) ||');
    expect(src).toContain('(task.sourceId != "zlibrary" && runAttemptCount < 5 && e is java.io.IOException &&');
    expect(src).toContain('e !is java.io.FileNotFoundException && e.message?.contains("ENOSPC",true)!=true)) {');
    expect(src).toContain('dao.updateProgressAndStatus(taskId, DownloadStatus.PENDING,');
    expect(src).toContain('"网络暂时中断，将从已保存章节继续下载")');
    expect(src).toContain('return@withContext Result.retry()');
    const ts = repoText(TS);
    expect(ts).toContain('shouldRetryPublicNovel(task.sourceId, e, attempt) ||');
    expect(ts).toContain("(task.sourceId !== 'zlibrary' &&");
    expect(ts).toContain("!messageOf(e).toLowerCase().includes('enospc'))");
    expect(ts).toContain("'网络暂时中断，将从已保存章节继续下载'");
    expect(ts).toContain("return 'retry';");
  });

  it('L375-377 zlibrary 恢复的四个前置（recoveries<2 / 三类异常 / shouldRetryZLibraryDownload）', () => {
    expect(src).toContain('if (task.sourceId == "zlibrary" && recoveries < 2 &&');
    expect(src).toContain('(e is java.io.IOException || e is IllegalArgumentException || e is IllegalStateException) &&');
    expect(src).toContain('com.example.source.zlibrary.shouldRetryZLibraryDownload(e.message ?: message)) {');
    const ts = repoText(TS);
    expect(ts).toContain("if (validatingRemote && task.sourceId === 'zlibrary' && recovery.count < 2 &&");
    expect(ts).toContain('shouldRetryZLibraryDownload(message)');
  });

  it('L382-393 首轮失败且是 403/验证页时，先试 WebView 取新链接', () => {
    expect(src).toContain('if (recoveries == 0 && previous != null && failed != null &&');
    expect(src).toContain('(message.contains("服务器未返回完整文件") || message.contains("验证或错误页") || message.contains("HTTP 403"))) {');
    expect(src).toContain('val browser = com.example.source.zlibrary.ZLibraryWebViewHelper.resolveDownload(context,');
    expect(src).toContain('dao.insertOrUpdate(latest.copy(downloadUrl = browser.url, status = DownloadStatus.PENDING, errorMessage = null))');
    const ts = repoText(TS);
    expect(ts).toContain('/验证或错误页|服务器未返回完整文件|HTTP 403/i.test(message)');
  });

  it('L395-409 换源恢复：排除失败主机后重新解析，成功则清零进度重跑', () => {
    expect(src).toContain('val excluded = failedNodes + listOfNotNull(failed)');
    expect(src).toContain('ZLibrarySource(context).recoverDownloadInfo(');
    expect(src).toContain('dao.insertOrUpdate(latest.copy(downloadUrl = info.url, status = DownloadStatus.PENDING,');
    expect(src).toContain('downloadedBytes = 0L, totalBytes = 0L, errorMessage = null))');
    expect(src).toContain('return@withContext performTask(recoveries + 1, excluded)');
    const ts = repoText(TS);
    expect(ts).toContain('downloadUrl: result.data.url, status: \'PENDING\',');
    expect(ts).toContain('downloadedBytes: 0, totalBytes: 0, errorMessage: null, progress: 0');
  });

  it('L410-414 恢复也失败 → 两条文案用「；」拼接后 FAILED', () => {
    expect(src).toContain('val failure = if (recoveryMessage.isNullOrBlank()) message else "$message；$recoveryMessage"');
    expect(src).toContain('dao.updateProgressAndStatus(taskId, DownloadStatus.FAILED, temp.length(), total, failure)');
    const ts = repoText(TS);
    expect(ts).toContain("message += '；' + result.exception.message;");
  });

  it('L416-420 兜底：任务还在才写 FAILED（取消已删行时不重建）', () => {
    expect(src).toContain('if (dao.getTaskById(taskId) != null) {');
    expect(src).toContain('dao.updateProgressAndStatus(taskId, DownloadStatus.FAILED, temp.length(), total, message)');
    const ts = repoText(TS);
    expect(ts).toContain('if ((await dao.getTask(taskId)) != null) {');
    expect(ts).toContain("await dao.updateProgressAndStatus(taskId, 'FAILED', len, total, message);");
  });
});

describe('DownloadWorker.kt L424-436 recordInterruption', () => {
  const src = kt(KT);

  it('L426 显式取消可能已删行 —— 只在 DOWNLOADING / PAUSED 时写', () => {
    expect(src).toContain('// Explicit cancel may have deleted the row; never recreate it.');
    expect(src).toContain('if (latest != null && latest.status in setOf(DownloadStatus.DOWNLOADING, DownloadStatus.PAUSED)) {');
  });

  it('L429-430 公共小说源同样取 `maxOf(temp, downloadedBytes)`', () => {
    expect(src).toContain('val bytes = if (latest.sourceId in com.example.source.impl.PublicNovelSources.ids)');
    expect(src).toContain('maxOf(temp.length(), latest.downloadedBytes) else temp.length()');
  });

  it('L431-434 `stopReason == STOP_REASON_CONSTRAINT_CONNECTIVITY` → PENDING，否则 PAUSED', () => {
    expect(src).toContain('val waitingForNetwork = stopReason == WorkInfo.STOP_REASON_CONSTRAINT_CONNECTIVITY');
    expect(src).toContain('dao.updateProgressAndStatus(taskId, if (waitingForNetwork) DownloadStatus.PENDING else DownloadStatus.PAUSED, bytes, total, null)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑨ DownloadWorker.kt L439-483 withResponse / verifyGuestNovel / isHtmlError
   ══════════════════════════════════════════════════════════════════════════════ */

describe('DownloadWorker.kt L439-453 withResponse', () => {
  const src = kt(KT);

  it('L441-445 zlibrary 用专用 client，且「偏好直连」的节点走 NO_PROXY', () => {
    expect(src).toContain('val guarded=(if (sourceId == "zlibrary") client else publicClient).newBuilder()');
    expect(src).toContain('if (sourceId == "zlibrary" && node != null && com.example.library.ZLibraryNodeConfig.prefersDirect(node))');
    expect(src).toContain('proxy(java.net.Proxy.NO_PROXY)');
  });

  it('L446-451 network 拦截器：跨主机/跨协议剥四个头', () => {
    expect(src).toContain('.addNetworkInterceptor { chain ->');
    expect(src).toContain('val safe=if(next.url.host!=origin.host || next.url.scheme!=origin.scheme) next.newBuilder()');
    expect(src).toContain('.removeHeader("Cookie").removeHeader("Authorization").removeHeader("Proxy-Authorization").removeHeader("X-Api-Key").build() else next');
    // 端口的同名函数逐条对拍
    const same = stripSensitiveHeadersOnCrossHost('https://a.example/x', {
      url: 'https://a.example/y',
      method: 'GET',
      headers: { Cookie: 'c=1', Range: 'bytes=0-' },
    });
    expect(same.headers).toEqual({ Cookie: 'c=1', Range: 'bytes=0-' });
    const cross = stripSensitiveHeadersOnCrossHost('https://a.example/x', {
      url: 'https://b.example/y',
      method: 'GET',
      headers: {
        Cookie: 'c=1',
        Authorization: 'Bearer t',
        'Proxy-Authorization': 'Basic x',
        'X-Api-Key': 'k',
        Range: 'bytes=0-',
        Referer: 'https://a.example/',
      },
    });
    expect(cross.headers).toEqual({ Range: 'bytes=0-', Referer: 'https://a.example/' });
    // 换协议同样剥
    const downgrade = stripSensitiveHeadersOnCrossHost('https://a.example/x', {
      url: 'http://a.example/y',
      method: 'GET',
      headers: { Cookie: 'c=1' },
    });
    expect(downgrade.headers).toEqual({});
  });
});

describe('DownloadWorker.kt L455-483 verifyGuestNovel / isHtmlError', () => {
  const src = kt(KT);

  it('L456-472 verifyGuestNovel 四段（整本源 / epub / auto_novel 目录 / txt）', () => {
    expect(src).toContain('private suspend fun verifyGuestNovel(file: File, sourceId: String, format: String, downloadUrl: String) {');
    expect(src).toContain('if (!com.example.source.WholeBookNovelSources.contains(sourceId)) return');
    expect(src).toContain('val summary = GuestNovelIntegrity.epub(file)');
    expect(src).toContain('require(path.size >= 5 && path[0] == "api" && path[1] == "novel" && path[4] == "file") { tr("Novelia 下载地址异常") }');
    expect(src).toContain('"Novelia 下载文件与完整目录不一致，未导入缺章或乱序译本"');
    expect(src).toContain('} else if (format == "txt") GuestNovelIntegrity.text(file)');
    expect(src).toContain('else error("小说下载格式不完整或不受支持")');
    // 端口目前**整段缺失** —— 已登记 E216 待办，这里如实钉「缺」
    expect(codeOnly(repoText(TS))).not.toContain('verifyGuestNovel');
  });

  it('L475-483 isHtmlError：六标记 + txt 特例 + Content-Type', () => {
    expect(src).toContain('val sample = response.peekBody(4096).string().trimStart().lowercase()');
    expect(src).toContain('val html = response.header("Content-Type")?.contains("text/html", true) == true ||');
    expect(src).toContain('if (format != "txt") return true');
    expect(src).toContain('return listOf("diamwall", "checking your browser", "verifying your browser", "daily limit", "page not found", "solve this captcha").any { it in sample }');
  });

  it('端口的 isHtmlError 与原文六标记逐条一致', () => {
    const asResponse = (body: string, contentType = 'text/html'): HttpResponse => ({
      status: 200,
      headers: { 'Content-Type': contentType },
      url: 'https://x/y',
      body: new TextEncoder().encode(body),
    });
    // 非 txt：任何 html 都算错误
    expect(isHtmlError(asResponse('<html><body>ok</body></html>'), 'epub')).toBe(true);
    // txt 下 `<!doctype html>` 只是「是 HTML」，但没有六个标记之一 → 仍然放行
    expect(isHtmlError(asResponse('<!doctype html><html></html>'), 'txt')).toBe(false);
    // txt：只有六个标记才算
    for (const marker of ['diamwall', 'checking your browser', 'verifying your browser', 'daily limit', 'page not found', 'solve this captcha']) {
      expect(isHtmlError(asResponse(`<html>${marker}</html>`), 'txt')).toBe(true);
    }
    expect(isHtmlError(asResponse('<html>普通正文</html>'), 'txt')).toBe(false);
    // 非 html 一律 false
    expect(isHtmlError(asResponse('plain text', 'text/plain'), 'epub')).toBe(false);
    // 大小写与首空白（trimStart + lowercase）
    expect(isHtmlError(asResponse('   <!DOCTYPE HTML><html></html>'), 'epub')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑩ zLibraryDownloadPageError 的语义（同名占位修正后）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ZLibraryBookReference.kt L28 zLibraryDownloadPageError(html)', () => {
  const src = kt('source/zlibrary/ZLibraryBookReference.kt');

  it('原文是 `(html: String)` 且按**七个标记**判配额，不是按 HTTP 状态码', () => {
    expect(src).toContain('internal fun zLibraryDownloadPageError(html: String): String? {');
    expect(src).toContain('val text = org.jsoup.Jsoup.parse(html).text().lowercase()');
    expect(src).toContain('listOf("daily limit", "download limit", "downloads limit", "download quota", "下载上限", "下载限额", "下载次数已达")');
    expect(src).toContain('-> tr("今日下载额度已用尽，请等待额度重置")');
    // 端口此前是 `(status: number)` + 三条按状态码编造的文案（同名占位，E216）
    expect([...ZLIBRARY_QUOTA_MARKERS]).toEqual([
      'daily limit',
      'download limit',
      'downloads limit',
      'download quota',
      '下载上限',
      '下载限额',
      '下载次数已达',
    ]);
    expect(ZLIBRARY_QUOTA_MESSAGE).toBe('今日下载额度已用尽，请等待额度重置');
  });

  it('七个标记大小写不敏感、子串匹配；不命中返回 null', () => {
    expect(zLibraryDownloadPageError('<p>Your daily LIMIT has been reached</p>')).toBe(ZLIBRARY_QUOTA_MESSAGE);
    expect(zLibraryDownloadPageError('<p>Download Quota exceeded</p>')).toBe(ZLIBRARY_QUOTA_MESSAGE);
    expect(zLibraryDownloadPageError('<p>今日下载限额已用完</p>')).toBe(ZLIBRARY_QUOTA_MESSAGE);
    expect(zLibraryDownloadPageError('<p>下载次数已达上限</p>')).toBe(ZLIBRARY_QUOTA_MESSAGE);
    // 标签不影响：jsoup `.text()` 会把节点文本拼起来
    expect(zLibraryDownloadPageError('<div><span>daily</span> <b>limit</b></div>')).toBe(ZLIBRARY_QUOTA_MESSAGE);
    expect(zLibraryDownloadPageError('<html><body><h1>Book page</h1></body></html>')).toBeNull();
    expect(zLibraryDownloadPageError('')).toBeNull();
    // 状态码语义已删除：传数字不再是签名
    expect(zLibraryDownloadPageError('404')).toBeNull();
  });
});
