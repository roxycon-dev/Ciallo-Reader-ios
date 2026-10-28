/**
 * Android source: `com.example.source.js.JsSourceRepo.kt` (1167 lines, 1129 non-blank)
 * Ported: 1129 / 1129 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `Context.filesDir/js_sources` + `android.util.AtomicFile` → the injected
 *   `FileStoragePort`; `startWrite/finishWrite/failWrite` collapses into one
 *   `writeText` (the adapter must write atomically).
 * - `okhttp3` → the injected `HttpClient` (see `src/core/source/networkCalls.ts`).
 * - `Semaphore(4)` + `coroutineScope { … awaitAll() }` → `mapWithConcurrency(4, …)`.
 * - `withTimeoutOrNull(ms)` → the `withTimeout` helper.
 * - `Context.getSharedPreferences("js_source_meta")` → injected `KeyValueStorage`.
 * - `withContext(Dispatchers.IO)` dropped — promises already yield.
 * - `org.json` → the local port; `runCatching { JSONArray(body) }` →
 *   `isJsonArray`; `RuleBudget.json(json)` → `validateJson` from
 *   `@core/parser/ruleBudget`.
 * - `String.replace(CharSequence, CharSequence)` → `replaceAllLiteral` (no `$`
 *   interpretation, exactly like Kotlin). `String.replaceRange` →
 *   `replaceRange`. `trimIndent()` / `prependIndent()` are implemented
 *   faithfully so every generated JS patch stays byte-identical.
 * - `RegexOption.DOT_MATCHES_ALL` → JS `RegExp` with `[\s\S]` / the `s` flag.
 */

import { JS_SOURCE_PATCH_VERSION, patchScript, patchCachedScript, patchJm, patchMxsReader, patchWnacgSearch } from './jsSourcePatches49';
export { patchScript, patchJm, patchMxsReader, patchWnacgSearch } from './jsSourcePatches49';
import { validateJson } from '../../parser/ruleBudget';
import { VeneraRuntime } from './jsComicSource';
import type { JsComicSource } from './jsComicSource';
import type { JsSourceProxyDeps } from './jsSourceProxy';
import { dns, type DnsResolver } from './sourceDns';
import type { FileStoragePort, HttpClient, KeyValueStorage } from './jsPlatform';
import { sha256 } from '@noble/hashes/sha2.js';

/** 本地补丁版本：升级后尝试更新源脚本，失败时仍可使用旧缓存。 */
const PATCH_VERSION = JS_SOURCE_PATCH_VERSION;
// Raw cache format stays stable when compatibility patches change.
const RAW_CACHE_PREFIX = '// EASYREADER_RAW_SOURCE_V28\n';

/** 已知成人源 key 黑名单（默认隐藏，设置彩蛋开启后可见）。 */
const ADULT_KEYS = new Set([
  'nhentai', 'ehentai', 'hitomi', 'jm', 'picacg', 'wnacg', 'mxs',
  'mh18', 'hcomic', 'hot_manga',
]);

/** 需要账号的源（picacg 账密、爱看漫匿名可搜但部分功能需登录、vomic 免费注册后可读）。
 *  mycomic 无账号系统：Cloudflare 盾由 CfWebViewSolver 在网络层自动过，不算登录。 */
const LOGIN_KEYS = new Set(['picacg', 'ikmmh', 'vomic']);

/** 与 App 内置源重复、同 key 多账号、或需要用户自建服务器的源。 */
const EXCLUDED_KEYS = new Set([
  'manga_dex', 'lanraragi', 'komga', 'kavita',
  'baozi', 'jcomic',
  // 当前网络/站点确认不可用：同步仓库时默认排除
  // （ccc 曾短期解除排除，2026-09-26 按用户"移除会员门槛源"要求重新排除：
  //   其付费章节需账号购买，免费章之外不可读）
  'zaimanhua', 'ManHuaGui', 'ykmh', 'happy', 'Komiic',
  'shonen_jump_plus', 'mh1234', 'comic_walker',
  'ccc', 'mh18',
  // 2026-10-02 repeated search/read audit: unstable WAF exit blocking.
  // Keep the cached script for repair, but remove it from the offered list.
  'ikmmh',
]);

/** 证书不完整/自签名，需要忽略 TLS 校验的源。 */
const INSECURE_KEYS = new Set(['baozi']);

