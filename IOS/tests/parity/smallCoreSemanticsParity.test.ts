/**
 * smallCoreSemanticsParity.test.ts —— 第三批**小文件**（合计 185 行，11 个文件）。
 *
 *   · `ui/feedback/NavigationMotion.kt`（14）—— 前进/返回两对过渡的时长与缓动
 *   · `mangatranslate/TranslationPrivacy.kt`（8）—— 隐私门真值表
 *   · `source/AuthenticationState.kt`（8）—— 四态
 *   · `source/LoginCredential.kt`（8）—— 四个字段与默认值
 *   · `data/ContentMutationGate.kt`（9）—— 锁顺序 + epoch 失效
 *   · `source/SourceException.kt`（9）—— 五个子类的文案与继承
 *   · `transfer/TransferWire.kt`（26）—— 长度前缀帧 + 分块三校验
 *   · `data/ProcessExitDiagnostics.kt`（27）—— 系统退出历史 + 脱敏 + 128KiB 截断
 *   · `library/LibraryUiState.kt`（27）—— 八种状态与 `AggregateGroup` 默认值
 *   · `source/PufeiImageCacheRetry.kt`（27）—— 四道守卫 + 分钟桶
 *   · `source/anilist/CjkFoldMap.kt`（28）—— 繁简折叠全表
 *
 * 本轮补的真缺口：`ProcessExitDiagnostics` 此前被移植成「记录当前路由 + note」，
 * 与 Kotlin 的「读系统进程退出历史并脱敏输出」**完全不是一件事**；配套的
 * `StartupDiagnostics.redact` 与 `readLimited` 也没有移植 —— 于是「读系统退出历史」
 * 这条链根本落不了地。现在三层齐备：
 *   `@platform/interfaces` 的 `ProcessExitHistoryPort`
 *   ＋ `platform/web/processExitHistory.ts`
 *   ＋ `platform/ios-native/processExitHistory.ts`
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TWEEN_EASING,
  EASE_OUT_CUBIC,
  NAV_SLIDE_FRACTION,
  NO_NAV_TRANSITION,
  navigationEnter,
  navigationLeave,
  navigationReturnEnter,
  navigationReturnLeave,
} from '@core/motion/navigationMotion';
import { TranslationPrivacy } from '@core/mangatranslate/translationPrivacy';
import { AuthenticationState } from '@core/source/authenticationState';
import { createLoginCredential } from '@core/source/loginCredential';
import { AsyncMutex, ContentMutationGate } from '@core/data/contentMutationGate';
import {
  BookNotFound,
  LoginRequired,
  NetworkError,
  ParseError,
  SourceException,
  Unknown,
} from '@core/source/sourceException';
import {
  TRANSFER_CHUNK_BYTES,
  TransferProtocolError,
  encodeTransferControl,
  verifyTransferChunk,
  transferHash,
} from '@core/transfer/transferWire';
import {
  PROCESS_EXIT_EMPTY_REPORT,
  PROCESS_EXIT_MAX_RECORDS,
  PROCESS_EXIT_TRACE_HEADER,
  PROCESS_EXIT_TRACE_UNAVAILABLE_PREFIX,
  PROCESS_EXIT_UNAVAILABLE_PREFIX,
  ProcessExitDiagnostics,
  RouteExitBreadcrumbs,
  STARTUP_TRACE_LIMIT_BYTES,
  STARTUP_TRACE_TRUNCATED_SUFFIX,
  readLimitedText,
  startupRedact,
} from '@core/data/startupDiagnostics';
import {
  LibraryUiEmpty,
  LibraryUiLoading,
  LibraryUiReady,
  LibraryUiSearching,
  libraryAggregateGroup,
  libraryAggregateResults,
  libraryDownloading,
  libraryErrorState,
  librarySearchResults,
} from '@core/library/libraryTypes';
import {
  PUFEI_IMAGE_HOST_SUFFIX,
  PUFEI_IMAGE_REFERER,
  PUFEI_RETRY_PARAM,
  intercept,
} from '@core/source/pufeiImageCacheRetry';
import { CJK_FOLD_PAIR_COUNT, foldChar } from '@core/data/cjkFoldMap';
import { createWebProcessExitHistoryPort, WEB_EXIT_EVIDENCE_KEY } from '@platform/web/processExitHistory';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('NavigationMotion.kt：两对过渡', () => {
  const KT = kt('ui/feedback/NavigationMotion.kt');

  it('reduce 时四条全部是 None（null）', () => {
    expect(KT).toContain('if (reduce) EnterTransition.None else');
    expect(KT).toContain('if (reduce) ExitTransition.None else');
    expect(navigationEnter(true)).toBe(NO_NAV_TRANSITION);
    expect(navigationLeave(true)).toBe(NO_NAV_TRANSITION);
    expect(navigationReturnEnter(true)).toBe(NO_NAV_TRANSITION);
    expect(navigationReturnLeave(true)).toBe(NO_NAV_TRANSITION);
  });

  it('enter：fade CONTENT_MS(200) + slide PAGE_MS(280) easeOutCubic，起始位移 1/12', () => {
    expect(KT).toContain('fadeIn(tween(AppMotion.CONTENT_MS))');
    expect(KT).toContain(
      'slideInHorizontally(tween(AppMotion.PAGE_MS, easing = AppMotion.easeOutCubic)) { it / 12 }',
    );
    const spec = navigationEnter(false);
    expect(spec).not.toBeNull();
    expect(spec?.fadeMs).toBe(200);
    expect(spec?.slideMs).toBe(280);
    expect(spec?.fadeEasing).toEqual(DEFAULT_TWEEN_EASING);
    expect(spec?.slideEasing).toEqual(EASE_OUT_CUBIC);
    expect(spec?.slideFromFraction).toBeCloseTo(1 / 12, 12);
    expect(NAV_SLIDE_FRACTION).toBeCloseTo(1 / 12, 12);
    // 两个缓动不能混用：fade 用 Compose 默认，slide 用 easeOutCubic
    expect(spec?.fadeEasing).not.toEqual(spec?.slideEasing);
    expect([...EASE_OUT_CUBIC]).toEqual([0.215, 0.61, 0.355, 1]);
    expect([...DEFAULT_TWEEN_EASING]).toEqual([0.4, 0, 0.2, 1]);
  });

  it('leave：只有 fade 140ms（字面量，不是令牌）', () => {
    expect(KT).toContain('fadeOut(tween(140))');
    const spec = navigationLeave(false);
    expect(spec?.fadeMs).toBe(140);
    expect(spec?.slideMs).toBeNull();
    expect(spec?.slideFromFraction).toBeNull();
  });

  it('returnEnter：只有 fade 180ms', () => {
    expect(KT).toContain('fadeIn(tween(180))');
    const spec = navigationReturnEnter(false);
    expect(spec?.fadeMs).toBe(180);
    expect(spec?.slideMs).toBeNull();
  });

  it('returnLeave：fade EXIT_MS(170) + slide 220ms easeOutCubic', () => {
    expect(KT).toContain('fadeOut(tween(AppMotion.EXIT_MS))');
    expect(KT).toContain('slideOutHorizontally(tween(220, easing = AppMotion.easeOutCubic)) { it / 12 }');
    const spec = navigationReturnLeave(false);
    expect(spec?.fadeMs).toBe(170);
    expect(spec?.slideMs).toBe(220);
    // 退出滑动的 220 与进入的 280 必须不同（Kotlin 是两个字面量）
    expect(spec?.slideMs).not.toBe(navigationEnter(false)?.slideMs);
  });
});

describe('TranslationPrivacy.kt：隐私门真值表', () => {
  const KT = kt('mangatranslate/TranslationPrivacy.kt');

  it('两个合取项都取反，顺序固定', () => {
    expect(KT).toContain('!com.example.data.PrivacyManager(context).isEnabled() &&');
    expect(KT).toContain('!com.example.data.PreferencesManager(context).incognitoBrowsingEnabled');
    expect(TranslationPrivacy.allowed(false, false)).toBe(true);
    expect(TranslationPrivacy.allowed(true, false)).toBe(false);
    expect(TranslationPrivacy.allowed(false, true)).toBe(false);
    expect(TranslationPrivacy.allowed(true, true)).toBe(false);
  });
});

describe('AuthenticationState.kt：四态', () => {
  const KT = kt('source/AuthenticationState.kt');

  it('NotRequired / Required / Authenticated / Expired', () => {
    expect(KT).toContain('object NotRequired : AuthenticationState');
    expect(KT).toContain('object Required : AuthenticationState');
    expect(KT).toContain('object Authenticated : AuthenticationState');
    expect(KT).toContain('object Expired : AuthenticationState');
    expect(Object.keys(AuthenticationState)).toEqual([
      'NotRequired',
      'Required',
      'Authenticated',
      'Expired',
    ]);
    expect(AuthenticationState.NotRequired).toBe('NotRequired');
    expect(AuthenticationState.Expired).toBe('Expired');
  });
});

describe('LoginCredential.kt：字段与默认值', () => {
  const KT = kt('source/LoginCredential.kt');

  it('username/password 默认空串，cookie 默认 null，extraData 默认空表', () => {
    expect(KT).toContain('val username: String = ""');
    expect(KT).toContain('val password: String = ""');
    expect(KT).toContain('val cookie: String? = null');
    expect(KT).toContain('val extraData: Map<String, String> = emptyMap()');
    expect(createLoginCredential()).toEqual({
      username: '',
      password: '',
      cookie: null,
      extraData: {},
    });
    expect(
      createLoginCredential({ username: 'u', password: 'p', cookie: 'c', extraData: { k: 'v' } }),
    ).toEqual({ username: 'u', password: 'p', cookie: 'c', extraData: { k: 'v' } });
  });
});

describe('ContentMutationGate.kt：锁顺序与 epoch', () => {
  const KT = kt('data/ContentMutationGate.kt');

  it('epoch 从 0 起、只由 invalidatePendingWrites 递增', () => {
    expect(KT).toContain('@Volatile var epoch=0L');
    expect(KT).toContain('private set');
    expect(KT).toContain('fun invalidatePendingWrites() { epoch++ }');
    const gate = ContentMutationGate;
    const before = gate.epoch;
    gate.invalidatePendingWrites();
    expect(gate.epoch).toBe(before + 1);
    gate.invalidatePendingWrites();
    expect(gate.epoch).toBe(before + 2);
  });

  it('锁顺序注释逐字（download controls → worker task lock → content gate → Room）', () => {
    expect(KT).toContain(
      'Lock order: download controls -> worker task lock -> content gate -> Room transaction.',
    );
  });

  it('AsyncMutex 串行：先到先得，异常也释放', async () => {
    const mutex = new AsyncMutex();
    const order: string[] = [];
    const first = mutex.withLock(async () => {
      order.push('first-in');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('first-out');
      return 1;
    });
    const second = mutex.withLock(async () => {
      order.push('second-in');
      return 2;
    });
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['first-in', 'first-out', 'second-in']);

    // 抛错也必须释放，否则后续 lock 永久挂住
    await expect(
      mutex.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await mutex.withLock(async () => 'after')).toBe('after');
  });
});

describe('SourceException.kt：五个子类的文案与继承', () => {
  const KT = kt('source/SourceException.kt');

  it('LoginRequired / BookNotFound 的固定文案逐字；三个 data class 带 errorMsg', () => {
    expect(KT).toContain('object LoginRequired : SourceException("需要登录后继续操作")');
    expect(KT).toContain('object BookNotFound : SourceException("未能找到对应图书")');
    expect(KT).toContain('data class NetworkError(val errorMsg: String, val throwable: Throwable? = null)');
    expect(KT).toContain('data class ParseError(val errorMsg: String)');
    expect(KT).toContain('data class Unknown(val errorMsg: String, val throwable: Throwable? = null)');

    expect(new LoginRequired().message).toBe('需要登录后继续操作');
    expect(new BookNotFound().message).toBe('未能找到对应图书');
    expect(new NetworkError('HTTP 500').errorMsg).toBe('HTTP 500');
    expect(new ParseError('bad html').message).toBe('bad html');
    expect(new Unknown('???').errorMsg).toBe('???');
    // 全部 instanceof SourceException（Kotlin 是 sealed class 的子类）
    for (const error of [new LoginRequired(), new BookNotFound(), new NetworkError('x'), new ParseError('y'), new Unknown('z')]) {
      expect(error).toBeInstanceOf(SourceException);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('cause 透传（Kotlin 第二个参数 throwable）', () => {
    const cause = new Error('root');
    const error = new NetworkError('HTTP 502', cause);
    expect(error.throwable).toBe(cause);
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });
});

describe('TransferWire.kt：长度前缀帧与分块校验', () => {
  const KT = kt('transfer/TransferWire.kt');

  it('写：4 字节大端长度 + UTF-8 JSON；上限 64 KiB', () => {
    expect(KT).toContain('require(bytes.size<=64*1024) { tr("控制消息过大") }');
    expect(KT).toContain('output.writeInt(bytes.size);output.write(bytes);output.flush()');
    const frame = encodeTransferControl({ type: 'hello', n: 1 });
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const length = view.getInt32(0, false);
    expect(length).toBe(frame.byteLength - 4);
    expect(new TextDecoder().decode(frame.subarray(4))).toBe('{"type":"hello","n":1}');
    // 上限：64 KiB
    expect(() => encodeTransferControl({ blob: 'x'.repeat(64 * 1024) })).toThrow('控制消息过大');
    // 数组 / null 不是控制对象
    expect(() => encodeTransferControl([1, 2] as unknown as Record<string, unknown>)).toThrow('无效传输消息');
  });

  it('读：长度必须在 2..64 KiB，且必须是 UTF-8 JSON 对象', () => {
    expect(KT).toContain('require(length in 2..64*1024) { tr("无效传输消息") }');
    expect(KT).toContain('require(header.getString("type")=="chunk" && header.getLong("offset")==offset)');
  });

  it('verifyChunk 三条：次序 / 长度 / 摘要', () => {
    expect(KT).toContain('require(length==header.getInt("length") && length==minOf(CHUNK_SIZE.toLong(),total-offset).toInt() && length>0)');
    expect(KT).toContain('require(sha256(bytes.copyOf(length))==header.getString("sha256"))');

    const chunk = new Uint8Array([1, 2, 3, 4]);
    const digest = transferHash(chunk);
    const total = 4;
    const header = { type: 'chunk', offset: 0, length: 4, sha256: digest };
    expect(() => verifyTransferChunk(header, 0, total, chunk)).not.toThrow();

    // ① 次序错
    expect(() => verifyTransferChunk({ ...header, offset: 1 }, 0, total, chunk)).toThrow('分块次序不正确');
    expect(() => verifyTransferChunk({ ...header, type: 'meta' }, 0, total, chunk)).toThrow('分块次序不正确');
    // ② 长度错（不是 min(CHUNK, total-offset)）
    expect(() => verifyTransferChunk({ ...header, length: 3 }, 0, total, chunk)).toThrow('分块长度不正确');
    expect(() => verifyTransferChunk(header, 0, total, chunk.subarray(0, 3))).toThrow('分块长度不正确');
    // ③ 摘要错
    expect(() => verifyTransferChunk({ ...header, sha256: 'a'.repeat(64) }, 0, total, chunk)).toThrow('传输分块校验失败');
    // 摘要必须是 64 位小写十六进制
    expect(() => verifyTransferChunk({ ...header, sha256: digest.toUpperCase() }, 0, total, chunk)).toThrow('传输分块校验失败');
  });

  it('分块大小固定 1 MiB；跨块时 offset 必须是块边界或末尾', () => {
    expect(TRANSFER_CHUNK_BYTES).toBe(1024 * 1024);
    const total = TRANSFER_CHUNK_BYTES * 2;
    const chunk = new Uint8Array(TRANSFER_CHUNK_BYTES);
    const header = { type: 'chunk', offset: 0, length: TRANSFER_CHUNK_BYTES, sha256: transferHash(chunk) };
    expect(() => verifyTransferChunk(header, 0, total, chunk)).not.toThrow();
    // 非块边界
    expect(() => verifyTransferChunk({ ...header, offset: 1 }, 1, total, chunk)).toThrow('分块次序不正确');
  });

  it('错误类型统一是 TransferProtocolError', () => {
    const attempt = (): void => {
      verifyTransferChunk({ type: 'chunk' }, 0, 1, new Uint8Array([1]));
    };
    expect(attempt).toThrow(TransferProtocolError);
  });
});

describe('ProcessExitDiagnostics.kt：系统退出历史', () => {
  const KT = kt('data/ProcessExitDiagnostics.kt');

  it('@RequiresApi(30) + getHistoricalProcessExitReasons(packageName, 0, 8)', () => {
    expect(KT).toContain('@RequiresApi(30)');
    expect(KT).toContain('manager.getHistoricalProcessExitReasons(context.packageName, 0, 8)');
    expect(PROCESS_EXIT_MAX_RECORDS).toBe(8);
  });

  it('空表 → "No process exit records available."（Kotlin 自己的分支）', () => {
    expect(KT).toContain('if (exits.isEmpty()) return@runCatching "No process exit records available."');
    expect(ProcessExitDiagnostics.read([])).toBe(PROCESS_EXIT_EMPTY_REPORT);
    expect(PROCESS_EXIT_EMPTY_REPORT).toBe('No process exit records available.');
  });

  it('每条记录一行：time/pid/process/reason/status/importance/pssKiB/rssKiB', () => {
    expect(KT).toContain(
      'time=${exit.timestamp} pid=${exit.pid} process=${exit.processName} reason=${exit.reason} status=${exit.status} importance=${exit.importance} pssKiB=${exit.pss} rssKiB=${exit.rss}',
    );
    // ⚠️ 第 2 条 credential 正则（`token|cookie|…\b\s*[:=]\s*[^\r\n]+`）会吃掉**整行**，
    // 所以脱敏样本必须分开放，否则后面的 email / path 根本轮不到 —— 这是 Kotlin 的真实行为。
    const record = (description: string | null, trace: string | null) => ({
      timestamp: 1,
      pid: 2,
      processName: 'p',
      reason: 6,
      status: 1,
      importance: 100,
      pssKiB: 0,
      rssKiB: 0,
      description,
      trace,
    });

    // URL 与路径：各自独立成行
    const urls = ProcessExitDiagnostics.read([record('crash at https://a.com/x', '/data/user/0/x dumped')]);
    expect(urls).not.toContain('https://a.com');
    expect(urls).not.toContain('/data/user/0/x');
    expect(urls).toContain('[url]');
    expect(urls).toContain('[path]');

    // trace 同样过 redact，且带系统段标题
    const traced = ProcessExitDiagnostics.read([record(null, 'user@mail.com')]);
    expect(traced).toContain(PROCESS_EXIT_TRACE_HEADER);
    expect(traced).not.toContain('user@mail.com');
    expect(traced).toContain('[email]');

    // 凭据：Bearer 与 Cookie 整行都被抹掉
    const credential = ProcessExitDiagnostics.read([record('Cookie: sid=abc', 'Bearer zzz')]);
    expect(credential).not.toContain('sid=abc');
    expect(credential).not.toContain('Bearer zzz');
    expect((credential.match(/\[credential\]/g) ?? []).length).toBe(2);
  });

  it('trace 读失败只写一行 trace unavailable，不中断整份报告', () => {
    expect(KT).toContain('trace unavailable: ${it.javaClass.name}');
    expect(KT).toContain('.onFailure { appendLine("trace unavailable: ${it.javaClass.name}") }');
    expect(PROCESS_EXIT_TRACE_UNAVAILABLE_PREFIX).toBe('trace unavailable: ');
  });

  it('整体异常 → "Process exit history unavailable: <类名>"', () => {
    expect(KT).toContain('}.getOrElse { "Process exit history unavailable: ${it.javaClass.name}" }');
    expect(PROCESS_EXIT_UNAVAILABLE_PREFIX).toBe('Process exit history unavailable: ');
    const port = {
      read: async (): Promise<never> => {
        throw new TypeError('boom');
      },
    };
    return expect(ProcessExitDiagnostics.readFromPort(port)).resolves.toBe(
      'Process exit history unavailable: TypeError',
    );
  });

  it('readFromPort 走端口：空数组 → 空表文案；有记录 → 同一份格式化', async () => {
    await expect(ProcessExitDiagnostics.readFromPort({ read: async () => [] })).resolves.toBe(
      PROCESS_EXIT_EMPTY_REPORT,
    );
    const port = {
      read: async () => [
        {
          timestamp: 5,
          pid: 6,
          processName: 'n',
          reason: 3,
          status: 0,
          importance: 100,
          pssKiB: 1,
          rssKiB: 2,
          description: 'low memory',
          trace: null,
        },
      ],
    };
    await expect(ProcessExitDiagnostics.readFromPort(port)).resolves.toContain('reason=3');
  });

  it('maxRecords 生效（Kotlin 的 8 条上限）', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      timestamp: i,
      pid: i,
      processName: 'p',
      reason: 4,
      status: 0,
      importance: 100,
      pssKiB: 0,
      rssKiB: 0,
      description: null,
      trace: null,
    }));
    const report = ProcessExitDiagnostics.read(many);
    expect(report.split('time=').length - 1).toBe(PROCESS_EXIT_MAX_RECORDS);
    expect(report).toContain('time=0 ');
    expect(report).not.toContain('time=8 ');
  });

  it('旧路由面包屑改名为 RouteExitBreadcrumbs（与 Kotlin 语义无关的界面态）', () => {
    const breadcrumbs = new RouteExitBreadcrumbs();
    breadcrumbs.setRoute('comicReader');
    breadcrumbs.note('page', '12');
    expect(breadcrumbs.snapshot()).toEqual({ route: 'comicReader', note: 'page=12' });
    const store = { getItem: (key: string): string | null => (key === 'process-exit-evidence' ? '{}' : null) };
    expect(RouteExitBreadcrumbs.crashedLastTime(store)).toBe(true);
    expect(RouteExitBreadcrumbs.crashedLastTime({ getItem: () => null })).toBe(false);
  });
});

describe('StartupDiagnostics.redact / readLimited', () => {
  const KT = kt('data/StartupDiagnostics.kt');

  it('六条正则按 Kotlin 的顺序替换', () => {
    // Kotlin 源码里的反斜杠还要再转义一层，按三段子串分别断言，不赌层数。
    expect(KT).toContain('(?i)(?:https?|wss?)://[^');
    expect(KT).toContain('"[url]"');
    expect(KT).toContain('"[credential]"');
    // Kotlin 里 `[credential]` 出现 3 次（authorization/cookie 行、Bearer、secret|password）。
    expect(KT.split('[credential]').length - 1).toBe(3);
    // 顺序即语义：四个标签的首次出现位置必须严格递增（url → credential → email → path）。
    const orderIdx = ['[url]', '[credential]', '[email]', '[path]'].map((tag) => KT.indexOf(`"${tag}"`));
    for (let i = 1; i < orderIdx.length; i += 1) {
      expect(orderIdx[i]).toBeGreaterThan(orderIdx[i - 1] as number);
    }
    expect(KT).toContain('"[email]"');
    expect(KT).toContain('"[path]"');

    expect(startupRedact('see https://a.com/p?q=1 now')).toBe('see [url] now');
    expect(startupRedact('Cookie: sid=abc')).toBe('[credential]');
    // 第 2 条先于第 3 条：整行都要被抹掉，不能只剩 `Cookie: `
    expect(startupRedact('Cookie: Bearer abc')).toBe('[credential]');
    expect(startupRedact('Bearer abc123')).toBe('[credential]');
    expect(startupRedact('password')).toBe('[credential]');
    expect(startupRedact('secret-key-1')).toBe('[credential]');
    expect(startupRedact('a@b.com')).toBe('[email]');
    expect(startupRedact('C:\\Users\\x\\a.txt')).toBe('[path]');
    expect(startupRedact('/storage/emulated/0/a')).toBe('[path]');
    expect(startupRedact('/home/u/a')).toBe('[path]');
    // 普通文本原样
    expect(startupRedact('normal text 正常')).toBe('normal text 正常');
  });

  it('readLimited 按**字节**截断，读满时追加固定后缀', () => {
    expect(KT).toContain('if (remaining == 0) "\\n[trace/file size limit reached]" else ""');
    expect(STARTUP_TRACE_LIMIT_BYTES).toBe(128 * 1024);
    expect(STARTUP_TRACE_TRUNCATED_SUFFIX).toBe('\n[trace/file size limit reached]');

    expect(readLimitedText('abc', 10)).toBe('abc');
    expect(readLimitedText('abc', 3)).toBe(`abc${STARTUP_TRACE_TRUNCATED_SUFFIX}`);
    expect(readLimitedText('abcdef', 3)).toBe(`abc${STARTUP_TRACE_TRUNCATED_SUFFIX}`);
    // 多字节字符被截半时用 U+FFFD 而非丢字（Kotlin `toString(UTF_8)` 同款）
    const truncated = readLimitedText('汉字', 4);
    expect(truncated.startsWith('汉')).toBe(true);
    expect(truncated).toContain('\uFFFD');
    expect(truncated.endsWith(STARTUP_TRACE_TRUNCATED_SUFFIX)).toBe(true);
  });

  it('128 KiB 上限在真实大小上生效', () => {
    const big = 'x'.repeat(STARTUP_TRACE_LIMIT_BYTES + 10);
    const out = readLimitedText(big);
    expect(out.length).toBe(STARTUP_TRACE_LIMIT_BYTES + STARTUP_TRACE_TRUNCATED_SUFFIX.length);
  });
});

describe('ProcessExitHistoryPort：web / ios-native 三层落点', () => {
  it('Web：没有证据 → 空表（走 Kotlin 的空表文案）', async () => {
    expect(WEB_EXIT_EVIDENCE_KEY).toBe('process-exit-evidence');
    const port = createWebProcessExitHistoryPort({ getItem: () => null });
    await expect(port.read(8)).resolves.toEqual([]);
  });

  it('Web：留下崩溃证据 → 一条 REASON_CRASH 记录，description 带路由与说明', async () => {
    const evidence = JSON.stringify({ timestamp: 1700000000000, route: 'comicReader', note: 'page=12' });
    const port = createWebProcessExitHistoryPort({
      getItem: (key: string) => (key === WEB_EXIT_EVIDENCE_KEY ? evidence : null),
    });
    const records = await port.read(8);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: 1700000000000,
      processName: 'web',
      reason: 4,
      importance: 100,
      trace: null,
    });
    expect(records[0]?.description).toBe('route=comicReader note=page=12');
  });

  it('Web：非 JSON 的旧证据（纯文本路由）也能解析', async () => {
    const port = createWebProcessExitHistoryPort({ getItem: () => 'comicReader' });
    const records = await port.read(8);
    expect(records[0]?.description).toBe('route=comicReader');
  });

  it('Web：maxRecords <= 0 → 空表', async () => {
    const port = createWebProcessExitHistoryPort({ getItem: () => '{"route":"x"}' });
    await expect(port.read(0)).resolves.toEqual([]);
  });

  it('ios-native：插件缺 processExitReasons 时按空表处理（不伪造记录）', async () => {
    const module = await import('@platform/ios-native/processExitHistory');
    const port = module.createNativeProcessExitHistoryPort();
    // 测试环境不是原生平台 → 直接空表；
    // 即便是原生平台、插件没有该方法，也只 warn 一次后返回空表（见实现）。
    await expect(port.read(8)).resolves.toEqual([]);
  });
});

describe('LibraryUiState.kt：八种状态', () => {
  const KT = kt('library/LibraryUiState.kt');

  it('四个 object + 四个 data class，字段逐条一致', () => {
    expect(KT).toContain('object Loading : LibraryUiState()');
    expect(KT).toContain('object Empty : LibraryUiState()');
    expect(KT).toContain('object Ready : LibraryUiState()');
    expect(KT).toContain('object Searching : LibraryUiState()');
    expect(KT).toContain('data class SearchResults(val results: List<SearchBook>, val loading: Boolean = false)');
    expect(KT).toContain('data class AggregateResults(');
    expect(KT).toContain('data class Downloading(val taskId: String, val progress: Int)');
    expect(KT).toContain('data class Error(val error: LibraryError)');

    expect(LibraryUiLoading).toEqual({ kind: 'Loading' });
    expect(LibraryUiEmpty).toEqual({ kind: 'Empty' });
    expect(LibraryUiReady).toEqual({ kind: 'Ready' });
    expect(LibraryUiSearching).toEqual({ kind: 'Searching' });
  });

  it('SearchResults 的 loading 默认 false；AggregateResults 带 running', () => {
    expect(librarySearchResults([]).kind).toBe('SearchResults');
    const searchState = librarySearchResults([]);
    expect(searchState.kind === 'SearchResults' && searchState.loading).toBe(false);
    const searchBusy = librarySearchResults([], true);
    expect(searchBusy.kind === 'SearchResults' && searchBusy.loading).toBe(true);
    expect(libraryAggregateResults([], true)).toEqual({
      kind: 'AggregateResults',
      groups: [],
      running: true,
    });
  });

  it('AggregateGroup 的 loading 默认 false、failure 默认 null', () => {
    expect(KT).toContain('val failure: com.example.source.SourceException? = null');
    const group = libraryAggregateGroup('s1', '源一', [], null);
    expect(group).toMatchObject({
      sourceId: 's1',
      sourceName: '源一',
      books: [],
      error: null,
      loading: false,
      failure: null,
    });
  });

  it('Downloading.progress 是 Int（百分比整数），Error 带 LibraryError', () => {
    expect(KT).toContain('val progress: Int');
    const downloading = libraryDownloading('t1', 42);
    expect(downloading).toEqual({ kind: 'Downloading', taskId: 't1', progress: 42 });
    const error = libraryErrorState({ kind: 'Unknown', message: 'x' } as never);
    expect(error.kind).toBe('Error');
  });

  it('八种状态的 kind 互不相同', () => {
    const kinds = [
      LibraryUiLoading.kind,
      LibraryUiEmpty.kind,
      LibraryUiReady.kind,
      LibraryUiSearching.kind,
      librarySearchResults([]).kind,
      libraryAggregateResults([], false).kind,
      libraryDownloading('t', 0).kind,
      libraryErrorState({} as never).kind,
    ];
    expect(new Set(kinds).size).toBe(8);
  });
});

describe('PufeiImageCacheRetry.kt：四道守卫', () => {
  const KT = kt('source/PufeiImageCacheRetry.kt');

  function chainOf(options: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    status?: number;
    canceled?: boolean;
  }) {
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      chain: {
        request: {
          url: options.url ?? 'https://img.6wm.top/a.jpg',
          method: options.method ?? 'GET',
          headers: options.headers ?? { Referer: PUFEI_IMAGE_REFERER },
        },
        proceed: async (req: Record<string, unknown>) => {
          calls.push(req);
          return { status: options.status ?? 200 };
        },
        isCanceled: () => options.canceled === true,
      },
    };
  }

  it('主机后缀 .6wm.top、Referer manhuafree、状态 500..599 才重试', () => {
    expect(PUFEI_IMAGE_HOST_SUFFIX).toBe('.6wm.top');
    expect(PUFEI_IMAGE_REFERER).toBe('https://manhuafree.com/');
    expect(KT).toContain('!host.endsWith(".6wm.top")');
    expect(KT).toContain('request.header("Referer") != "https://manhuafree.com/"');
    expect(KT).toContain('response.code !in 500..599');
  });

  it('命中四道守卫 → 再发一次，URL 带分钟桶、Cache-Control: no-cache', async () => {
    expect(KT).toContain('setQueryParameter("pufei_retry", (System.currentTimeMillis() / 60_000).toString())');
    expect(KT).toContain('.header("Cache-Control", "no-cache")');
    expect(PUFEI_RETRY_PARAM).toBe('pufei_retry');

    const { chain, calls } = chainOf({ status: 502 });
    const response = await intercept(chain as never);
    expect(response.status).toBe(502);
    expect(calls).toHaveLength(2);
    const retried = calls[1] as { url: string; headers: Record<string, string> };
    const url = new URL(retried.url);
    expect(url.searchParams.get(PUFEI_RETRY_PARAM)).toMatch(/^\d+$/);
    expect(url.pathname).toBe('/a.jpg');
    expect(retried.headers['Cache-Control']).toBe('no-cache');
    // 原有头保留
    expect(retried.headers.Referer).toBe(PUFEI_IMAGE_REFERER);
  });

  it('任一道守卫不成立 → 原样返回，不再发第二次', async () => {
    const cases = [
      { name: '非 GET', options: { method: 'POST', status: 502 } },
      { name: '别的 host', options: { url: 'https://img.example.com/a.jpg', status: 502 } },
      { name: 'Referer 不对', options: { headers: { Referer: 'https://other/' }, status: 502 } },
      { name: '状态 404', options: { status: 404 } },
      { name: '状态 200', options: { status: 200 } },
    ];
    for (const item of cases) {
      const { chain, calls } = chainOf(item.options);
      const response = await intercept(chain as never);
      expect(response.status).toBe(item.options.status ?? 200);
      expect(calls, item.name).toHaveLength(1);
    }
  });

  it('已取消 → 抛 Canceled（Kotlin `throw IOException("Canceled")`）', async () => {
    expect(KT).toContain('if (chain.call().isCanceled()) throw IOException("Canceled")');
    const { chain } = chainOf({ status: 503, canceled: true });
    await expect(intercept(chain as never)).rejects.toThrow('Canceled');
  });

  it('分钟桶：同一分钟内的重试 URL 相同（共享边缘缓存）', async () => {
    const nowSpy = Date.now;
    Date.now = () => 1_700_000_040_000; // 固定分钟
    try {
      const a = chainOf({ status: 500 });
      const b = chainOf({ status: 500 });
      await intercept(a.chain as never);
      await intercept(b.chain as never);
      const urlOf = (calls: Array<Record<string, unknown>>): string =>
        new URL((calls[1] as { url: string }).url).searchParams.get(PUFEI_RETRY_PARAM) ?? '';
      expect(urlOf(a.calls)).toBe(urlOf(b.calls));
      expect(urlOf(a.calls)).toBe(String(Math.floor(1_700_000_040_000 / 60_000)));
    } finally {
      Date.now = nowSpy;
    }
  });

  it('大小写不敏感的头查找（`referer:` 也要命中）', async () => {
    const { chain, calls } = chainOf({ status: 502, headers: { referer: PUFEI_IMAGE_REFERER } });
    await intercept(chain as never);
    expect(calls).toHaveLength(2);
    // 新头的写入要摘掉旧的任何大小写形式
    const headers = (calls[1] as { headers: Record<string, string> }).headers;
    const cacheControlKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'cache-control');
    expect(cacheControlKeys).toEqual(['Cache-Control']);
  });
});

describe('CjkFoldMap.kt：繁简折叠全表', () => {
  const KT = kt('source/anilist/CjkFoldMap.kt');
  const TS = readFileSync('src/core/data/cjkFoldMap.ts', 'utf8');

  function pairsOf(source: string, pattern: RegExp): string | null {
    const match = pattern.exec(source);
    return match === null ? null : (match[1] ?? null);
  }

  it('两张表的字符串**逐字相同**（成对压缩存储）', () => {
    const kotlinPairs = pairsOf(KT, /private const val PAIRS\s*=\s*"([^"]+)"/);
    const tsPairs = pairsOf(TS, /const PAIRS\s*=\s*\n?\s*'([^']+)'/);
    expect(kotlinPairs).not.toBeNull();
    expect(tsPairs).not.toBeNull();
    expect(tsPairs).toBe(kotlinPairs);
    // 成对存储 → 长度为偶数
    expect((tsPairs ?? '').length % 2).toBe(0);
  });

  it('pair 数量 = 字符串长度 / 2', () => {
    const tsPairs = pairsOf(TS, /const PAIRS\s*=\s*\n?\s*'([^']+)'/) ?? '';
    expect(CJK_FOLD_PAIR_COUNT).toBe(tsPairs.length / 2);
    // 实测值：851 对（生成脚本只收「折叠后发生变化」的字，不等于全量繁简表）。
    expect(CJK_FOLD_PAIR_COUNT).toBe(851);
  });

  it('逐对验证 foldChar（全表，约 1000+ 对）', () => {
    const tsPairs = pairsOf(TS, /const PAIRS\s*=\s*\n?\s*'([^']+)'/) ?? '';
    let checked = 0;
    for (let i = 0; i + 1 < tsPairs.length; i += 2) {
      const trad = tsPairs[i] as string;
      const simp = tsPairs[i + 1] as string;
      expect(foldChar(trad), `U+${(trad.codePointAt(0) ?? 0).toString(16)}`).toBe(simp);
      checked += 1;
    }
    expect(checked).toBe(CJK_FOLD_PAIR_COUNT);
  });

  it('未收录的字符原样返回（含简体与 ASCII）', () => {
    expect(KT).toContain('fun fold(c: Char): Char = MAP[c] ?: c');
    expect(foldChar('无')).toBe('无'); // 已是简体
    expect(foldChar('a')).toBe('a');
    expect(foldChar('1')).toBe('1');
    expect(foldChar('')).toBe('');
  });

  it('抽查代表性条目（Kotlin KDoc 里点名的「無職転生 → 无职转生」）', () => {
    expect(KT).toContain('无职转生');
    expect(foldChar('無')).toBe('无');
    expect(foldChar('職')).toBe('职');
    expect(foldChar('転')).toBe('转');
    expect(['無', '職', '転', '生'].map(foldChar).join('')).toBe('无职转生');
  });
});
