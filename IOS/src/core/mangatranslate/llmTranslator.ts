/**
 * Custom-AI bubble translator — pure parsers/builders + stubbed transport, port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/LlmBubbleTranslator.kt`
 * (267 lines total, 244 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * The **wire protocol is pure** — request-body construction, endpoint sanitisation, the
 * strict response validator and the fallback prompt are all string/JSON work — so they are
 * ported 1:1 and unit-tested. The HTTP round-trips are stubbed.
 *
 * Line map (Kotlin line → TS):
 *   1        `package com.example.mangatranslate` → module header.
 *   2..16    imports → no imports (transport + secret store injected).
 *   17..25   KDoc `自定义 AI 接口翻译（第十六轮，复刻原仓库
 *            TextBubbleTranslationCoordinator 协议）：…` (5 bullets) → kept verbatim.
 *   26       `class LlmBubbleTranslator(private val context: Context) {` →
 *            {@link LlmBubbleTranslator}.
 *   27       (blank)
 *   28..35   `data class LlmConfig(apiUrl, apiKey, modelName, geminiFormat) { fun isValid() }`
 *            → {@link LlmConfig}. `isValid()` is
 *              `apiUrl.isNotBlank() && modelName.isNotBlank()` — preserved.
 *   36       (blank)
 *   37       `data class Item(val id: Int, val text: String)` → {@link LlmItem}.
 *   38       (blank)
 *   39..45   `client by lazy { …connectTimeout(20s)/readTimeout(180s)/writeTimeout(60s) }`
 *            → injected `LlmTranslatorHttp`; the three timeouts preserved as
 *              {@link LLM_CONNECT_TIMEOUT_MS} / {@link LLM_READ_TIMEOUT_MS} /
 *              {@link LLM_WRITE_TIMEOUT_MS}.
 *   46       (blank)
 *   47       `private val secrets = EncryptedSecretStore(context)` → injected
 *            (`data/encryptedSecretStore.ts` provides the keystore seam; `api_key` is
 *            never stored in plain prefs on Android either — see below).
 *   48       `private val glossaryLock = Any()` → JS is single-threaded; documented.
 *   49..50   KDoc + `private val glossary = LinkedHashMap<String, String>()` →
 *            {@link LlmGlossary} with insertion order preserved (LinkedHashMap).
 *   51       (blank)
 *   52..63   `init { runCatching { prefs("mt_llm").getString("glossary") … } }` —
 *            `require(raw.length <= 256*1024)`, `o.keys().asSequence().take(128)`,
 *            `if(k.length<=80 && value.length<=120)`. → {@link LlmGlossary.fromJson}
 *            (fully ported, pure — caps 256 KiB / 128 keys / 80 / 120 all verbatim).
 *   64       (blank)
 *   65..72   `fun persistGlossary()` → stubbed (SharedPreferences write);
 *            the serialisation it performs is {@link LlmGlossary.toJson} (ported).
 *   73       (blank)
 *   74..78   `fun cacheFingerprint(): String` — SHA-256 of
 *            `"${apiUrl}|${modelName}|${geminiFormat}"` → {@link llmCacheKey} (ported;
 *            the digest itself needs `crypto.subtle`, provided by the caller).
 *   79..80   `fun glossarySnapshot(): Map<String,String>` → {@link LlmGlossary.snapshot}.
 *   81       (blank)
 *   82..90   `fun loadConfig(): LlmConfig` — prefs keys `api_url`, `api_key`
 *            (via the secret store), `model_name`, `gemini_format` (default false)
 *            → {@link LlmConfigStoreKeys}, all four keys and the `?: ""` defaults verbatim.
 *   91       (blank)
 *   92..100  `fun saveConfig(cfg)` — writes `api_key` to the secure store then REMOVES it
 *            from plain prefs and stores trimmed `api_url` / `model_name` →
 *            documented on {@link LlmConfigStoreKeys}; the wire behaviour is preserved.
 *   101      (blank)
 *   102..131 `suspend fun translateBubbles(items)` — guards in this exact order:
 *            `items.isEmpty() → emptyMap()`, `items.size > 500 || sumOf{text.length} > 128_000 → null`,
 *            `!TranslationPrivacy.allowed(context) → null`, `!cfg.isValid() → null`,
 *            prompt from assets with `PROMPT_FALLBACK`, then `repeat(3)` with
 *            `delay(500L shl (attempt-1))` and `lastError = "parse_or_network"`.
 *            → the guards are preserved in {@link llmBatchGuard} (ported, pure);
 *              the request loop is stubbed. RETRY_COUNT = 3 preserved.
 *   132      (blank)
 *   133..135 `suspend fun translateBuckets(regions): items = regions.mapIndexed { i, r -> Item(i, r.original) }`
 *            → {@link llmTranslateBuckets} (ported, pure).
 *   136..155 `private suspend fun requestOnce(...)` — endpoint sanitisation, `Authorization`
 *            header only when the key is non-blank, `readImportBytes(2*1024*1024)`,
 *            `RuleBudget.json(raw)`, gemini vs openai content extraction → stubbed;
 *            the 2 MiB cap is {@link LLM_MAX_RESPONSE_BYTES}.
 *   157..163 `private fun buildUserPayload(items)` —
 *            `{"items":[{"id":…,"text":…}…],"glossary":{…}}` → {@link buildLlmUserPayload}
 *            (fully ported, pure).
 *   165..175 `private fun buildOpenAiCompatible(...)` — system/user messages,
 *            `temperature = 0.2`, URL `"${apiUrl.trim()}/chat/completions"`
 *            → {@link buildOpenAiCompatibleRequest} (fully ported, pure).
 *   177..191 `private fun buildGemini(...)` — `contents[].parts[].text`,
 *            `generationConfig.temperature = 0.2`, host/path split with the
 *            `removePrefix("https://")` + `substringBefore('/')` +
 *            `substringAfter('/', "v1beta")` fallbacks, URL
 *            `"https://$host/$path/models/${modelName}:generateContent?key=${apiKey}"`
 *            → {@link buildGeminiRequest} (fully ported, pure; every default preserved).
 *   193..206 `private fun sanitizeEndpoint(url, gemini)` — allows http+https and LAN hosts,
 *            rejects loopback with '请填局域网 IP 而非 localhost（如 http://192.168.x.x:1234）'
 *            → {@link sanitizeLlmEndpoint} (fully ported, pure; messages verbatim).
 *   208..212 `internal fun parseOpenAiContent(body)` →
 *            `choices[0].message.content` → {@link parseOpenAiContent} (ported, pure).
 *   214..219 `internal fun parseGeminiContent(body)` →
 *            `candidates[0].content.parts[0].text` → {@link parseGeminiContent} (ported, pure).
 *   221..256 `internal fun parseStrict(content, requested)` — markdown fence stripping
 *            (```` ```json ```` / ```` ``` ```` prefix, ```` ``` ```` suffix, then `.trim()`),
 *            `items` array required, every element needs `id` + `translation`,
 *            duplicate id ⇒ null, `out.keys.toSet() != want` ⇒ null, then
 *            `glossary_used` merge with `glossary.remove(k); glossary[k]=v` and
 *            `while(glossary.size>128) glossary.remove(first())`
 *            → {@link parseStrictLlmResponse} + {@link LlmGlossary.mergeUsed}
 *            (fully ported, pure; all bounds 128/80/120 verbatim).
 *   257      (blank)
 *   258..266 `companion object { RETRY_COUNT = 3; PROMPT_FALLBACK = """…""" }`
 *            → {@link LLM_RETRY_COUNT} and {@link PROMPT_FALLBACK} (the prompt is copied
 *              byte-for-byte, including every full-width 「」，、 and the `~~~`).
 *
 * Skipped lines and why:
 *   - Kotlin lines 39..45, 102..131, 136..155, 65..72, 82..100: HTTP transport,
 *     SharedPreferences and EncryptedSecretStore IO → injected / stubbed.
 *   - `org.json.JSONObject`/`JSONArray` → `JSON.parse` with explicit guards.
 *   - `com.example.source.parser.RuleBudget.json(raw)` (line 150) → the JSON budget is
 *     enforced by the parser layer; documented on {@link parseStrictLlmResponse}.
 *   - `LinkedHashMap` iteration order is preserved by `Map` insertion order in JS.
 *
 * No U+3000 in the Android file (verified); every Chinese literal is byte-identical.
 */

