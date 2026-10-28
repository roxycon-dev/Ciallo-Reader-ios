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

import { validateJson } from '../../parser/ruleBudget';
import { VeneraRuntime } from './jsComicSource';
import type { JsComicSource } from './jsComicSource';
import type { JsSourceProxyDeps } from './jsSourceProxy';
import { dns, type DnsResolver } from './sourceDns';
import type { FileStoragePort, HttpClient, KeyValueStorage } from './jsPlatform';

/** 本地补丁版本：升级后尝试更新源脚本，失败时仍可使用旧缓存。 */
const PATCH_VERSION = 40;
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
        } else if (new Set(['wnacg', 'mxs']).has(meta.key)) {
          // These repairs are idempotent and also migrate pre-raw-cache scripts.
          script = patchScript(meta.key, body);
        } else {
          script = body;
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
    await Promise.all(
      sources.map(async (source) => {
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
      }),
    );
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
export function patchWnacgSearch(script: string): string {
  const searchStart = script.indexOf('search = {');
  const searchEnd = script.indexOf('    // favorite related', Math.max(searchStart, 0));
  if (searchStart < 0 || searchEnd <= searchStart) return script;
  return replaceRange(script, searchStart, searchEnd, trimIndent(WNACG_SEARCH_PATCH) + '\n\n');
}

const WNACG_SEARCH_PATCH = `
            search = {
                load: async (keyword, options, page) => {
                    const url = this.baseUrl + '/search/?q=' + encodeURIComponent(keyword)
                        + '&f=_all&s=create_time_DESC&syn=yes&p=' + Math.max(1, Number(page) || 1);
                    const res = await Network.get(url, {});
                    if (res.status !== 200) throw 'Invalid Status Code ' + res.status;
                    const document = new HtmlDocument(res.body);
                    try {
                        const container = document.querySelector('div.gallary_wrap > ul.cc, #classify_container, ul.imgBox');
                        if (!container) throw '搜索页面未返回漫画列表，请稍后重试';
                        const comics = [];
                        const seen = new Set();
                        for (const item of container.children) {
                            const link = item.querySelector('a[href*="photos-index-aid-"]');
                            const match = (link?.attributes?.href || '').match(/photos-index-aid-(\\d+)/);
                            const img = link?.querySelector('img');
                            const titleEl = item.querySelector('div.info > div.title > a, a.ImgA span');
                            const title = (titleEl?.text || link?.attributes?.title || link?.text || '').trim();
                            if (!match || !title || seen.has(match[1])) continue;
                            let cover = String(img?.attributes?.['data-original'] || img?.attributes?.['data-src'] || img?.attributes?.src || '').trim();
                            if (cover.startsWith('//')) cover = 'https://' + cover.replace(/^\\/+/, '');
                            else if (cover.startsWith('/')) cover = this.baseUrl + cover;
                            const info = item.querySelector('div.info_col, span.info');
                            comics.push(new Comic({id:match[1],title:title,cover:cover,description:info?.text?.trim() || ''}));
                            seen.add(match[1]);
                        }
                        const total = Number((document.querySelector('p.result > b')?.text || '').replace(/,/g, ''));
                        let pages = total > 0 ? Math.ceil(total / 24) : 1;
                        for (const a of document.querySelectorAll('.paginator a[href]')) {
                            const match = (a.attributes.href || '').match(/[?&]p=(\\d+)/);
                            if (match) pages = Math.max(pages, Number(match[1]));
                        }
                        return {comics:comics,maxPage:pages};
                    } finally { document.dispose(); }
                }
            }
`;

/** Kotlin `private fun patchMxsReader(script: String): String`. */
export function patchMxsReader(script: string): string {
  return script.replace(
    /loadEp:\s*async\s*\(comicId, epId\)\s*=>\s*\{[\s\S]*?(?=\/\/ 加载评论列表)/,
    () => trimIndent(MXS_LOAD_EP_PATCH) + '\n\n        ',
  );
}

const MXS_LOAD_EP_PATCH = `
        loadEp: async (comicId, epId) => {
            const url = this.baseUrl + '/chapter/' + epId;
            const doc = await this.fetchDocument(url);
            try {
                const images = [];
                for (const img of doc.querySelectorAll('img.lazy, .comicpage img, #manga-reader img')) {
                    const attrs = img.attributes || {};
                    let value = String(attrs['data-original'] || attrs['data-src'] || attrs['data-lazy-src'] || attrs.src || '').trim();
                    if (!value || /^(data:|javascript:)/i.test(value)) continue;
                    if (value.startsWith('//')) value = 'https://' + value.replace(/^\\/+/, '');
                    else if (!/^https?:\\/\\//i.test(value)) value = this.baseUrl + (value.startsWith('/') ? '' : '/') + value;
                    images.push(value);
                }
                if (!images.length) throw '本章中未找到图片';
                return {images:images};
            } finally { doc.dispose(); }
        },
        onImageLoad: (url, comicId, epId) => ({
            headers: {
                'Referer': this.baseUrl + '/chapter/' + epId,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }),
`;

/**
 * 禁漫天堂的线路会周期性下线，旧版脚本遇到一条失效线路就直接把 404
 * 暴露给搜索界面。保留上游脚本逻辑，同时给它一个有效的初始线路、
 * 防止未初始化设置生成 https://undefined，并在 API 返回 404 时自动换线。
 */
export function patchJm(script: string): string {
  let patched = replaceAllLiteral(
    script,
    'this.convertData(await res.text(), domainSecret)',
    "this.convertData((await res.text()).replace(/^\\uFEFF/, ''), domainSecret)",
  );
  patched = replaceAllLiteral(
    patched,
    '    static imageUrl = "https://cdn-msp.jmapinodeudzn.net"',
    trimIndent(`
    static apiDomains = [
        "www.cdntwice.org",
        "www.cdnsha.org",
        "www.cdnaspa.cc",
        "www.cdnntr.cc",
    ]

    static imageUrl = "https://cdn-msp.jmapinodeudzn.net"
        `),
  );
  patched = replaceAllLiteral(
    patched,
    "        let index = parseInt(this.loadSetting('apiDomain')) - 1\n        return `https://${JM.apiDomains[index]}`",
    "        let index = parseInt(this.loadSetting('apiDomain')) - 1\n" +
      '        if (!Number.isFinite(index) || index < 0 || index >= JM.apiDomains.length) index = 0\n' +
      '        return `https://${JM.apiDomains[index]}`',
  );
  patched = replaceAllLiteral(
    patched,
    '        let res = await Network.get(url, this.getApiHeaders(time))\n        if(res.status !== 200) {',
    trimIndent(`
        let res = await Network.get(url, this.getApiHeaders(time))
        if (res.status === 404 && JM.apiDomains && JM.apiDomains.length > 1) {
            const current = this.baseUrl
            const path = url.startsWith(current) ? url.substring(current.length) : ''
            for (const domain of JM.apiDomains) {
                const candidate = 'https://' + domain
                if (candidate === current || !path) continue
                try {
                    const retry = await Network.get(candidate + path, this.getApiHeaders(time))
                    if (retry.status === 200) {
                        JM.apiDomains = [domain, ...JM.apiDomains.filter((e) => e !== domain)]
                        res = retry
                        break
                    }
                } catch (e) {}
            }
        }
        if(res.status !== 200) {
        `),
  );
  return patched;
}

/** Kotlin `"ehentai" -> { … }` branch. */
function patchEhentai(script: string): string {
  let p = script.replace(
    /if\(isFavorited\) \{\s*let position = document\s*\.querySelector\("div#fav"\)\s*\.children\[0\]\s*\.attributes\["style"\]\s*\.split\("background-position:0px -"\)\[1\]\s*\.split\("px;"\)\[0\];\s*folder = \(Number\(position-2\) \/ 19\)\.toString\(\)\s*\}/,
    () => trimIndent(EHENTAI_FAVORITE_PATCH),
  );
  // 预连接暖身：Clash 代理首连 e-hentai 可能冷启动 30s+，init 时后台预热连接
  p = replaceAllLiteral(
    p,
    '    // update url\n    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/ehentai.js',
    trimIndent(`
    // update url
    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/ehentai.js"

    async init() {
        try {
            Network.get(this.baseUrl + '/', {}).catch(() => {});
            Network.get(this.baseUrl + '/popular', {}).catch(() => {});
        } catch (e) {}
    }
    `),
  );
  // 详情页走 nw=session（delta-comic 风格）；不预置 sl/ns cookie（实测会导致匿名搜索挂起）
  // 详情页请求与 delta-comic 一致：hc=1&nw=session + referer（临时保留诊断日志）
  p = replaceAllLiteral(
    p,
    "            let res = await Network.get(id, {\n                'cookie': 'nw=1'\n            });",
    trimIndent(`
            let __detailUrl = id.includes('?') ? id : id + '?hc=1&nw=session';
            let res = await Network.get(__detailUrl, {
                'cookie': 'nw=1',
                'referer': this.baseUrl + '/',
            });
    `),
  );
  // 缩略图分页请求同样带 referer 与 nw=session
  p = replaceAllLiteral(
    p,
    "            let res = await Network.get(url, {\n                'cache-time': 'long',\n                'prevent-parallel': 'true',\n                'cookie': 'nw=1'\n            });",
    trimIndent(`
            let __thumbUrl = url.includes('?') ? url + '&nw=session' : url + '?nw=session';
            let res = await Network.get(__thumbUrl, {
                'cache-time': 'long',
                'prevent-parallel': 'true',
                'cookie': 'nw=1',
                'referer': this.baseUrl + '/',
            });
    `),
  );
  // 复制 delta-comic 的取图方式：直接抓图片页 #img，不再走 api.e-hentai.org
  p = p.replace(
    /onImageLoad: async \(image, comicId, epId, nl\) => \{[\s\S]*?\n {8}\},\n {8}\/\*\*\n {9}\* \[Optional\] provide configs for a thumbnail loading/,
    () => trimIndent(EHENTAI_ON_IMAGE_LOAD),
  );
  // loadEp 只返回每页的"图片页 URL"（每 40 页一次请求），真正图片在阅读/下载时懒加载
  p = replaceAllLiteral(p, EHENTAI_LOAD_EP_OLD, trimIndent(EHENTAI_LOAD_EP_NEW));
  // 搜索作者：从 tags 里提取 artist/cosplayer/group，方便卡片显示真实作者
  p = replaceAllLiteral(p, '    async onLoadFailed() {', trimIndent(EHENTAI_THUMB_HELPERS));
  // extended 模式
  p = replaceAllLiteral(
    p,
    '                    subTitle: uploader,\n                    cover: coverPath,\n                    tags: tags,',
    '                    subTitle: this.getAuthorFromTags(tags, uploader),\n                    cover: coverPath,\n                    tags: tags,',
  );
  // compact 模式
  p = replaceAllLiteral(
    p,
    '                    subTitle: uploader,\n                    cover: cover,\n                    tags: tags,',
    '                    subTitle: this.getAuthorFromTags(tags, uploader),\n                    cover: cover,\n                    tags: tags,',
  );
  return p;
}

const EHENTAI_FAVORITE_PATCH = `
            if(isFavorited) {
                let favEl = document.querySelector("div#fav");
                let favStyle = "";
                if (favEl && favEl.children[0] && favEl.children[0].attributes) {
                    favStyle = favEl.children[0].attributes["style"] || "";
                }
                let posMatch = favStyle.split("background-position:0px -")[1];
                if (posMatch) {
                    let position = posMatch.split("px;")[0];
                    folder = (Number(position-2) / 19).toString();
                }
            }
            `;

const EHENTAI_ON_IMAGE_LOAD = `        onImageLoad: async (image, comicId, epId, nl) => {
            if (typeof image === 'string' && image.startsWith('http') && !image.includes('/s/')) {
                return {
                    url: image,
                    headers: { 'referer': this.baseUrl + '/' },
                }
            }
            let url = ''
            if (typeof image === 'string' && image.startsWith('http') && image.includes('/s/')) {
                url = image
            } else {
                let page = Number(image)
                if (!(page >= 0)) page = 0
                let cache = await this.getThumbUrls(comicId)
                let urls = cache.urls || []
                let pageSize = cache.pageSize || Math.max(urls.length, 1)
                if (page < urls.length) {
                    url = urls[page]
                } else {
                    let pageIndex = Math.floor(page / pageSize)
                    let index = page % pageSize
                    let more = await this.getThumbPage(comicId, pageIndex)
                    url = more[index] || urls[urls.length - 1]
                }
            }
            if (!url) throw "Failed to get image page url"
            let res = await Network.get(url, {
                'cookie': 'nw=1',
                'referer': this.baseUrl + '/',
            })
            if (res.status !== 200) throw 'Invalid status code: ' + res.status
            let document = new HtmlDocument(res.body)
            let img = document.querySelector('#img')
            let imgUrl = img ? img.attributes["src"] : ""
            document.dispose()
            if (!imgUrl) throw "Failed to get image url"
            return {
                url: imgUrl,
                headers: { 'referer': this.baseUrl + '/' },
            }
        },
        /**
         * [Optional] provide configs for a thumbnail loading`;

const EHENTAI_LOAD_EP_OLD = `        loadEp: async (comicId, epId) => {
            let comic = await this.comic.loadInfo(comicId)
            return {
                images: Array.from({length: comic.maxPage}, (_, i) => i.toString())
            }
        },`;

const EHENTAI_LOAD_EP_NEW = `
        loadEp: async (comicId, epId) => {
            let comic = await this.comic.loadInfo(comicId)
            let total = comic.maxPage || 0
            if (total === 0) return { images: [] }
            let cache = await this.getThumbUrls(comicId)
            let urls = cache.urls || []
            let pageSize = cache.pageSize || Math.max(urls.length, 1)
            let results = new Array(total)
            let pageIndices = new Set()
            for (let p = 0; p < total; p++) {
                if (p < urls.length) {
                    results[p] = urls[p]
                } else {
                    pageIndices.add(Math.floor(p / pageSize))
                }
            }
            await Promise.all(Array.from(pageIndices).map((pi) => this.getThumbPage(comicId, pi)))
            for (let p = 0; p < total; p++) {
                if (p >= urls.length) {
                    let pi = Math.floor(p / pageSize)
                    let idx = p % pageSize
                    let more = await this.getThumbPage(comicId, pi)
                    results[p] = more[idx] || urls[urls.length - 1]
                }
            }
            return { images: results }
        },`;

const EHENTAI_THUMB_HELPERS = `
    getThumbUrls(comicId) {
        if (!this.__thumbCache) this.__thumbCache = {};
        if (!this.__thumbCache[comicId]) {
            this.__thumbCache[comicId] = (async () => {
                let first = await this.comic.loadThumbnails(comicId);
                return {
                    urls: first.urls || [],
                    pageSize: Math.max(first.thumbnails.length, first.urls.length, 1)
                };
            })();
        }
        return this.__thumbCache[comicId];
    }

    getThumbPage(comicId, pageIndex) {
        if (!this.__thumbCache) this.__thumbCache = {};
        let key = comicId + '#p' + pageIndex;
        if (!this.__thumbCache[key]) {
            this.__thumbCache[key] = (async () => {
                let t = await this.comic.loadThumbnails(comicId, String(pageIndex));
                return t.urls || [];
            })();
        }
        return this.__thumbCache[key];
    }

    getAuthorFromTags(tags, fallback) {
        try {
            if (Array.isArray(tags)) {
                for (let prefix of ["artist:", "cosplayer:", "group:"]) {
                    let hit = tags.find((e) => e && e.toLowerCase().startsWith(prefix));
                    if (hit) {
                        let v = hit.split(":")[1];
                        if (v && v.trim()) return v.trim();
                    }
                }
            }
        } catch (e) {}
        return fallback || "";
    }

    async onLoadFailed() {`;

/** Kotlin `"hitomi" -> { … }` branch. */
function patchHitomi(script: string): string {
  const patched = script.replace(HITOMI_GG_JS, () => trimIndent(HITOMI_GG_CACHE));
  // hitomi CDN 现在默认给 AVIF（Android 平台解码不稳定），改要 webp
  // NOTE: the Android code discards this `replace` result (a latent bug kept
  // verbatim so the ported behaviour matches byte for byte).
  patched.replace(
    /return files\.map\(\(image\) => url_from_url_from_hash\(0, image, "avif"\)\);/,
    () => 'return files.map((image) => url_from_url_from_hash(0, image, "webp"));',
  );
  return patched;
}

const HITOMI_GG_JS =
  /async function get_image_srcs\(files\) \{\s*const resp = await Network\.get\(\s*"https:\/\/" \+ domain \+ "\/" \+ "gg\.js\?_=" \+ new Date\(\)\.getTime\(\),\s*\{\s*referer: refererUrl,\s*\}\s*\);\s*if \(resp\.status >= 400\) \{\s*throw new Error\(resp\.status\);\s*\}\s*eval\(resp\.body\);\s*if \(!gg\.b\) throw new Error\(\);/;

const HITOMI_GG_CACHE = `
                let __ggCacheTime = 0;
                async function get_image_srcs(files) {
                  const now = Date.now();
                  if (!(__ggCacheTime && now - __ggCacheTime < 600000 && typeof gg !== 'undefined' && gg && gg.b)) {
                    const resp = await Network.get(
                      "https://" + domain + "/" + "gg.js?_=" + now,
                      {
                        referer: refererUrl,
                      }
                    );
                    if (resp.status >= 400) {
                      throw new Error(resp.status);
                    }
                    eval(resp.body);
                    if (!gg.b) throw new Error();
                    __ggCacheTime = now;
                  }
                }
                `;

/** Kotlin `"wnacg" -> { … }` branch. */
function patchWnacg(script: string): string {
  let patched = script.replace(WNACG_DETAIL_REGEX, () => trimIndent(WNACG_DETAIL_PATCH));
  patched = replaceAllLiteral(
    patched,
    'return `https://${domain0.trim()}`',
    "return `https://${domain0.trim() === 'wnacg.com' ? (Wnacg.domains[0] || 'www.wn001.cfd') : domain0.trim()}`",
  );
  patched = patched.includes('!/^wnacg\\d+\\.link')
    ? patched
    : replaceAllLiteral(
        patched,
        '!domain.includes("wn01.link")',
        '!domain.includes("wn01.link") && !/^wnacg\\d+\\.link$/i.test(domain)',
      );
  patched = patched.includes('chapters: chapters,')
    ? patched
    : replaceAllLiteral(
        patched,
        '            return new ComicDetails({\n                id: id,',
        trimIndent(`
            let chapters = new Map();
            document.querySelectorAll('a[href*="/photos-slide-aid-"]').forEach((link) => {
                let match = (link.attributes['href'] || '').match(/photos-slide-aid-(\\d+)/);
                if (match) chapters.set(match[1], link.text.trim() || \`第\${chapters.size + 1}章\`);
            });
            return new ComicDetails({
                id: id,
                chapters: chapters,
        `),
      );
  patched = replaceAllLiteral(
    patched,
    '`${this.baseUrl}/photos-gallery-aid-${comicId}.html`',
    '`${this.baseUrl}/photos-gallery-aid-${epId || comicId}.html`',
  );
  return patchWnacgSearch(patched);
}

const WNACG_DETAIL_REGEX = new RegExp(
  [
    'let title = document\\.querySelector\\("div\\.userwrap > h2"\\)\\.text\\s*',
    'let cover = document\\.querySelector\\("div\\.userwrap > div\\.asTB > div\\.asTBcell\\.uwthumb > img"\\)\\.attributes\\["src"\\]\\s*',
    'cover = \'https:\' \\+ cover\\s*',
    'cover = cover\\.substring\\(0, 6\\) \\+ cover\\.substring\\(8\\)\\s*',
    'let labels = document\\.querySelectorAll\\("div\\.asTBcell\\.uwconn > label"\\)\\s*',
    'let category = labels\\[0\\]\\.text\\.split\\("："\\)\\[1\\]\\s*',
    'let pages = labels\\[1\\]\\.text\\.split\\("："\\)\\[1\\];\\s*',
    'let tagsDom = document\\.querySelectorAll\\("a\\.tagshow"\\);\\s*',
    'let tags = new Map\\(\\)\\s*',
    'tags\\.set\\("頁數", \\[pages\\]\\)\\s*',
    'tags\\.set\\("分類", \\[category\\]\\)\\s*',
    'if \\(tagsDom\\.length > 0\\) \\{\\s*',
    'tags\\.set\\("標籤", tagsDom\\.map\\(\\(e\\) => e\\.text\\)\\)\\s*',
    '\\}\\s*',
    'let description = document\\.querySelector\\("div\\.asTBcell\\.uwconn > p"\\)\\.text;\\s*',
    'let uploader = document\\.querySelector\\("div\\.asTBcell\\.uwuinfo > a > p"\\)\\.text;',
  ].join(''),
  's',
);

const WNACG_DETAIL_PATCH = `
            let titleEl = document.querySelector("div#comicName") || document.querySelector("div.userwrap > h2")
            let title = titleEl ? titleEl.text : String(id)
            let coverEl = document.querySelector("div#Cover > img") || document.querySelector("div.userwrap > div.asTB > div.asTBcell.uwthumb > img")
            let cover = coverEl ? (coverEl.attributes["src"] || "") : ""
            if (cover.startsWith("////")) {
                cover = 'https://' + cover.substring(4)
            } else if (cover.startsWith("//")) {
                cover = 'https://' + cover.substring(2)
            }
            let labels = document.querySelectorAll("div.asTBcell.uwconn > label")
            let pagesEl = document.querySelector("p.txtItme > span.date") || labels[1]
            let categoryEl = document.querySelectorAll("p.txtItme > a.pd")[0] || labels[0]
            let category = categoryEl ? categoryEl.text.split("：").pop() : ""
            let pages = pagesEl ? pagesEl.text.replace(/[^0-9]/g, "") : "1"
            let tagsDom = document.querySelectorAll("a.tagshow");
            let tags = new Map()
            tags.set("頁數", [pages])
            tags.set("分類", [category])
            if (tagsDom.length > 0) {
                tags.set("標籤", tagsDom.map((e) => e.text))
            }
            let descriptionEl = document.querySelector("div.asTBcell.uwconn > p") || document.querySelector("div.Introduct_Sub")
            let description = descriptionEl ? descriptionEl.text : ""
            let uploaderEl = document.querySelector("a.introName") || document.querySelector("div.asTBcell.uwuinfo > a > p")
            let uploader = uploaderEl ? uploaderEl.text : ""
            `;

/** Kotlin `"comick" -> { … }` branch. */
function patchComick(script: string): string {
  let patched = replaceAllLiteral(
    script,
    'let res = await Network.get(url);',
    'let res = await Network.get(url, Comick.getRandomHeaders());',
  );
  // Large books have dozens of catalogue pages. Preserve the entire list and its
  // order, but fetch later pages in bounded batches instead of a serial chain.
  const catalogueStart = patched.indexOf('                while (page <= lastPage) {');
  const catalogueEnd =
    catalogueStart >= 0
      ? patched.indexOf('                let result = new Map();', catalogueStart)
      : -1;
  if (catalogueEnd > catalogueStart) {
    patched = replaceRange(
      patched,
      catalogueStart,
      catalogueEnd,
      prependIndent(trimIndent(COMICK_CATALOGUE), ' '.repeat(16)) + '\n',
    );
  }
  patched = replaceAllLiteral(
    patched,
    '} catch (error) {\n                chapters = new Map();\n            }',
    '} catch (error) {\n                throw error;\n            }',
  );
  patched = patched.replace(
    /orderedItems\.forEach\(item => \{[\s\S]*?chaptersMap\.set\(key, label\);\s*\}\);/,
    () => trimIndent(COMICK_DEDUP),
  );
  const searchStart = patched.indexOf('    search = {');
  const searchEnd =
    searchStart >= 0 ? patched.indexOf('    /// single comic related', searchStart) : -1;
  if (searchEnd >= 0) {
    let searchBlock = patched.slice(searchStart, searchEnd);
    const urlStart = searchBlock.indexOf('            let url = `https://comick.art/search?');
    const urlEnd = urlStart >= 0 ? searchBlock.indexOf(';', urlStart) : -1;
    if (urlEnd >= 0) {
      searchBlock = replaceRange(searchBlock, urlStart, urlEnd + 1, trimIndent(COMICK_SEARCH_URL));
    }
    searchBlock = replaceAllLiteral(
      searchBlock,
      'let maxpage = mangaList.total/mangaList.per_page',
      trimIndent(COMICK_SEARCH_MAXPAGE),
    );
    patched = replaceRange(patched, searchStart, searchEnd, searchBlock);
  }
  return patched;
}

const COMICK_CATALOGUE = `
                const fetchCataloguePage = async (number) => {
                    const url = \`https://comick.art/api/comics/\${slug}/chapter-list?page=\${number}\`;
                    const response = await Network.get(url, Comick.getRandomHeaders());
                    if (response.status !== 200) throw \`Invalid status code: \${response.status}\`;
                    return JSON.parse(response.body);
                };
                const firstPage = await fetchCataloguePage(1);
                const firstItems = Array.isArray(firstPage.data) ? firstPage.data : [];
                if (firstItems.length) {
                    latestTimestamp = firstItems[0].updated_at || firstItems[0].publish_at || firstItems[0].created_at || null;
                }
                collectChapters(firstItems);
                lastPage = Number(firstPage.pagination?.last_page || 1);
                if (!Number.isInteger(lastPage) || lastPage < 1 || lastPage > 512) throw 'Invalid catalogue page count';
                for (let start = 2; start <= lastPage; start += 4) {
                    const requests = [];
                    for (let number = start; number <= Math.min(start + 3, lastPage); number++) {
                        requests.push(fetchCataloguePage(number));
                    }
                    const replies = await Promise.all(requests);
                    for (const reply of replies) collectChapters(Array.isArray(reply.data) ? reply.data : []);
                }
                `;

const COMICK_DEDUP = `
                // 两遍扫描去重（编号相同仅保留最新上传的 hid）：
                // orderedItems 已按旧→新排列，latestByNumber 后写覆盖即最新
                let latestByNumber = new Map();
                orderedItems.forEach(item => {
                    let lang = item?.lang || 'unknown';
                    let hasChap = item?.chap != null && item.chap !== "";
                    let hasVol = item?.vol != null && item.vol !== "";
                    if (hasChap) {
                        latestByNumber.set('chapter//' + item.chap + '//' + lang, item);
                    } else if (hasVol) {
                        latestByNumber.set('volume//' + item.vol + '//' + lang, item);
                    }
                });
                orderedItems.forEach(item => {
                    let lang = item?.lang || 'unknown';
                    let hid = item?.hid || 'unknown';
                    let hasChap = item?.chap != null && item.chap !== "";
                    let hasVol = item?.vol != null && item.vol !== "";
                    let key;
                    let label;
                    let dedupKey = null;

                    if (hasChap) {
                        key = hid + '//chapter//' + item.chap + '//' + lang;
                        label = '第' + item.chap + '话';
                        dedupKey = 'chapter//' + item.chap + '//' + lang;
                    } else if (hasVol) {
                        key = hid + '//volume//' + item.vol + '//' + lang;
                        label = '第' + item.vol + '卷';
                        dedupKey = 'volume//' + item.vol + '//' + lang;
                    } else {
                        key = hid + '//no//-1//' + lang;
                        label = item?.title ? item.title : '无标卷';
                    }

                    if (dedupKey != null && latestByNumber.get(dedupKey) !== item) {
                        return;
                    }

                    chaptersMap.set(key, label);
                });
                `;

const COMICK_SEARCH_URL = `
            if (!this.__searchCursors) this.__searchCursors = {};
            if (Number(page) === 1) this.__searchCursors[keyword] = {};
            let cursor = this.__searchCursors[keyword]?.[Number(page)];
            let url = cursor
                ? \`https://comick.art/search?q=\${encodeURIComponent(keyword)}&cursor=\${encodeURIComponent(cursor)}\`
                : \`https://comick.art/search?q=\${encodeURIComponent(keyword)}&page=\${page}\`;
                    `;

const COMICK_SEARCH_MAXPAGE = `
                    if (jsonData.next_cursor) {
                        this.__searchCursors[keyword][Number(page) + 1] = jsonData.next_cursor;
                    }
                    let maxpage = jsonData.next_cursor ? Number(page) + 1 : Number(page);
                    `;

/** Kotlin `"picacg" -> { … }` branch. */
function patchPicacg(script: string): string {
  let patched = script.replace(
    /this\.saveData\('token', json\.data\.token\)\s*return 'ok'/,
    () => "this.saveData('token', json.data.token); this.saveData('account', [account, pwd]); return 'ok'",
  );
  // 账号数据缺失时不再中断，直接用现有 token 重试
  patched = patched.replace(
    /if\(!Array\.isArray\(account\)\) \{\s*throw new Error\('Failed to reLogin: Invalid account data'\);\s*\}/,
    () => "if(!Array.isArray(account)) { return 'ok'; }",
  );
  patched = patched.replace(
    /this\.buildHeaders\('POST', `comics\/advanced-search\?page=\$\{page\}`, this\.loadData\('token'\)\)/,
    () => "this.buildHeaders('POST', 'comics/advanced-search?page=' + page, this.loadData('token'))",
  );
  patched.replace(
    /throw 'Invalid status code: ' \+ res\.status/,
    () => "throw 'Invalid status code: ' + res.status + ' body=' + String(res.body || '').substring(0, 160)",
  );
  return patched;
}

/** Kotlin `"copy_manga" -> { … }` branch. */
function patchCopyManga(script: string): string {
  let patched = script;
  // 1) apiUrl getter：优先使用已持久化的动态域名
  const apiStart = patched.indexOf('get apiUrl() {');
  if (apiStart >= 0) {
    // 原 getter 的 return 是模板字符串，里面有 ${...} 的右花括号，
    // 不能从 apiStart 直接找第一个 }，要等 return 行结束后的下一个 }
    const apiReturn = patched.indexOf("loadSetting('base_url')", apiStart);
    const apiClose =
      apiReturn >= 0
        ? patched.indexOf('}', patched.indexOf('\n', apiReturn))
        : patched.indexOf('}', apiStart);
    if (apiClose > apiStart) {
      patched =
        patched.slice(0, apiStart) +
        trimIndent(COPY_MANGA_API_URL) +
        patched.slice(apiClose + 1);
    }
  }
  // 2) refreshAppApi：候选域名逐个尝试，成功后 saveData 持久化
  const refreshStart = patched.indexOf('async refreshAppApi() {');
  if (refreshStart >= 0) {
    const marker = 'this.settings.base_url = data.results.api[0][0];';
    const markerIdx = patched.indexOf(marker, refreshStart);
    if (markerIdx >= 0) {
      const ifClose = patched.indexOf('}', markerIdx);
      const funcClose = patched.indexOf('}', ifClose + 1);
      if (funcClose > markerIdx) {
        patched =
          patched.slice(0, refreshStart) + trimIndent(COPY_MANGA_REFRESH) + patched.slice(funcClose + 1);
      }
    }
  }
  return patched;
}

const COPY_MANGA_API_URL = `
                        get apiUrl() {
                            const dynamic = this.loadData("_api_url");
                            if (dynamic && dynamic.startsWith("http")) return dynamic;
                            return "https://" + (this.loadSetting('base_url') || CopyManga.defaultApiUrl);
                        }
                        `;

const COPY_MANGA_REFRESH = `
                            async refreshAppApi() {
                                const candidates = [
                                    "https://api.copy-manga.com/api/v3/system/network2?platform=3",
                                    "https://api.copy2000.online/api/v3/system/network2?platform=3",
                                    "https://api.copymanga.tv/api/v3/system/network2?platform=3",
                                    "https://api.mangacopy.com/api/v3/system/network2?platform=3"
                                ];
                                for (const url of candidates) {
                                    try {
                                        const res = await fetch(url, { headers: this.headers });
                                        if (res.status === 200) {
                                            const data = await res.json();
                                            const apiList = data && data.results && data.results.api;
                                            const host = apiList && apiList[0] && apiList[0][0]
                                                ? String(apiList[0][0]).replace(/^https?:\\/\\//, "").replace(/\\/.*$/, "")
                                                : "";
                                            if (host) {
                                                this.saveData("_api_url", "https://" + host);
                                                this.settings.base_url = host;
                                                return;
                                            }
                                        }
                                    } catch (e) {}
                                }
                            }
                            `;

/** Kotlin `"ikmmh" -> { … }` branch. */
function patchIkm(script: string): string {
  // Keiyoushi's current adapter uses the site's public app entry point.
  // Migrate the former default without replacing a user-chosen mirror.
  let patched = replaceAllLiteral(
    script,
    '"https://www.ikmmh.com"',
    '"https://ymcdnyfqdapp.ikmmh.com"',
  );
  patched = replaceAllLiteral(
    patched,
    'Ikm.baseUrl = String(baseUrl).trim().replace(/\\/+$/, "");',
    'Ikm.baseUrl = String(baseUrl).trim().replace(/\\/+$/, "");\n' +
      "    if (Ikm.baseUrl === 'https://www.ikmmh.com') Ikm.baseUrl = 'https://ymcdnyfqdapp.ikmmh.com';",
  );
  patched = replaceAllLiteral(
    patched,
    '`user=${account}&pass=${pwd}`',
    '`user=${encodeURIComponent(account)}&pass=${encodeURIComponent(pwd)}`',
  );
  const searchStart = patched.indexOf('  search = {');
  const searchEnd = searchStart >= 0 ? patched.indexOf('  // 收藏功能', searchStart) : -1;
  if (searchEnd >= 0 && patched.slice(searchStart, searchEnd).includes('li.comic-item')) {
    let searchBlock = patched.slice(searchStart, searchEnd);
    searchBlock = replaceAllLiteral(
      searchBlock,
      '        let res = await Network.get(',
      "        await validatorGet(Ikm.baseUrl + '/', Ikm.webHeaders);\n        let res = await Network.get(",
    );
    searchBlock = replaceAllLiteral(searchBlock, 'err.message', '(err?.message || String(err))');
    searchBlock = replaceAllLiteral(
      searchBlock,
      '        let document = new HtmlDocument(res.body);',
      "        if (res.status !== 200) throw new Error('Invalid status code: ' + res.status);\n        let document = new HtmlDocument(res.body);",
    );
    searchBlock = replaceAllLiteral(
      searchBlock,
      'li.comic-item',
      'li.comic-item, div.classification',
    );
    searchBlock = replaceAllLiteral(
      searchBlock,
      'e.querySelector("p.title").text.split("~")[0]',
      '(e.querySelector("p.title")?.text || e.querySelector("h2 a")?.text || "").split("~")[0]',
    );
    searchBlock = replaceAllLiteral(
      searchBlock,
      'e.querySelector("img").attributes["src"]',
      'e.querySelector("img")?.attributes["data-src"] || e.querySelector("img")?.attributes["src"] || ""',
    );
    searchBlock = replaceAllLiteral(
      searchBlock,
      'e.querySelector("span.chapter").text',
      'e.querySelector("span.chapter")?.text || e.querySelector("p.describe a")?.text || ""',
    );
    searchBlock = replaceAllLiteral(
      searchBlock,
      '`${Ikm.baseUrl}${e.querySelector("a").attributes["href"]}`',
      'absoluteUrl(e.querySelector("a")?.attributes["href"] || "")',
    );
    patched = replaceRange(patched, searchStart, searchEnd, searchBlock);
  }
  const detailStart = patched.indexOf(
    '      let title = document.querySelector(\n        "div.book-hero__detail > div.title"',
  );
  const detailEndMarker = '        isFavorite: isFavorite,\n      };';
  const detailEnd =
    detailStart >= 0 ? patched.indexOf(detailEndMarker, detailStart) : -1;
  if (detailEnd >= 0) {
    patched = replaceRange(
      patched,
      detailStart,
      detailEnd + detailEndMarker.length,
      trimIndent(IKM_DETAIL),
    );
  }
  patched = replaceAllLiteral(
    patched,
    '    loadEp: async (comicId, epId) => {',
    trimIndent(IKM_LOAD_EP),
  );
  return patched;
}

const IKM_DETAIL = `
      const titleMeta = document.querySelector("meta[property='og:title']");
      const coverMeta = document.querySelector("meta[property='og:image']");
      const descriptionMeta = document.querySelector("meta[name='description']");
      let title = titleMeta?.attributes["content"] || id;
      return {
        title: title.split("~")[0],
        cover: coverMeta?.attributes["content"] || "",
        description: descriptionMeta?.attributes["content"] || "",
        tags: {},
        chapters: eps,
        recommend: [],
        isFavorite: isFavorite,
      };
                    `;

const IKM_LOAD_EP = `
    loadEp: async (comicId, epId) => {
      if (Ikm.baseUrl === 'https://ymcdnyfqdapp.ikmmh.com') {
        const ids = String(epId).match(/\\/chapter\\/(\\d+)\\/(\\d+)/);
        if (!ids) throw new Error('章节地址无效');
        // The current public app endpoint serves complete batches through read/pics.
        // Warm up PHPSESSID once; keep it through all batches, as in Keiyoushi.
        await validatorGet(Ikm.baseUrl + '/', Ikm.webHeaders);
        const readBatch = async (offset) => {
          const response = await validatorPost(Ikm.baseUrl + '/api/comic/read/pics',
            {...Ikm.jsonHead, Referer: epId},
            'id=' + encodeURIComponent(ids[2]) + '&aid=' + encodeURIComponent(ids[1]) +
              '&offset=' + offset + '&limit=10');
          if (response.status !== 200) throw new Error('HTTP ' + response.status);
          const batch = parseReadPicsImages(response, epId);
          if (!batch.ok) throw new Error('源站未提供正文图片，请检查章节权限');
          return batch;
        };
        const first = await readBatch(0);
        if (!first.images.length) throw new Error('该章节没有可读取的正文图片');
        const images = first.images.slice();
        const total = first.total;
        if (total > 1000) throw new Error('章节页数超过安全上限');
        if (total > 0) {
          for (let offset = images.length; offset < total; offset += 20) {
            const startedAt = Date.now();
            const offsets = [];
            for (let value = offset; value < Math.min(offset + 20, total); value += 10) offsets.push(value);
            const batches = await Promise.all(offsets.map(readBatch));
            for (let index = 0; index < batches.length; index++) {
              const batch = batches[index];
              const expected = Math.min(10, total - offsets[index]);
              if (batch.images.length !== expected) throw new Error('源站返回了不完整的章节图片，请重试');
              images.push(...batch.images);
            }
            // Match the maintained adapter's two requests per 500 ms.
            const pause = 500 - (Date.now() - startedAt);
            if (offset + 20 < total && pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
          }
          if (images.length !== total) throw new Error('章节图片数量不完整');
        } else {
          for (let offset = images.length; offset < 1000; offset += 10) {
            if (images.length % 10 !== 0) break;
            const batch = await readBatch(offset);
            images.push(...batch.images);
            if (batch.images.length < 10) break;
          }
        }
        return {images};
      }
            `;

/**
 * 针对远端脚本的本地兼容补丁（站点改版后脚本选择器失效，等上游更新前先兜底）。
 * 仅做最小改动，不破坏源脚本其它逻辑。
 */
export function patchScript(key: string, script: string): string {
  switch (key) {
    // 漫蛙吧 API 域名迁移（mwuu.cc 301 → manwaxu.cc），2026-09-26 实测
    case 'manwaba':
      return replaceAllLiteral(script, 'https://mwuu.cc', 'https://manwaxu.cc');
    case 'ehentai':
      return patchEhentai(script);
    case 'wnacg':
      return patchWnacg(script);
    // hitomi：gg.js（图片子域映射）10 分钟内复用，避免每开一个章节都重新下载并 eval
    case 'hitomi':
      return patchHitomi(script);
    case 'mxs':
      return patchMxsReader(script);
    // 漫画人：loadEp 直接把 epId 拼成相对路径，Cronet 无法请求；补成绝对 URL
    case 'manhuaren':
      return script.replace(
        /let url = `\$\{epId\}`;/,
        () => trimIndent(`
            let url = epId.startsWith('http') ? epId : this.baseUrl + epId;
            if (!url.endsWith('/')) url += '/';
            `),
      );
    // comick：loadEp 请求章节页没带 headers，容易被反爬拒绝导致图片列表为空；
    // 且章节列表 key 含 hid，同语言同章节号被不同汉化组重复上传时会出现 11、11、22、22 的重复章节
    case 'comick':
      return patchComick(script);
    // picacg：登录后补存账号，否则搜索时的 reLogin 报 Invalid account data
    case 'picacg':
      return patchPicacg(script);
    // 拷贝漫画：动态 API 域名没有真正持久化（脚本里写 this.settings 不走 loadSetting），
    // 导致一直用默认域名 api.copy2000.online，它一抽风就全挂。
    // 这里把网络2接口返回的可用域名 saveData 持久化，并加入候选域名 + 失败自动刷新重试。
    case 'copy_manga':
      return patchCopyManga(script);
    case 'jm':
      return patchJm(script);
    case 'nhentai':
      return replaceAllLiteral(
        script,
        '    getApiBaseHeaders() {\n        return {',
        trimIndent(`
    getApiBaseHeaders() {
        const apiKey = this.getApiKey();
        return {
            ...(apiKey ? {Authorization: 'Key ' + apiKey} : {}),
            `),
      );
    case 'ikmmh':
      return patchIkm(script);
    default:
      return script;
  }
}

export { dns, VeneraRuntime };