/**
 * 本地内置源：不在远端仓库索引里，随 App 资产分发（assets/js_extra/）。
 * 嗶哩/vomic 参考 Keiyoushi；扑飞按本站公开目录及阅读器数据格式适配。
 * （tencent/kuaikan 已按用户要求下架：官方平台付费墙锁内容，归档于
 *   %LOCALAPPDATA%/Temp/mp/archive_sources/，可随时恢复）
 */
const LOCAL_EXTRA_SOURCES: ReadonlyArray<readonly [string, string, string]> = [
  ['bilimanga', '嗶哩漫畫', 'bilimanga.js'],
  ['vomic', 'vomic漫画', 'vomic.js'],
  ['pufei', '扑飞漫画', 'pufei.js'],
  ['aimanhua', '爱漫画', 'aimanhua.js'],
  ['nineteen', '19漫画', 'nineteen.js'],
  ['xipi', '嬉皮漫画', 'xipi.js'],
];

/** 默认 jsDelivr 不通时依次尝试的镜像（国内/代理环境可达性不同）。 */
const INDEX_MIRRORS = [
  'https://fastly.jsdelivr.net/gh/venera-app/venera-configs@main/index.json',
  'https://gcore.jsdelivr.net/gh/venera-app/venera-configs@main/index.json',
  'https://raw.githubusercontent.com/venera-app/venera-configs/main/index.json',
];

const REPO_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';

/** Kotlin `data class SourceMeta`. */
export interface SourceMeta {
  readonly key: string;
  readonly name: string;
  readonly fileName: string;
  readonly version: string;
  readonly adult: boolean;
  readonly insecure: boolean;
}

export interface PortableJsSource { key: string; name: string; fileName: string; version: string; script: string }
const PORTABLE_SCRIPT_BYTES = 512 * 1024;
const PORTABLE_TOTAL_BYTES = 6 * 1024 * 1024;
// Include quoted property names and cookie/session constants, which the older
// Android heuristic misses. A skipped source can be reinstalled on the receiver.
const AUTH_CONSTANT = /(?:password|authorization|api[_-]?key|(?:access|refresh)[_-]?token|token|cookie|session(?:id)?)["']?\s*[:=]\s*['"][^'"]+['"]/i;

/** Everything the repo manager needs from the platform. */
export interface JsSourceRepoDeps {
  readonly files: FileStoragePort;
  readonly http: HttpClient;
  /** Kotlin `context.getSharedPreferences("js_source_meta")`. */
  readonly metaPrefs: KeyValueStorage;
  /** Kotlin `JsSourceProxy.failoverClient(context, baseClient)` behaviour. */
  readonly proxy: JsSourceProxyDeps;
  /** Kotlin `JsComicSource(context, sourceKey, name, version, script, …)`. */
  readonly createSource: (params: {
    sourceKey: string;
    name: string;
    version: string;
    script: string;
    insecureTls: boolean;
    loginRequired: boolean;
  }) => JsComicSource;
  /** Kotlin `Dns.SYSTEM` for the pinned image-host candidate fallback. */
  readonly systemDns: DnsResolver;
}

// ----------------------------------------------------------------------
// string helpers matching Kotlin semantics
// ----------------------------------------------------------------------

/**
 * Kotlin `String.replace(oldValue: CharSequence, newValue: CharSequence)`:
 * literal, replaces EVERY occurrence, and never interprets `$` in the
 * replacement (unlike `String.prototype.replaceAll`).
 */
export function replaceAllLiteral(input: string, search: string, replacement: string): string {
  if (search === '') return replacement.split('').join(input) + replacement;
  return input.split(search).join(replacement);
}

/** Kotlin `String.replaceRange(startIndex, endIndex, replacement)`. */
export function replaceRange(input: string, start: number, end: number, replacement: string): string {
  return input.slice(0, start) + replacement + input.slice(end);
}

/** Kotlin `String.trimIndent()` (i.e. `replaceIndent("")`). */
export function trimIndent(text: string): string {
  let lines = text.split('\n');
  if (lines.length > 0 && (lines[0] as string).trim() === '') lines = lines.slice(1);
  if (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') {
    lines = lines.slice(0, lines.length - 1);
  }
  let min = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === '') continue;
    min = Math.min(min, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(min)) min = 0;
  return lines.map((line) => line.slice(Math.min(min, line.length))).join('\n');
}

/** Kotlin `String.prependIndent(indent)` on an already-`trimIndent`ed string. */
export function prependIndent(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => indent + line)
    .join('\n');
}

