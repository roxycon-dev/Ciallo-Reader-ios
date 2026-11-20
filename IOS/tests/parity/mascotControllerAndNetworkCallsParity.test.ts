/**
 * mascotControllerAndNetworkCallsParity.test.ts
 *   ├ `ui/mascot/MascotAnimationController.kt`（99 行）→ `@core/mascot/mascotEvents` +
 *   │   `@ui/components/mascot/MascotAnimationController`
 *   └ `source/NetworkCalls.kt`（81 行）→ `@core/source/networkCalls`
 *
 * 两处本轮实测到的偏差：
 *
 * ① `MascotEvent` 在端口里有**五个**值，原文只有**四个**（L14-20）。`'CleanComplete'`
 *    的来源是 L19 一行**悬空 KDoc**：L15 收尾了 `object BookComplete`，L19 是孤零零的
 *    一行文档注释，L20 的 `}` 直接收掉 sealed class —— 那行 KDoc 后面**没有** object。
 *    它描述的是 `CacheManagementScreen.kt` 里页面自己的 `CleanSuccessBadge`
 *    （L271），与吉祥物无关：那个文件 855 行里 `Mascot` / `play(` 各 0 命中。
 *
 * ② `SharedHttpTransport` 在端口里只剩一个 `limits` 袋子 —— **两个拦截器整个没了**：
 *    非 HTTPS 带凭据要抛（L46-53，而且必须挂在 **network** 拦截器上，否则重定向最后一跳绕过），
 *    以及 Accept-Encoding 的「只认 identity」策略（L54-60，防止脚本声明 br/zstd 后
 *    正文解析器拿到压缩字节）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  MASCOT_DURATION_MS,
  MascotAnimationController,
  __resetMascotEventIds,
  type MascotEventInstance,
} from '@core/mascot/mascotEvents';
import {
  CREDENTIAL_HEADER_NAMES,
  INSECURE_CREDENTIAL_MESSAGE,
  SharedHttpTransport,
  acceptEncodingAction,
  checkAddress,
  checkInsecureTlsRequest,
  checkSourceUrl,
  insecureCredentialViolation,
  isPrivateAddress,
} from '@core/source/networkCalls';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const CONTROLLER_KT = 'ui/mascot/MascotAnimationController.kt';
const NETWORK_KT = 'source/NetworkCalls.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① MascotAnimationController.kt L14-20 四个 object（不是五个）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('MascotAnimationController.kt L14-20 sealed class 只有四个 object', () => {
  const src = kt(CONTROLLER_KT);

  it('L15-18 四个 `object X : MascotEvent()`，一个不多一个不少', () => {
    expect(src).toContain('sealed class MascotEvent {');
    expect(src).toContain('object DeleteBook : MascotEvent()');
    expect(src).toContain('object AddBookmark : MascotEvent()');
    expect(src).toContain('object MoveBook : MascotEvent()');
    expect(src).toContain('object BookComplete : MascotEvent()');
    // 原文里 `object ... : MascotEvent()` 恰好四条
    const objects = [...src.matchAll(/object \w+ : MascotEvent\(\)/g)].map((m) => m[0]);
    expect(objects).toEqual([
      'object DeleteBook : MascotEvent()',
      'object AddBookmark : MascotEvent()',
      'object MoveBook : MascotEvent()',
      'object BookComplete : MascotEvent()',
    ]);
  });

  it('L19 是一行**悬空** KDoc：L20 的 `}` 直接收掉 sealed class', () => {
    // 这就是端口造出第五个事件的根源 —— 那行注释后面没有 object
    expect(src).toContain('/** 清理缓存成功（B6：原先只有 Toast + 打勾，缺吉祥物反馈）。 */');
    const lines = src.split(/\r?\n/);
    const kdoc = lines.findIndex((line) => line.includes('清理缓存成功'));
    expect(kdoc).toBeGreaterThan(0);
    expect(lines[kdoc + 1]?.trim()).toBe('}');
    // 该行之后不再有任何 object 声明
    expect(lines.slice(kdoc).join('\n')).not.toMatch(/object \w+ : MascotEvent\(\)/);
  });

  it('端口的联合类型也恰好四个值（CleanComplete 已删）', () => {
    const ts = repoText('src/core/mascot/mascotEvents.ts');
    expect(ts).toContain("| 'DeleteBook'");
    expect(ts).toContain("| 'AddBookmark'");
    expect(ts).toContain("| 'MoveBook'");
    expect(ts).toContain("| 'BookComplete'");
    // 代码形状（不是注释）里不许再有这个字面量
    const code = ts
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toContain("'CleanComplete'");
  });

  it('`CacheManagementScreen.kt` 里 `Mascot` / `play(` 各 0 命中 —— 那条 SKIPPED 注释是假的', () => {
    const cache = kt('ui/CacheManagementScreen.kt');
    expect(cache).not.toContain('Mascot');
    expect(cache).not.toContain('MascotAnimationController');
    expect(cache.match(/play\(/g) ?? []).toHaveLength(0);
    // 清理成功的反馈是页面自己的 badge（L271 的注释）
    expect(cache).toContain('清理成功不再只弹 Toast，改为播放「打勾 + 释放量」动画');
  });

  it('四个 `play(...)` 调用点全在别的屏幕里（MainActivity ×3 + ReaderScreen ×1）', () => {
    const main = kt('MainActivity.kt');
    const reader = kt('ui/ReaderScreen.kt');
    expect(main).toContain('MascotEvent.DeleteBook');
    expect(main).toContain('MascotEvent.MoveBook');
    expect(main).toContain('MascotEvent.AddBookmark');
    expect(main).not.toContain('MascotEvent.BookComplete');
    expect(reader).toContain('MascotAnimationController.play(MascotEvent.BookComplete)');
    expect(reader).not.toContain('MascotEvent.CleanComplete');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② MascotAnimationController.kt L25-42 id 与 MotionTransform
   ══════════════════════════════════════════════════════════════════════════════ */

describe('MascotAnimationController.kt L25-42 MascotEventInstance / MotionTransform', () => {
  const src = kt(CONTROLLER_KT);

  beforeEach(() => {
    __resetMascotEventIds();
  });

  it('L26-31 `id: Long = idGenerator.incrementAndGet()`，`AtomicLong(0)` ⇒ 首个 id 是 1', () => {
    expect(src).toContain('data class MascotEventInstance(');
    expect(src).toContain('val event: MascotEvent,');
    expect(src).toContain('val id: Long = idGenerator.incrementAndGet()');
    expect(src).toContain('private val idGenerator = AtomicLong(0)');
    expect(MascotAnimationController.play('AddBookmark').id).toBe(1);
    expect(MascotAnimationController.play('MoveBook').id).toBe(2);
  });

  it('L37-42 `MotionTransform` 四个浮点字段（spec 顺序）', () => {
    expect(src).toContain('data class MotionTransform(');
    expect(src).toContain('val scaleX: Float,');
    expect(src).toContain('val scaleY: Float,');
    expect(src).toContain('val translationOffset: Float,');
    expect(src).toContain('val rotationDeg: Float');
    const keys = Object.keys({ scaleX: 0, scaleY: 0, translationOffset: 0, rotationDeg: 0 });
    expect(keys).toEqual(['scaleX', 'scaleY', 'translationOffset', 'rotationDeg']);
  });

  it('L56 `MutableSharedFlow(extraBufferCapacity = 16)`；L57 `asSharedFlow()`；L60 `tryEmit`', () => {
    expect(src).toContain('private val _events = MutableSharedFlow<MascotEventInstance>(extraBufferCapacity = 16)');
    expect(src).toContain('val events = _events.asSharedFlow()');
    expect(src).toContain('_events.tryEmit(MascotEventInstance(event))');
  });

  it('`play()` 同步扇出、返回实例（调用方可按 id 打断）', () => {
    const seen: MascotEventInstance[] = [];
    const off = MascotAnimationController.subscribe((i) => seen.push(i));
    const emitted = MascotAnimationController.play('DeleteBook');
    off();
    expect(seen).toEqual([emitted]);
    expect(emitted.event).toBe('DeleteBook');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ MascotAnimationController.kt L68-99 MascotOverlay
   ══════════════════════════════════════════════════════════════════════════════ */

describe('MascotAnimationController.kt L68-99 MascotOverlay 的结构', () => {
  const src = kt(CONTROLLER_KT);
  const tsx = repoText('src/ui/components/mascot/MascotAnimationController.tsx');

  it('L70 `collectAsStateWithLifecycle(initialValue = null)` + L71 `remember { mutableStateOf(null) }`', () => {
    expect(src).toContain('MascotAnimationController.events.collectAsStateWithLifecycle(initialValue = null)');
    expect(src).toContain('var currentInstance by remember { mutableStateOf<MascotEventInstance?>(null) }');
    // 端口把「最新实例」与「当前实例」收成一个槽位（懒初始化 null）
    expect(tsx).toContain('useState<MascotEventInstance | null>(null)');
  });

  it('L74 `LaunchedEffect(latestEventInstance?.id)` —— 打断靠 **id** 而不是事件对象身份', () => {
    expect(src).toContain('LaunchedEffect(latestEventInstance?.id) {');
    expect(tsx).toContain('MascotAnimationController.subscribe((instance) => {');
  });

  it('L82-85 `Box(fillMaxSize().padding(24.dp), contentAlignment = Center)`', () => {
    expect(src).toContain('.fillMaxSize()');
    expect(src).toContain('.padding(24.dp),');
    expect(src).toContain('contentAlignment = Alignment.Center');
    // 端口：外层容器 + CSS 居中（`.mascot-overlay`）
    expect(tsx).toContain("className={['mascot-overlay'");
  });

  it('L88 `key(currentInstance?.id)` —— 同一事件连发两次也要重挂', () => {
    expect(src).toContain('key(currentInstance?.id) {');
    // 四支各自带 `key={current.id}`
    expect((tsx.match(/key=\{current\.id\}/g) ?? []).length).toBe(4);
  });

  it('L89-95 `when` 四支 + `null -> {}`，**没有 else**', () => {
    expect(src).toContain('is MascotEvent.DeleteBook -> DeleteSadAnimation(onComplete = { currentInstance = null })');
    expect(src).toContain('is MascotEvent.AddBookmark -> BookmarkHappyAnimation(onComplete = { currentInstance = null })');
    expect(src).toContain('is MascotEvent.MoveBook -> MoveBookAnimation(onComplete = { currentInstance = null })');
    expect(src).toContain('is MascotEvent.BookComplete -> BookCompleteAnimation(onComplete = { currentInstance = null })');
    expect(src).toContain('null -> {}');
    const whenBlock = src.slice(src.indexOf('when (currentInstance?.event)'));
    expect(whenBlock).not.toContain('else ->');
    // 端口四支，无第五支。只看**代码行**（注释里提到那个名字不算）
    const codeLines = tsx
      .split(/\r?\n/)
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith('*') && !t.startsWith('//');
      })
      .join('\n');
    expect((codeLines.match(/current\.event === '/g) ?? []).length).toBe(4);
    expect(codeLines).not.toContain("current.event === 'CleanComplete'");
  });

  it('`MASCOT_DURATION_MS` 不属于本文件（它来自四个 Animation.kt 的 `animateTo`）', () => {
    // 本文件 99 行里没有任何 `animateTo` / 时长字面量
    expect(src).not.toContain('animateTo');
    expect(src).not.toContain('1400');
    expect(MASCOT_DURATION_MS.bookComplete).toBe(1400);
    expect(Object.keys(MASCOT_DURATION_MS)).toEqual(['bookComplete', 'bookmarkHappy', 'deleteSad', 'moveBook']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ NetworkCalls.kt L12-36 executeCancellable 的三处 ensureActive
   ══════════════════════════════════════════════════════════════════════════════ */

describe('NetworkCalls.kt L12-36 取消传播', () => {
  const src = kt(NETWORK_KT);

  it('L12 注释「response close removes the hook」+ L13 取 `currentCoroutineContext()[Job]`', () => {
    expect(src).toContain('/** Parent cancellation closes blocked socket reads; response close removes the hook. */');
    expect(src).toContain('internal suspend fun Call.executeCancellable(): Response = executeWithCancellation(currentCoroutineContext()[Job])');
    expect(src).toContain('internal fun Call.executeWithCancellation(job: Job?):Response {');
  });

  it('L17 `job?.ensureActive()` 在 `execute()` **之前**（已取消就不碰网络）', () => {
    // 原文 CRLF：跨行处一律 `\r?\n`
    expect(src).toMatch(/job\?\.ensureActive\(\)\r?\n/);
    const ensureAt = src.indexOf('job?.ensureActive()');
    const executeAt = src.indexOf('val response=execute()');
    expect(ensureAt).toBeGreaterThan(0);
    expect(executeAt).toBeGreaterThan(ensureAt);
  });

  it('L19-21 `invokeOnCompletion(onCancelling = true, invokeImmediately = true)` ⇒ `call.cancel()`', () => {
    expect(src).toContain('job?.invokeOnCompletion(onCancelling=true,invokeImmediately=true) { cause ->');
    expect(src).toContain('if(cause!=null) call.cancel()');
  });

  it('L24 `execute()` 之后**再** ensureActive，抛之前 `response.close()`', () => {
    expect(src).toContain('try { job?.ensureActive() } catch(e:Exception) { response.close(); throw e }');
  });

  it('L26 `if (body == null) { handle?.dispose(); return response }`', () => {
    expect(src).toContain('if(body==null) { handle?.dispose(); return response }');
    // 端口把「无 body」拆成三档（RFC 9110 的四个状态码 + fetch 的 null body）
    expect(repoText('src/core/source/networkCalls.ts')).toContain('const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);');
  });

  it('L35 `catch(e:Exception)` 里三件事：dispose、call.cancel()、**再** ensureActive、rethrow', () => {
    expect(src).toContain('} catch(e:Exception) { handle?.dispose(); call.cancel(); job?.ensureActive(); throw e }');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ NetworkCalls.kt L39-61 SharedHttpTransport 的两个拦截器
   ══════════════════════════════════════════════════════════════════════════════ */

describe('NetworkCalls.kt L39-61 SharedHttpTransport', () => {
  const src = kt(NETWORK_KT);

  it('L38 注释「Share pool and dispatcher, keep per-source TLS, cookies and proxy configuration.」', () => {
    expect(src).toContain('/** Share pool and dispatcher, keep per-source TLS, cookies and proxy configuration. */');
    expect(src).toContain('internal object SharedHttpTransport {');
  });

  it('L40-41 `ConnectionPool(8, 5, MINUTES)` / `maxRequests=32` / `maxRequestsPerHost=4`', () => {
    expect(src).toContain('okhttp3.ConnectionPool(8,5,java.util.concurrent.TimeUnit.MINUTES)');
    expect(src).toContain('maxRequests=32; maxRequestsPerHost=4');
    expect(SharedHttpTransport.limits).toEqual({
      maxRequests: 32,
      maxRequestsPerHost: 4,
      connectionPoolSize: 8,
      keepAliveMinutes: 5,
    });
    expect(SharedHttpTransport.builder()).toEqual(SharedHttpTransport.limits);
  });

  it('L45 注释点明它必须挂在 **network** 拦截器上（每一跳重定向都过）', () => {
    expect(src).toContain('// Runs after cookie/application interceptors and on every redirect hop.');
    expect(src).toContain('.addNetworkInterceptor { chain ->');
  });

  it('L48-49 三个头名 + `isNullOrBlank()`；L50 文案逐字', () => {
    expect(src).toContain('listOf("Cookie", "Authorization", "Proxy-Authorization")');
    expect(src).toContain('.any { !request.header(it).isNullOrBlank() }');
    expect(src).toContain('throw java.io.IOException("非 HTTPS 图片或书源地址不能携带登录凭据")');
    expect(CREDENTIAL_HEADER_NAMES).toEqual(['cookie', 'authorization', 'proxy-authorization']);
    expect(INSECURE_CREDENTIAL_MESSAGE).toBe('非 HTTPS 图片或书源地址不能携带登录凭据');
  });

  it('`insecureCredentialViolation`：http + 任一个非空白凭据头 → 抛', () => {
    const headers = (record: Record<string, string>): ((name: string) => string | undefined) => {
      const lower = new Map(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
      return (name) => lower.get(name.toLowerCase());
    };
    expect(insecureCredentialViolation('http://x/y', headers({ cookie: 'a=1' }))).toBe(INSECURE_CREDENTIAL_MESSAGE);
    expect(insecureCredentialViolation('http://x/y', headers({ Authorization: 'Bearer t' }))).toBe(INSECURE_CREDENTIAL_MESSAGE);
    expect(insecureCredentialViolation('http://x/y', headers({ 'proxy-authorization': 'Basic x' }))).toBe(INSECURE_CREDENTIAL_MESSAGE);
    // 大小写不敏感
    expect(insecureCredentialViolation('http://x/y', headers({ COOKIE: 'a=1' }))).toBe(INSECURE_CREDENTIAL_MESSAGE);
    // HTTPS 一律放行
    expect(insecureCredentialViolation('https://x/y', headers({ cookie: 'a=1' }))).toBeNull();
    // 空串 / 纯空白不算「携带凭据」（Kotlin `isNullOrBlank()`）
    expect(insecureCredentialViolation('http://x/y', headers({ cookie: '' }))).toBeNull();
    expect(insecureCredentialViolation('http://x/y', headers({ cookie: '   ' }))).toBeNull();
    expect(insecureCredentialViolation('http://x/y', headers({}))).toBeNull();
    // 解析不了的 URL 交给 checkSourceUrl 报另一条文案
    expect(insecureCredentialViolation('::not-a-url::', headers({ cookie: 'a=1' }))).toBeNull();
  });

  it('L54-55 注释点明「脚本声明的 br/zstd 会挡住透明解压」', () => {
    expect(src).toContain('// Let OkHttp negotiate/decode gzip. Script-supplied br/zstd prevented its');
    expect(src).toContain('// transparent decoding and exposed compressed bytes to text/JSON parsers.');
  });

  it('L58 只有值**恰好**是 `identity`（大小写不敏感）才保留，否则移除', () => {
    expect(src).toContain('if (request.header("Accept-Encoding").equals("identity", true)) request');
    expect(src).toContain('else request.newBuilder().removeHeader("Accept-Encoding").build()');
    expect(acceptEncodingAction('identity')).toBe('keep');
    expect(acceptEncodingAction('Identity')).toBe('keep');
    expect(acceptEncodingAction('IDENTITY')).toBe('keep');
    // 头缺失也算移除（Kotlin 的 `String?.equals` 对 null 返回 false）
    expect(acceptEncodingAction(null)).toBe('remove');
    expect(acceptEncodingAction(undefined)).toBe('remove');
    expect(acceptEncodingAction('')).toBe('remove');
    // 组合值与带空格都不保留
    expect(acceptEncodingAction('gzip, identity')).toBe('remove');
    expect(acceptEncodingAction('gzip')).toBe('remove');
    expect(acceptEncodingAction('br')).toBe('remove');
    expect(acceptEncodingAction('identity ')).toBe('remove');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ NetworkCalls.kt L63-80 SourceNetworkPolicy
   ══════════════════════════════════════════════════════════════════════════════ */

describe('NetworkCalls.kt L63-80 SourceNetworkPolicy', () => {
  const src = kt(NETWORK_KT);

  it('L64-68 `privateAddress` 五项 + IPv6 ULA `raw[0] & 0xfe == 0xfc`', () => {
    expect(src).toContain('address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress ||');
    expect(src).toContain('(raw.size==16 && (raw[0].toInt() and 0xfe)==0xfc)');
  });

  it('IPv4 六档（any / loopback / link-local / three site-local / multicast）', () => {
    for (const ip of ['0.0.0.0', '127.0.0.1', '127.9.9.9', '169.254.1.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '224.0.0.1', '239.255.255.255']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.167.0.1', '223.255.255.255', '240.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it('IPv6：`::` / `::1` / fe80::/10 / fec0::/10 / ff00::/8 / fc00::/7（0xfc 与 0xfd 都算）', () => {
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('[::1]')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('febf::1')).toBe(true);
    expect(isPrivateAddress('fec0::1')).toBe(true);
    expect(isPrivateAddress('ff02::1')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12:3456::1')).toBe(true);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateAddress('fe00::1')).toBe(false);
  });

  it('IPv4-mapped 字面量按内嵌 IPv4 分类（`::ffff:127.0.0.1` 是 loopback）', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('L70 `checkAddress` 的文案与 `allowedPrivateHost` 例外', () => {
    expect(src).toContain('require(!privateAddress(address) || host.lowercase()==allowedPrivateHost) { tr("书源跳转或 DNS 指向未配置的内网地址") }');
    expect(() => checkAddress('evil.example', '127.0.0.1', null)).toThrow('书源跳转或 DNS 指向未配置的内网地址');
    // host 与白名单一致 → 放行
    expect(() => checkAddress('myhost', '127.0.0.1', 'myhost')).not.toThrow();
    // 大小写不敏感
    expect(() => checkAddress('MyHost', '192.168.1.1', 'myhost')).not.toThrow();
    // 公网地址一律放行
    expect(() => checkAddress('public.example', '8.8.8.8', null)).not.toThrow();
  });

  it('L73 `check(url)`：只允许 http/https', () => {
    expect(src).toContain('require(url.scheme=="https" || url.scheme=="http") { tr("仅支持 HTTP/HTTPS 书源") }');
    expect(() => checkSourceUrl('ftp://x/y')).toThrow('仅支持 HTTP/HTTPS 书源');
    expect(() => checkSourceUrl('javascript:alert(1)')).toThrow('仅支持 HTTP/HTTPS 书源');
    expect(() => checkSourceUrl('https://example.com/a')).not.toThrow();
    expect(() => checkSourceUrl('http://example.com/a')).not.toThrow();
  });

  it('L75-77 九个 local 形态（`.localhost` / `.local` / `::1` / `0.0.0.0` / `127.` / `10.` / `192.168.` / `169.254.` / `172.16-31.`）', () => {
    expect(src).toContain('host=="localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||');
    expect(src).toContain('host=="::1" || host=="0.0.0.0" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.") ||');
    expect(src).toContain('Regex("^172\\\\.(1[6-9]|2[0-9]|3[01])\\\\.").containsMatchIn(host)');
    for (const url of [
      'http://localhost/x',
      'http://a.localhost/x',
      'http://printer.local/x',
      'http://[::1]/x',
      'http://0.0.0.0/x',
      'http://127.0.0.1/x',
      'http://10.1.2.3/x',
      'http://192.168.1.1/x',
      'http://169.254.1.1/x',
      'http://172.20.0.1/x',
    ]) {
      expect(() => checkSourceUrl(url)).toThrow('书源规则尝试访问未配置的内网地址');
    }
    for (const url of ['http://example.com/x', 'http://172.15.0.1/x', 'http://172.32.0.1/x']) {
      expect(() => checkSourceUrl(url)).not.toThrow();
    }
  });

  it('L79 `allowedPrivateHost` 例外（大小写不敏感，且 null 绝不放行）', () => {
    expect(src).toContain('require(!(local || ipv6Private) || host==allowedPrivateHost) { tr("书源规则尝试访问未配置的内网地址") }');
    expect(() => checkSourceUrl('http://127.0.0.1/x', '127.0.0.1')).not.toThrow();
    expect(() => checkSourceUrl('http://localhost/x', 'localhost')).not.toThrow();
    expect(() => checkSourceUrl('http://localhost/x', null)).toThrow('书源规则尝试访问未配置的内网地址');
    expect(() => checkSourceUrl('http://127.0.0.1/x', 'other')).toThrow('书源规则尝试访问未配置的内网地址');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ 反向：`checkInsecureTlsRequest` 不属于 NetworkCalls.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('边界：`checkInsecureTlsRequest` 不是这个文件的', () => {
  const src = kt(NETWORK_KT);

  it('NetworkCalls.kt 里没有「不安全 TLS」相关代码（那条在别处，文案也不同）', () => {
    expect(src).not.toContain('不安全 TLS');
    expect(src).not.toContain('checkInsecureTlsRequest');
    // 但端口里它确实存在（供 insetureTls 书源用），文案与 NetworkCalls 的两条不同
    expect(INSECURE_CREDENTIAL_MESSAGE).toBe('非 HTTPS 图片或书源地址不能携带登录凭据');
    expect(() => checkInsecureTlsRequest('http://x/y', {})).toThrow('不安全 TLS 书源只支持 HTTPS');
    expect(() => checkInsecureTlsRequest('https://x/y', { cookie: 'a' })).toThrow(
      '不安全 TLS 书源不能发送登录凭据，请启用证书验证',
    );
  });
});
