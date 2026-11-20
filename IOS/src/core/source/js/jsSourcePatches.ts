/**
 * JS 书源脚本的**注入期补丁** —— `source/js/JsSourceRepo.kt` L812-833 + L1331-1400 的逐行移植。
 *
 * 这些补丁在脚本进入沙箱**之前**改写源码文本（不是运行期 hook），所以必须逐字节对齐：
 * 一条替换错了，书源就会带着「后台 refresh 未 await」或「写死的默认域名」跑起来。
 * Kotlin 侧一共四组：
 *
 *   ① L812-822 `patchCopyInit(script)`：把 `init()` 里的 `this.refreshSearchApi()` /
 *      `this.refreshAppApi().catch(() => {})` 全部替换成 `void 0` —— QuickJS 会把未 await 的
 *      后台任务拒绝抛出来，即使挂了 catch；bootstrap 期间不发起可选网络刷新。
 *   ② L1331-1357 `copy_manga` 的 `apiUrl` getter 重写：优先读持久化的 `_api_url`。
 *   ③ L1358-1398 `copy_manga` 的 `refreshAppApi()` 重写：四个候选域名逐个试，
 *      成功后 `saveData("_api_url", …)` 并写回 `this.settings.base_url`。
 *   ④ L824-833 `patchWnacgInit(script)`：配置了可用 origin 时不再依赖发布页刷新。
 *
 * 另有按 key 的单点替换（L834+）：`manwaba` 的域名迁移 `mwuu.cc → manwaxu.cc`。
 */

/**
 * 历史快照里的补丁版本（50）。
 *
 * ⚠️ 本文件已被 `jsSourcePatches49.ts` 取代（`jsSourceRepo.ts` 只 import 后者），
 * 保留它是因为 `tests/parity/kotlinLiterals.test.ts` 会从这里取若干 `JsSourceRepo.kt`
 * 的字面量。常量名刻意不叫 `PATCH_VERSION`：同名会让 `constNameBinding` 误以为
 * iOS 侧把这个常量绑定到了 50，而真正的活跃基线是 `IOS_PATCH_BASELINE = 49`。
 */
export const LEGACY_PATCH_VERSION = 50;
/** L78 `RAW_CACHE_PREFIX = "// EASYREADER_RAW_SOURCE_V28\n"`：原始缓存格式标记（补丁变化时保持不变）。 */
export const RAW_CACHE_PREFIX = '// EASYREADER_RAW_SOURCE_V28\n';

/** L813 `init() {` 的定位串。 */
const COPY_INIT_START = 'init() {';/** L815 `^    }`（多行）—— `init()` 的结束行。 */
const COPY_INIT_END = /^ {4}\}/m;
/** L820 要清掉的两种后台刷新调用（含可选的 `.catch(() => {})`）。 */
const COPY_INIT_REFRESH = /this\.refresh(?:Search|App)Api\(\)(?:\.catch\(\(\) => \{\}\))?;?/g;

/** L812-822 `patchCopyInit(script)`。 */
export function patchCopyInit(script: string): string {
  const start = script.indexOf(COPY_INIT_START);
  if (start < 0) return script;
  const match = COPY_INIT_END.exec(script.slice(start));
  if (match === null || match.index === undefined) return script;
  const end = start + match.index + match[0].length;
  const init = script.slice(start, end).replace(COPY_INIT_REFRESH, 'void 0');
  return script.slice(0, start) + init + script.slice(end);
}

/** L1335-1357 里 `apiUrl` getter 的起点。 */
const COPY_API_GETTER = 'get apiUrl() {';
/** L1340 `loadSetting('base_url')` —— 判断原 getter 是不是模板字符串形态。 */
const COPY_API_LOAD_SETTING = "loadSetting('base_url')";