function logInfo(tag: string, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${message}`);
}

function logWarn(tag: string, message: string, error?: unknown): void {
   
  console.warn(`[${tag}] ${message}`, error ?? '');
}

/** Kotlin `withTimeoutOrNull(millis) { … }`. */
export function withTimeout<T>(millis: number, promise: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), millis);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Kotlin `coroutineScope { … }.awaitAll()` under `Semaphore(permits)`. */
export async function mapWithConcurrency<T, R>(
  permits: number,
  items: readonly T[],
  block: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(permits, items.length); i += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const index = next;
          next += 1;
          if (index >= items.length) return;
          out[index] = await block(items[index] as T);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

/** Kotlin `private fun validScript(body: String): Boolean`. */
export function validScript(body: string): boolean {
  return body.length >= 1024 && !body.trimStart().startsWith('<');
}

/** Kotlin `runCatching { JSONArray(body) }.isSuccess`. */
function isJsonArray(body: string): boolean {
  try {
    return Array.isArray(JSON.parse(body));
  } catch {
    return false;
  }
}

/** Kotlin `obj.optString("key")` on the parsed index array. */
function strOpt(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'null';
  return String(value);
}

/** Kotlin `obj.optString("name", key)`. */
function strOptDefault(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

// ----------------------------------------------------------------------
// repository
// ----------------------------------------------------------------------

/** Kotlin `object JsSourceRepo`. */
export const JsSourceRepo = {
  exportPortable(deps: JsSourceRepoDeps, warnings: string[]): PortableJsSource[] {
    const raw = deps.files.readText(JsSourceRepo.indexFile(deps)); if (raw === null) return [];
    const output: PortableJsSource[] = []; let bytes = 0;
    for (const meta of JsSourceRepo.parseIndex(raw)) {
      const path = `${JsSourceRepo.dir(deps)}/${meta.fileName}`;
      if (!deps.files.exists(path) || deps.files.length(path) > PORTABLE_SCRIPT_BYTES) continue;
      const script = deps.files.readText(path); if (script === null) continue;
      if (!validScript(script) || AUTH_CONSTANT.test(script)) { warnings.push(`书源 ${meta.name} 含不明确的认证常量或无效脚本，未发送`); continue; }
      bytes += new TextEncoder().encode(script).length;
      if (bytes > PORTABLE_TOTAL_BYTES) { warnings.push('其余书源脚本超过便携配置容量，需在新设备重新安装'); break; }
      output.push({ key: meta.key, name: meta.name, fileName: meta.fileName, version: meta.version, script });
    }
    return output;
  },

  validatePortable(scripts: unknown): PortableJsSource[] {
    if (!Array.isArray(scripts) || scripts.length > 500) throw new Error('便携书源数量无效');
    let bytes = 0; const output: PortableJsSource[] = [], seen = new Set<string>();
    for (const value of scripts as unknown[]) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('书源定义无效');
      const row = value as Record<string, unknown>;
      for (const [key, limit] of [['key', 256], ['name', 512], ['fileName', 256], ['version', 128]] as const) {
        if (typeof row[key] !== 'string' || row[key].length > limit) throw new Error('书源定义无效');
      }
      if (typeof row.script !== 'string' || row.script.length > PORTABLE_SCRIPT_BYTES || !validScript(row.script) || AUTH_CONSTANT.test(row.script)) throw new Error('书源脚本无效或包含认证常量');
      const length = new TextEncoder().encode(row.script).length; bytes += length;
      if (length > PORTABLE_SCRIPT_BYTES || bytes > PORTABLE_TOTAL_BYTES) throw new Error('便携书源超过容量限制');
      const definitions = JsSourceRepo.parseIndex(JSON.stringify([{ key: row.key, name: row.name, fileName: row.fileName, version: row.version }]));
      if (definitions.length !== 1 || seen.has(definitions[0]!.key)) throw new Error('书源定义无效或重复');
      const meta = definitions[0]!; seen.add(meta.key); output.push({ key: meta.key, name: meta.name, fileName: meta.fileName, version: meta.version, script: row.script });
    }
    return output;
  },

  async importPortable(deps: JsSourceRepoDeps, scripts: unknown, replace: boolean): Promise<void> {
    const incoming = JsSourceRepo.validatePortable(scripts);
    const path = JsSourceRepo.indexFile(deps), raw = deps.files.readText(path);
    if (raw !== null) validateJson(raw);
    const current: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(current) || current.length > 500) throw new Error('现有书源索引损坏，未覆盖');
    const records = new Map<string, Record<string, unknown>>();
    for (const value of current as unknown[]) if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).key === 'string') {
      const row = value as Record<string, unknown>; records.set(row.key as string, row);
    }
    if (new Set([...records.keys(), ...incoming.map((item) => item.key)]).size > 500) throw new Error('合并后书源数量超过上限');
    for (const item of incoming) {
      if (!replace && records.has(item.key)) continue;
      const digest = sha256(new TextEncoder().encode(item.key));
      const fileName = `transfer_${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}.js`;
      deps.files.writeText(`${JsSourceRepo.dir(deps)}/${fileName}`, item.script);
      records.set(item.key, { key: item.key, name: item.name, fileName, version: item.version });
    }
    await deps.files.flush?.();
    deps.files.writeText(path, JSON.stringify([...records.values()]));
    await deps.files.flush?.();
  },
  PATCH_VERSION,
  RAW_CACHE_PREFIX,
  ADULT_KEYS,
  LOGIN_KEYS,
  INSECURE_KEYS,
  LOCAL_EXTRA_SOURCES,
  INDEX_MIRRORS,

  /** Kotlin `private fun dir(context: Context): File`. */
  dir(deps: JsSourceRepoDeps): string {
    const dir = `${deps.files.filesDir()}/js_sources`;
    deps.files.mkdirs(dir);
    return dir;
  },

  /** Kotlin `private fun indexFile(context: Context): File`. */
  indexFile(deps: JsSourceRepoDeps): string {
    return `${JsSourceRepo.dir(deps)}/index.json`;
  },

  /** 从本地缓存加载已安装的 JS 源（尊重成人源开关）。 */
  async loadCached(deps: JsSourceRepoDeps, includeAdult: boolean): Promise<JsComicSource[]> {
    const index = JsSourceRepo.indexFile(deps);
    if (!deps.files.exists(index)) return JsSourceRepo.loadLocalExtras(deps);
    try {
      const raw = deps.files.readText(index);
      if (raw === null) return JsSourceRepo.loadLocalExtras(deps);
      const metas = JsSourceRepo.parseIndex(raw).filter((it) => includeAdult || !it.adult);
      const loaded: JsComicSource[] = [];
      for (const meta of metas) {
        try {
        const file = `${JsSourceRepo.dir(deps)}/${meta.fileName}`;
        if (!deps.files.exists(file) || deps.files.length(file) > 512 * 1024) continue;
        const body = deps.files.readText(file);
        if (body === null) continue;
        if (!validScript(body)) {
          logWarn('JsRepo', `invalid cached script: ${meta.fileName}`);
          continue;
        }
        // 旧版缓存已存放补丁后的脚本；新版有标记，才在内存里补丁。
        let script: string;
        if (body.startsWith(RAW_CACHE_PREFIX)) {
          script = patchScript(meta.key, body.slice(RAW_CACHE_PREFIX.length));
        } else {
          script = patchCachedScript(meta.key, body);
        }
        loaded.push(
          deps.createSource({
            sourceKey: meta.key,
            name: meta.name,
            version: meta.version,
            script,
            insecureTls: meta.insecure,
            loginRequired: LOGIN_KEYS.has(meta.key),
          }),
        );
        } catch (error) { logWarn('JsRepo', `failed to load cached source: ${meta.key}`, error); }
      }
      // 本地内置源不受成人开关影响；即便远端缓存为空也始终可用
      return loaded.concat(JsSourceRepo.loadLocalExtras(deps));
    } catch {
      return JsSourceRepo.loadLocalExtras(deps);
    }
  },

  /** 缓存中有脚本缺失或无效时，下次启动补拉，同时继续提供已加载的源。 */
  needsRepair(deps: JsSourceRepoDeps, includeAdult: boolean): boolean {
    try {
      if (deps.metaPrefs.getInt('patch_version', 0) !== PATCH_VERSION) return true;
      const index = JsSourceRepo.indexFile(deps);
      if (!deps.files.exists(index)) return true;
      const raw = deps.files.readText(index);
      if (raw === null) return true;
      return JsSourceRepo.parseIndex(raw)
        .filter((it) => includeAdult || !it.adult)
        .some((meta) => {
          const file = `${JsSourceRepo.dir(deps)}/${meta.fileName}`;
          if (!deps.files.exists(file)) return true;
          const body = deps.files.readText(file);
          return body === null || !validScript(body) || !body.startsWith(RAW_CACHE_PREFIX);
        });
    } catch {
      // Kotlin `runCatching { … }.getOrDefault(true)`
      return true;
    }
  },

  /** 从 assets 读取本地内置源并包装成 JsComicSource（不受远端仓库可用性影响）。 */
  loadLocalExtras(deps: JsSourceRepoDeps): JsComicSource[] {
    const out: JsComicSource[] = [];
    for (const [key, name, fileName] of LOCAL_EXTRA_SOURCES) {
      try {
        const body = deps.files.readAsset(`js_extra/${fileName}`);
        if (body === null) continue;
        if (!validScript(body)) {
          logWarn('JsRepo', `invalid local extra script: ${fileName}`);
          continue;
        }
        out.push(
          deps.createSource({
            sourceKey: key,
            name,
            version: /\bversion\s*=\s*["']([^"']+)["']/.exec(body)?.[1] ?? '1.0.0',
            script: patchScript(key, body),
            insecureTls: INSECURE_KEYS.has(key),
            loginRequired: LOGIN_KEYS.has(key),
          }),
        );
      } catch (e) {
        // Kotlin `.onFailure { Log.w("JsRepo", "load local extra failed: $fileName", it) }`
        logWarn('JsRepo', `load local extra failed: ${fileName}`, e);
      }
    }
    return out;
  },

  /**
   * 书源健康检查：并行搜索一个通用关键词，
   * 返回"搜索失败/超时"的源 key（当前网络下不可用，建议停用）。
   */
  async healthCheck(sources: JsComicSource[]): Promise<Set<string>> {
    if (sources.length === 0) return new Set();
    const disabled = new Set<string>();
    await mapWithConcurrency(4, sources, async (source) => {
        const result = await withTimeout(12000, source.search('斗破苍穹'));
        // Kotlin `when (result) { is Success → …; is Error → disabled.add; null → … }`
        if (result === null) {
          disabled.add(source.sourceKey);
          return;
        }
        if (result.kind === 'error') {
          disabled.add(source.sourceKey);
          return;
        }
        // 能连通但搜出结果时再验一次章节，避免"搜到却点不开"的源留在列表里
        if (result.data.length > 0) {
          const chapterResult = await withTimeout(
            10000,
            source.getChapters(result.data[0]?.id ?? ''),
          );
          if (chapterResult === null || chapterResult.kind === 'error') {
            disabled.add(source.sourceKey);
          }
        }
      });
    return disabled;
  },

  /**
   * 从远程仓库安装/更新全部源（跳过失败源），并写入本地缓存。
   * 返回成功安装的源列表；网络失败返回空并保留旧缓存。
   */
  async install(
    deps: JsSourceRepoDeps,
    repoUrl: string,
    includeAdult: boolean,
    onStatus: (message: string) => void = () => undefined,
  ): Promise<JsComicSource[]> {
    try {
      onStatus('正在获取源仓库列表…');
      const indexEntry = await JsSourceRepo.fetchIndex(deps, repoUrl);
      if (indexEntry === null) {
        logWarn('JsRepo', `fetch index failed: ${repoUrl}`);
        return [];
      }
      const [indexUrl, indexJson] = indexEntry;
      const metas = JsSourceRepo.parseIndex(indexJson).filter((it) => includeAdult || !it.adult);
      logInfo('JsRepo', `index ok, metas=${String(metas.length)}`);
      // Kotlin `indexUrl.substringBeforeLast('/', indexUrl)` — the default is the
      // whole string when there is no '/', so the slice is guarded.
      const lastSlash = indexUrl.lastIndexOf('/');
      const baseUrl = lastSlash >= 0 ? indexUrl.slice(0, lastSlash) : indexUrl;
      const results = await mapWithConcurrency(4, metas, async (meta) => {
        try {
          const script = await JsSourceRepo.fetchScript(deps, baseUrl, meta.fileName);
          if (script === null || script.length > 512 * 1024) return null;
          const patched = patchScript(meta.key, script);
          // 缓存原始脚本；loadCached 会在内存中补丁一次，避免重启后二次改写。
          deps.files.writeText(
            `${JsSourceRepo.dir(deps)}/${meta.fileName}`,
            RAW_CACHE_PREFIX + script,
          );
          return { meta, script: patched };
        } catch (e) {
          logWarn('JsRepo', `install failed: ${meta.fileName}`, e);
          return null;
        }
      });
      const installed = results.filter((it) => it !== null);
      if (installed.length === 0) return [];
      deps.files.writeText(JsSourceRepo.indexFile(deps), indexJson);
      deps.metaPrefs.putInt('patch_version', PATCH_VERSION);
      logInfo('JsRepo', `installed ${String(installed.length)} sources`);
      onStatus(`已安装 ${String(installed.length)} 个漫画源`);
      return installed
        .map((it) =>
          deps.createSource({
            sourceKey: it.meta.key,
            name: it.meta.name,
            version: it.meta.version,
            script: it.script,
            insecureTls: it.meta.insecure,
            loginRequired: LOGIN_KEYS.has(it.meta.key),
          }),
        )
        .concat(JsSourceRepo.loadLocalExtras(deps));
    } catch (e) {
      logWarn('JsRepo', 'install failed', e);
      return JsSourceRepo.loadLocalExtras(deps);
    }
  },

  /** 依次尝试配置仓库与镜像，返回（成功 URL，index 内容）。 */
  async fetchIndex(deps: JsSourceRepoDeps, repoUrl: string): Promise<[string, string] | null> {
    const candidates = [repoUrl, ...INDEX_MIRRORS];
    for (const url of candidates) {
      const body = await JsSourceRepo.fetch(deps, url);
      if (body !== null && isJsonArray(body)) {
        logInfo('JsRepo', `index fetched from: ${url}`);
        return [url, body];
      }
      logWarn('JsRepo', `index mirror failed: ${url}`);
    }
    return null;
  },

  /** 脚本优先从 index 成功的那条链路下载，失败时再试其它镜像的对应路径。 */
  async fetchScript(deps: JsSourceRepoDeps, baseUrl: string, fileName: string): Promise<string | null> {
    const candidates = [
      `${baseUrl}/${fileName}`,
      ...INDEX_MIRRORS.map((it) => {
        const slash = it.lastIndexOf('/');
        return `${slash >= 0 ? it.slice(0, slash) : it}/${fileName}`;
      }),
    ];
    for (const url of candidates) {
      const body = await JsSourceRepo.fetch(deps, url);
      if (body !== null && validScript(body)) return body;
    }
    return null;
  },

  /** Kotlin `private fun parseIndex(json: String): List<SourceMeta>`. */
  parseIndex(json: string): SourceMeta[] {
    // com.example.source.parser.RuleBudget.json(json)
    validateJson(json);
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error('Value of type java.lang.String cannot be converted to JSONArray');
    // Kotlin `require(arr.length() <= 500) { "书源仓库条目过多" }`
    if (!(parsed.length <= 500)) throw new Error('书源仓库条目过多');
    const seen = new Set<string>();
    const out: SourceMeta[] = [];
    for (let i = 0; i < parsed.length; i += 1) {
      const raw = parsed[i];
      // Kotlin `arr.optJSONObject(i) ?: return@mapNotNull null`
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
      const obj = raw as Record<string, unknown>;
      const key = strOpt(obj['key']);
      const fileName = strOpt(obj['fileName']);
      if (key.trim() === '' || fileName.trim() === '' || EXCLUDED_KEYS.has(key)) continue;
      if (
        fileName.includes('/') ||
        fileName.includes('\\') ||
        fileName.includes('..') ||
        !fileName.endsWith('.js')
      ) {
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        name: strOptDefault(obj['name'], key),
        fileName,
        version: strOptDefault(obj['version'], '0'),
        adult: ADULT_KEYS.has(key),
        insecure: INSECURE_KEYS.has(key),
      });
    }
    return out;
  },

  /** Kotlin `private fun fetch(context: Context, url: String): String?`. */
  async fetch(deps: JsSourceRepoDeps, url: string): Promise<string | null> {
    try {
      const response = await deps.http.execute({
        method: 'GET',
        url,
        headers: { 'User-Agent': REPO_USER_AGENT },
        // Kotlin `SharedHttpTransport.builder().connectTimeout(15s).readTimeout(25s)`
        timeouts: { connectMs: 15_000, readMs: 25_000, callMs: 25_000 },
      });
      if (response.status < 200 || response.status > 299) return null;
      if (response.body === null) return null;
      return new TextDecoder().decode(response.body);
    } catch {
      // Kotlin `catch (e: Exception) { null }`
      return null;
    }
  },

  validScript,
  parseIndexPublic: parseIndexForTest,
  patchScript,
  patchWnacgSearch,
  patchMxsReader,
  patchJm,
};

/** Test seam for `parseIndex` (Kotlin keeps it private). */
function parseIndexForTest(json: string): SourceMeta[] {
  return JsSourceRepo.parseIndex(json);
}

// ----------------------------------------------------------------------
// script patches
// ----------------------------------------------------------------------

/** Kotlin `private fun patchWnacgSearch(script: String): String`. */
export { dns, VeneraRuntime };