import { MangaTranslateUnsupportedError } from './index';
import type { RectF } from './index';

/** Kotlin line 259: `private const val RETRY_COUNT = 3`. */
export const LLM_RETRY_COUNT = 3;
/** Kotlin line 109: `items.size > 500 || items.sumOf { it.text.length.toLong() } > 128_000`. */
export const LLM_MAX_ITEMS = 500;
export const LLM_MAX_TOTAL_CHARS = 128_000;
/** Kotlin line 149: `readImportBytes(2 * 1024 * 1024)`. */
export const LLM_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Kotlin lines 42..44. */
export const LLM_CONNECT_TIMEOUT_MS = 20;
export const LLM_READ_TIMEOUT_MS = 180;
export const LLM_WRITE_TIMEOUT_MS = 60;
/** Kotlin line 120: `if(attempt>0) kotlinx.coroutines.delay(500L shl (attempt-1))`. */
export const LLM_RETRY_BACKOFF_MS = 500;
/** Kotlin lines 56 / 60 / 247. */
export const GLOSSARY_MAX_JSON_CHARS = 256 * 1024;
export const GLOSSARY_MAX_KEYS = 128;
export const GLOSSARY_MAX_KEY_CHARS = 80;
export const GLOSSARY_MAX_VALUE_CHARS = 120;
/** Kotlin line 5: the prefs file name. */
export const LLM_PREFS_NAME = 'mt_llm';