/** L1348-1353 重写后的 `apiUrl` getter（逐字节照抄 trimIndent 后的文本）。 */
export const COPY_API_URL_GETTER = `get apiUrl() {
    const dynamic = this.loadData("_api_url");
    if (dynamic && dynamic.startsWith("http")) return dynamic;
    return "https://" + (this.loadSetting('base_url') || CopyManga.defaultApiUrl);
}`;

/** L1359 `async refreshAppApi() {`。 */
const COPY_REFRESH_START = 'async refreshAppApi() {';
/** L1361 定位 refresh 函数体的 marker（同时是整段重写的锚点）。 */
export const COPY_BASE_URL_MARKER = 'this.settings.base_url = data.results.api[0][0];';

/** L1369-1393 重写后的 `refreshAppApi()`（逐字节照抄）。 */
export const COPY_REFRESH_APP_API = `async refreshAppApi() {
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
}`;

/** L1331-1399 `copy_manga` / `copy_manga_multi_accounts` 的完整补丁。 */
export function patchCopyManga(script: string): string {
  let patched = patchCopyInit(script);

  // ① apiUrl getter：整段替换（原 getter 的 return 是模板字符串，不能靠数花括号定位）。
  const apiStart = patched.indexOf(COPY_API_GETTER);
  if (apiStart >= 0) {
    const apiReturn = patched.indexOf(COPY_API_LOAD_SETTING, apiStart);
    const apiClose =
      apiReturn >= 0
        ? patched.indexOf('}', patched.indexOf('\n', apiReturn))
        : patched.indexOf('}', apiStart);
    if (apiClose > apiStart) {
      patched = patched.slice(0, apiStart) + COPY_API_URL_GETTER + patched.slice(apiClose + 1);
    }
  }

  // ② refreshAppApi：候选域名逐个试，成功后持久化。
  const refreshStart = patched.indexOf(COPY_REFRESH_START);
  if (refreshStart >= 0) {
    const markerIdx = patched.indexOf(COPY_BASE_URL_MARKER, refreshStart);
    if (markerIdx >= 0) {
      const ifClose = patched.indexOf('}', markerIdx);
      const funcClose = patched.indexOf('}', ifClose + 1);
      if (funcClose > markerIdx) {
        patched = patched.slice(0, refreshStart) + COPY_REFRESH_APP_API + patched.slice(funcClose + 1);
      }
    }
  }

  return patched;
}

/** L824-833 `patchWnacgInit(script)`。 */
export const WNACG_ORIGIN_PROBE_ANCHOR =
  "if (this.loadSetting('refreshDomainsOnStart')) await this.refreshDomains(false)";

/** L826-832 替换后的片段（逐字节照抄）。 */
export const WNACG_ORIGIN_PROBE = `// A usable configured comic origin does not depend on the publisher page.
// Manual domain refresh remains available when the selected origin changes.
let originReady = false;
try { originReady = /^https:\\/\\//.test(this.baseUrl); } catch (_) {}
if (!originReady && this.loadSetting('refreshDomainsOnStart')) await this.refreshDomains(false)`;

export function patchWnacgInit(script: string): string {
  return script.replace(WNACG_ORIGIN_PROBE_ANCHOR, WNACG_ORIGIN_PROBE);
}

/** L836 漫蛙吧 API 域名迁移（`mwuu.cc` 301 → `manwaxu.cc`，2026-09-26 实测）。 */
export const MANWABA_OLD_HOST = 'https://mwuu.cc';
export const MANWABA_NEW_HOST = 'https://manwaxu.cc';

/**
 * L834+ `patchScript(key, script)` 的前半段分发：先跑按 key 的单点替换，
 * 之后才是各源的 `init()` 补丁（copy / wnacg）。
 */
export function patchScriptHosts(key: string, script: string): string {
  switch (key) {
    case 'manwaba':
      return script.replaceAll(MANWABA_OLD_HOST, MANWABA_NEW_HOST);
    case 'copy_manga':
    case 'copy_manga_multi_accounts':
      return patchCopyManga(script);
    case 'wnacg':
      return patchWnacgInit(script);
    default:
      return script;
  }
}