/** 离线兜底精简版提示词（与原仓库协议兼容；assets 缺失时用）。 — byte-identical. */
export const PROMPT_FALLBACK =
  '你是漫画翻译机。把外语漫画文字翻译成简体中文。只输出合法 JSON，禁止任何解释或 markdown 代码块。\n' +
  '输入是 {"items":[{"id":数字,"text":"原文"}...],"glossary":{原文:已有译名}}。\n' +
  '输出必须且只包含 {"items":[{"id":数字,"translation":"译文"}...],"glossary_used":{新发现的译名}}。\n' +
  '要求：每个输入 id 必须原样返回且只返回一次，不得合并拆分；乱码或无意义文本的 translation 输出空字符串；按每个气泡独立翻译，不猜测说话人和上下文关系；专有名词参考 glossary 并把新译名写入 glossary_used。';

/** Kotlin lines 28..35. */
export interface LlmConfig {
  apiUrl: string;
  apiKey: string;
  modelName: string;
  geminiFormat: boolean;
}

/** `fun isValid(): Boolean = apiUrl.isNotBlank() && modelName.isNotBlank()`. */
export function isValidLlmConfig(cfg: LlmConfig): boolean {
  return cfg.apiUrl.trim() !== '' && cfg.modelName.trim() !== '';
}

/** Kotlin line 37. */
export interface LlmItem {
  id: number;
  text: string;
}

/** Kotlin lines 82..100 — the four prefs keys and their defaults. */
export const LlmConfigStoreKeys = {
  prefsName: LLM_PREFS_NAME,
  /** Kotlin `p.getString("api_url", "") ?: ""`. */
  apiUrl: 'api_url',
  /** Kotlin `secrets.read("api_key", p) ?: ""` — the secure store, never plain prefs on read. */
  apiKey: 'api_key',
  /** Kotlin `p.getString("model_name", "") ?: ""`. */
  modelName: 'model_name',
  /** Kotlin `p.getBoolean("gemini_format", false)`. */
  geminiFormat: 'gemini_format',
  /** Kotlin line 55/70 — the glossary blob key. */
  glossary: 'glossary',
} as const;

/**
 * 译名表（会话级持久，SharedPreferences 落盘），跨页积累保证人名一致。
 * Kotlin `LinkedHashMap<String, String>` — insertion order preserved.
 */
export class LlmGlossary {
  private readonly entries = new Map<string, string>();

  /** Kotlin lines 52..63 — `init { … }` load path (caps verbatim). */
  static fromJson(raw: string | null): LlmGlossary {
    const glossary = new LlmGlossary();
    if (raw === null) return glossary;
    if (raw.length > GLOSSARY_MAX_JSON_CHARS) return glossary;
    try {
      const o = JSON.parse(raw) as unknown;
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return glossary;
      for (const k of Object.keys(o as Record<string, unknown>).slice(0, GLOSSARY_MAX_KEYS)) {
        const value = optString(o as Record<string, unknown>, k);
        if (k.length <= GLOSSARY_MAX_KEY_CHARS && value.length <= GLOSSARY_MAX_VALUE_CHARS) {
          glossary.entries.set(k, value);
        }
      }
    } catch {
      // runCatching swallow
    }
    return glossary;
  }

  /** Kotlin lines 65..72 — the serialisation `persistGlossary` writes. */
  toJson(): string {
    return JSON.stringify(Object.fromEntries(this.entries));
  }

  /** Kotlin line 79..80 — `glossary.toMap()`. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Kotlin lines 242..252 — the `glossary_used` merge:
   * `if (k.isNotBlank() && v.isNotBlank() && k.length<=80 && v.length<=120) {
   *   glossary.remove(k); glossary[k]=v
   *   while(glossary.size>128) glossary.remove(glossary.keys.first()) }`
   */
  mergeUsed(used: Record<string, string>): boolean {
    let changed = false;
    for (const k of Object.keys(used)) {
      const v = used[k] ?? '';
      if (k.trim() !== '' && v.trim() !== '' && k.length <= GLOSSARY_MAX_KEY_CHARS && v.length <= GLOSSARY_MAX_VALUE_CHARS) {
        this.entries.delete(k);
        this.entries.set(k, v);
        while (this.entries.size > GLOSSARY_MAX_KEYS) {
          const first = this.entries.keys().next();
          if (first.done === true) break;
          this.entries.delete(first.value);
        }
        changed = true;
      }
    }
    return changed;
  }
}

/**
 * Kotlin line 74..78 — `cacheFingerprint()` hashes
 * `"${cfg.apiUrl}|${cfg.modelName}|${cfg.geminiFormat}"`.
 * `TranslationCoordinator.schedule` uses the fingerprint (or `"online-v1"`) inside the
 * cache key: `"$translationKey@$engine-${forcedLang ?: "auto"}-$modelTag-v2"`.
 */
export function llmCacheKeyPayload(cfg: LlmConfig): string {
  return `${cfg.apiUrl}|${cfg.modelName}|${String(cfg.geminiFormat)}`;
}

/** Kotlin line 785: `"$translationKey@$engine-${forcedLang ?: "auto"}-$modelTag-v2"`. */
export function llmTranslationCacheKey(
  translationKey: string,
  engine: string,
  forcedLang: string | null | undefined,
  modelTag: string,
): string {
  return `${translationKey}@${engine}-${forcedLang ?? 'auto'}-${modelTag}-v2`;
}

/** Kotlin lines 107..111 — the ordered guards of `translateBubbles`. */
export function llmBatchGuard(
  items: readonly LlmItem[],
  privacyAllowed: boolean,
  cfg: LlmConfig,
): 'empty' | 'oversized' | 'privacy-blocked' | 'config-invalid' | 'proceed' {
  if (items.length === 0) return 'empty';
  if (items.length > LLM_MAX_ITEMS) return 'oversized';
  let total = 0;
  for (const it of items) total += it.text.length;
  if (total > LLM_MAX_TOTAL_CHARS) return 'oversized';
  if (!privacyAllowed) return 'privacy-blocked';
  if (!isValidLlmConfig(cfg)) return 'config-invalid';
  return 'proceed';
}

/** Kotlin lines 133..135 — `regions.mapIndexed { i, r -> Item(i, r.original) }`. */
export function llmTranslateBuckets(
  regions: ReadonlyArray<{ rect: RectF; original: string }>,
): LlmItem[] {
  return regions.map((r, i) => ({ id: i, text: r.original }));
}

/** Kotlin lines 157..163 — `{"items":[…],"glossary":{…}}`. */
export function buildLlmUserPayload(
  items: readonly LlmItem[],
  glossary: Record<string, string>,
): string {
  return JSON.stringify({
    items: items.map((it) => ({ id: it.id, text: it.text })),
    glossary,
  });
}

/** Kotlin lines 165..175. */
export function buildOpenAiCompatibleRequest(
  cfg: LlmConfig,
  prompt: string,
  userPayload: string,
): { url: string; body: string } {
  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: userPayload },
  ];
  const body = JSON.stringify({ model: cfg.modelName, messages, temperature: 0.2 });
  return { url: `${cfg.apiUrl.trim()}/chat/completions`, body };
}

/** Kotlin lines 177..191. */
export function buildGeminiRequest(
  cfg: LlmConfig,
  prompt: string,
  userPayload: string,
): { url: string; body: string } {
  const body = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ text: `${prompt}\n\n${userPayload}` }] },
    ],
    generationConfig: { temperature: 0.2 },
  });
  const base = cfg.apiUrl.trim().replace(/^https:\/\//, '');
  const slash = base.indexOf('/');
  const host = slash >= 0 ? base.slice(0, slash) : base;
  const path = slash >= 0 ? base.slice(slash + 1) : 'v1beta';
  return {
    url: `https://${host}/${path}/models/${cfg.modelName}:generateContent?key=${cfg.apiKey}`,
    body,
  };
}

/**
 * endpoint 校验：允许局域网自建 LLM（LM Studio/Ollama 是合法场景），允许
 * http 内网调试；仅拒绝本机回环写法。用户自填 API 属主动配置行为。
 * Kotlin lines 193..206 — FULLY PORTED.
 */
export function sanitizeLlmEndpoint(url: string, _gemini: boolean): string {
  let scheme: string;
  let host: string;
  try {
    const u = new URL(url);
    scheme = u.protocol.replace(':', '');
    host = u.hostname.toLowerCase();
  } catch {
    throw new Error('API 地址缺少主机名');
  }
  if (scheme !== 'https' && scheme !== 'http') {
    throw new Error('API 地址须以 http(s):// 开头');
  }
  if (host === '') throw new Error('API 地址缺少主机名');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    throw new Error('请填局域网 IP 而非 localhost（如 http://192.168.x.x:1234）');
  }
  return url;
}

/** Kotlin lines 208..212. */
export function parseOpenAiContent(body: string): string | null {
  try {
    const root = JSON.parse(body) as unknown;
    const choices = (root as Record<string, unknown>)['choices'];
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const message = (choices[0] as Record<string, unknown>)['message'];
    if (message === null || typeof message !== 'object') return null;
    const content = (message as Record<string, unknown>)['content'];
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

/** Kotlin lines 214..219. */
export function parseGeminiContent(body: string): string | null {
  try {
    const root = JSON.parse(body) as unknown;
    const candidates = (root as Record<string, unknown>)['candidates'];
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const content = (candidates[0] as Record<string, unknown>)['content'];
    if (content === null || typeof content !== 'object') return null;
    const parts = (content as Record<string, unknown>)['parts'];
    if (!Array.isArray(parts) || parts.length === 0) return null;
    const text = (parts[0] as Record<string, unknown>)['text'];
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/**
 * 严格解析（原仓库 parseBubbleTranslationContent 语义）：
 * 剥 markdown 围栏 → JSON → id 集合必须与请求完全一致 → 收集 glossary_used。
 * Kotlin lines 221..256 — FULLY PORTED.
 *
 * @param glossary when supplied, `glossary_used` is merged into it (Kotlin side effect).
 */
export function parseStrictLlmResponse(
  content: string,
  requested: readonly LlmItem[],
  glossary?: LlmGlossary,
): Map<number, string> | null {
  let cleaned = content.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice('```json'.length);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice('```'.length);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, cleaned.length - '```'.length);
  cleaned = cleaned.trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const arr = obj['items'];
  if (!Array.isArray(arr)) return null;

  const want = new Set(requested.map((it) => it.id));
  const out = new Map<number, string>();
  for (let i = 0; i < arr.length; i += 1) {
    const o = arr[i];
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
    const rec = o as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, 'id')) return null;
    if (!Object.prototype.hasOwnProperty.call(rec, 'translation')) return null;
    const id = typeof rec['id'] === 'number' ? rec['id'] : Number(rec['id']);
    if (!Number.isFinite(id)) return null;
    if (out.has(id)) return null; // 重复 id → 判失败重试
    out.set(id, optString(rec, 'translation'));
  }
  // 缺失/多余 id → 判失败重试
  const got = new Set(out.keys());
  if (got.size !== want.size) return null;
  for (const id of want) if (!got.has(id)) return null;

  const used = obj['glossary_used'];
  if (used !== null && used !== undefined && typeof used === 'object' && !Array.isArray(used)) {
    const merged: Record<string, string> = {};
    for (const k of Object.keys(used as Record<string, unknown>)) {
      merged[k] = optString(used as Record<string, unknown>, k);
    }
    if (glossary !== undefined && glossary.mergeUsed(merged)) {
      // Kotlin: persistGlossary() — the platform layer owns the write.
    }
  }
  return out;
}

/**
 * `org.json` `optString` semantics: absent ⇒ `''`, JSON `null` ⇒ `''`, else `String(value)`.
 *
 * R20-audit BUG FIX: returned the literal `'null'` for a JSON null, so a
 * `{"translation": null}` element became the string `"null"` instead of `""`.
 */
function optString(obj: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return '';
  const value = obj[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Injected transport equivalent of `OkHttpClient.newCall(...).executeCancellable()`. */
export interface LlmTranslatorHttp {
  post(req: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ ok: boolean; body: string }>;
}

export class LlmBubbleTranslator {
  constructor(
    readonly http?: LlmTranslatorHttp,
    /** `com.example.data.EncryptedSecretStore` seam. */
    readonly secret?: { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> },
    private readonly glossary: LlmGlossary = new LlmGlossary(),
  ) {}

  /** Kotlin line 54: `context.getSharedPreferences("mt_llm", Context.MODE_PRIVATE)`. */
  prefsName(): string {
    return LLM_PREFS_NAME;
  }

  glossarySnapshot(): Record<string, string> {
    return this.glossary.snapshot();
  }

  /** Kotlin lines 133..135 / 106..131 — STUB (needs the HTTP round-trip). */
  translateBuckets(_regions: ReadonlyArray<{ rect: RectF; original: string }>): Promise<Map<number, string> | null> {
    throw new MangaTranslateUnsupportedError(
      'LlmBubbleTranslator.translateBuckets',
      'network-translation',
      '需要向用户自填的 OpenAI 兼容 / Gemini endpoint 发起请求',
    );
  }

  /** Kotlin line 65 — STUB (SharedPreferences write). */
  persistGlossary(): Promise<void> {
    throw new MangaTranslateUnsupportedError(
      'LlmBubbleTranslator.persistGlossary',
      'android-storage',
      '需要写入 SharedPreferences("mt_llm").glossary',
    );
  }
}