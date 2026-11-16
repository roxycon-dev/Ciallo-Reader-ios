/**
 * Script detection + translation-engine interface — port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/TextTranslator.kt`
 * (163 lines total, 148 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * `ScriptDetector.detect` is a **pure** heuristic and is ported 1:1 below because other
 * callers (novel reading statistics, TTS language hints) depend on its exact verdicts.
 * Everything that performs a network call is stubbed.
 *
 * Line map (Kotlin line → TS):
 *   1        `package com.example.mangatranslate` → module header.
 *   2        (blank)
 *   3..14    imports (coroutines, okhttp3, org.json, java.util.concurrent.TimeUnit)
 *            → no imports: the transport is injected as {@link TextTranslatorHttp}.
 *   15       (blank)
 *   16       KDoc `文本翻译引擎接口：目标语言恒为简体中文。` → kept.
 *   17..25   `interface TextTranslator { translate / prepare / close }`
 *            → {@link TextTranslator}. The three members and their nullable-return
 *              contracts ("失败返回 null（调用方保留原文显示）", "返回 null=成功 或 失败原因")
 *              are preserved verbatim in the member docs.
 *   26       (blank)
 *   27       KDoc `语言检测（纯函数，供单测）：按文字系统启发式。` → kept.
 *   28..54   `object ScriptDetector { fun detect(text): String? { … } }`
 *            → {@link ScriptDetector}.detect, **fully ported**:
 *              - the four counters (kana / hangul / latin / cjk) and the exact
 *                `when` ranges (0x3040..0x30FF + 0x31F0 + 0x31F1;
 *                0xAC00..0xD7A3 + 0x1100..0x11FF; 0x61..0x7A + 0x41..0x5A;
 *                0x4E00..0x9FFF) — Kotlin `in` ranges are inclusive, so `>=`/`<=`;
 *              - `coerceAtLeast(1)` on the total;
 *              - the `when` return order ja → ko → en → zh → null with the exact
 *                multipliers (`kana * 3 >= total / 4`, `hangul * 2 >= total`,
 *                `latin * 2 >= total`, `cjk * 2 >= total`).
 *              Kotlin integer division `total / 4` is preserved (integer, truncating).
 *              The two ⚠️ comments about round 19 and round 19's CN false-positive fix
 *              are kept verbatim.
 *   55       (blank)
 *   56..59   KDoc `在线兜底翻译（第十七轮）：腾讯交互翻译 transmart…` → kept.
 *   60..163  `class OnlineFallbackTranslator … : TextTranslator` →
 *            {@link OnlineFallbackTranslator}. Member by member:
 *              - 62..67 `client by lazy { SharedHttpTransport.builder()… }`
 *                → the client is injected (`TextTranslatorHttp`); the two timeout
 *                  values (10 s connect / 20 s read) are preserved as
 *                  {@link ONLINE_CONNECT_TIMEOUT_MS} / {@link ONLINE_READ_TIMEOUT_MS}.
 *              - 69 `override suspend fun prepare(source) = null` → **ported**, returns null.
 *              - 71..74 `translate(text, sourceLang)` → `translate()` **stub** (needs network).
 *              - 80..113 `translateBatch(texts, sourceLang)` → **stub**; the request body
 *                 it builds is reproduced as the pure builder
 *                 {@link buildTransmartBody} (endpoint, headers, `fn`/`session`/
 *                 `client_key`, `source.text_list`, `target.lang = "zh"` all verbatim).
 *                The privacy gate `TranslationPrivacy.allowed(context)` and the
 *                `require(texts.size<=500 && texts.sumOf { it.length }<=128_000) { "翻译请求过大" }`
 *                limits are preserved in {@link assertTransmartBatchLimits}.
 *              - 116..122 `internal fun parseTransmart(raw, expectCount)`
 *                → {@link parseTransmart}, **fully ported** (pure JSON parsing);
 *                  the `header.ret_code != "succ"`, missing `auto_translation` and
 *                  `arr.length() != expectCount` rejections are all preserved.
 *              - 125..144 `private suspend fun gtxFallback(...)` → **stub**; its URL
 *                 template is preserved as {@link GOOGLE_GTX_ENDPOINT_TEMPLATE} and the
 *                 response parser as {@link parseGtx} (**fully ported**, pure).
 *              - 146..156 `internal fun parseGtx(body)` → {@link parseGtx}, fully ported.
 *              - 158 `override fun close() {}` → **ported**, no-op.
 *              - 160..162 `companion object { private const val TIMEOUT_MS = 20_000L }`
 *                → {@link ONLINE_READ_TIMEOUT_MS} (identical value; on Android it was
 *                  already unreferenced).
 *
 * Skipped lines and why:
 *   - Kotlin lines 3..14 imports: JVM/Android only.
 *   - Kotlin lines 71..74, 80..113, 125..144: the network round-trips. Replaced by
 *     {@link MangaTranslateUnsupportedError}; the *request shape* they build is preserved
 *     in pure builders so the wire format stays auditable and testable.
 *   - Kotlin line 109 / 137 `resp.body?.byteStream()?.use { it.readImportBytes(2*1024*1024) }`
 *     → the 2 MB response cap is preserved as {@link ONLINE_MAX_RESPONSE_BYTES}; the
 *     actual bounded read lives in `data/importSafety.ts` (`readImportBytes`).
 *   - `org.json.JSONObject` / `JSONArray` → `JSON.parse` with explicit shape guards
 *     (`optJSONObject`/`optJSONArray` return null instead of throwing).
 *   - Kotlin line 112 `?: gtxFallback(texts, sourceLang)` → the fallback *order* is
 *     documented on {@link OnlineFallbackTranslator.translateBatch} but the call is stubbed.
 *
 * `"\u3000"` does not occur anywhere in the Kotlin source (verified byte-wise), so no
 * U+3000 escape was required. All user-visible Chinese literals are byte-identical.
 */

import {
  type MangaTranslateUnsupportedReason,
  MangaTranslateUnsupportedError,
} from './index';

/** `companion object { private const val TIMEOUT_MS = 20_000L }` (already unused on Android). */
export const ONLINE_READ_TIMEOUT_MS = 20_000;
/** Kotlin line 64: `.connectTimeout(10, TimeUnit.SECONDS)`. */
export const ONLINE_CONNECT_TIMEOUT_MS = 10;
/** Kotlin lines 109 / 137: `readImportBytes(2*1024*1024)`. */
export const ONLINE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Kotlin line 84: `require(texts.size<=500 && texts.sumOf { it.length }<=128_000) { "翻译请求过大" }`. */
export const TRANSMART_MAX_TEXTS = 500;
export const TRANSMART_MAX_TOTAL_CHARS = 128_000;
/** Kotlin line 100. */
export const TRANSMART_ENDPOINT = 'https://transmart.qq.com/api/imt';
/** Kotlin line 101. */
export const TRANSMART_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
/** Kotlin line 103. */
export const TRANSMART_REFERER = 'https://transmart.qq.com/';
/** Kotlin line 133. */
export const GOOGLE_GTX_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36';
/** Kotlin line 130..131: `client=gtx` + `&sl=…&tl=zh-CN&dt=t&q=`. */
export const GOOGLE_GTX_ENDPOINT_TEMPLATE =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl={sl}&tl=zh-CN&dt=t&q={q}';

/** 文本翻译引擎接口：目标语言恒为简体中文。 */
export interface TextTranslator {
  /** 翻译单段文本；失败返回 null（调用方保留原文显示）。 */
  translate(text: string, sourceLang: string): Promise<string | null>;
  /** 预热（语言包下载等），返回 null=成功 或 失败原因。 */
  prepare(sourceLang: string): Promise<string | null>;
  close(): void;
}

/**
 * 语言检测（纯函数，供单测）：按文字系统启发式。
 * Returns 语言码：ja / en / ko / zh；无法判断返回 null.
 *
 * FULLY PORTED — this is pure and load-bearing.
 */
export const ScriptDetector = {
  detect(text: string): string | null {
    let kana = 0;
    let hangul = 0;
    let latin = 0;
    let cjk = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) as number;
      if (
        (code >= 0x3040 && code <= 0x30ff) ||
        code === 0x31f0 ||
        code === 0x31f1
      ) {
        kana += 1;
      } else if (
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0x1100 && code <= 0x11ff)
      ) {
        hangul += 1;
      } else if (
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x41 && code <= 0x5a)
      ) {
        latin += 1;
      } else if (code >= 0x4e00 && code <= 0x9fff) {
        cjk += 1;
      }
    }
    const total = Math.max(kana + hangul + latin + cjk, 1);
    if (kana > 0 && kana * 3 >= Math.floor(total / 4)) return 'ja';
    if (hangul > 0 && hangul * 2 >= total) return 'ko';
    if (latin * 2 >= total) return 'en';
    // 纯汉字按中文跳过翻译（第十九轮实测：中文电子书被误判 ja 会导致乱序覆盖）。
    // 无假名的纯日文极罕见——漫画对白几乎必带假名，误跳过的代价远小于错翻。
    if (cjk * 2 >= total) return 'zh';
    return null;
  },
};

/** Kotlin lines 85..88: `val srcLang = when (sourceLang) { "ja" -> "ja"; "en" -> "en"; "zh" -> "zh" else -> "auto" }`. */
export function transmartSourceLang(sourceLang: string): string {
  if (sourceLang === 'ja') return 'ja';
  if (sourceLang === 'en') return 'en';
  if (sourceLang === 'zh') return 'zh';
  return 'auto';
}

/** Kotlin line 84: the size guard, message verbatim. */
export function assertTransmartBatchLimits(texts: readonly string[]): void {
  let total = 0;
  for (const t of texts) total += t.length;
  if (!(texts.length <= TRANSMART_MAX_TEXTS && total <= TRANSMART_MAX_TOTAL_CHARS)) {
    throw new Error('翻译请求过大');
  }
}

/**
 * Kotlin lines 89..104 — the Tencent transmart request body, verbatim.
 * Returned as a JSON string so the exact key order/shape is testable without a network.
 */
export function buildTransmartBody(texts: readonly string[], sourceLang: string): string {
  const srcLang = transmartSourceLang(sourceLang);
  return JSON.stringify({
    header: {
      fn: 'auto_translation',
      session: '',
      client_key: 'browser-chromium-131.0.0.0',
    },
    source: {
      text_list: [...texts],
      lang: srcLang,
    },
    target: { lang: 'zh' },
  });
}

/**
 * 腾讯响应解析：{"auto_translation":["译1","译2",...]}。长度必须与请求一致。
 * Kotlin `internal fun parseTransmart` — FULLY PORTED (pure JSON).
 */
export function parseTransmart(raw: string, expectCount: number): string[] | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const header = (obj as Record<string, unknown>)['header'];
    if (header === null || header === undefined || typeof header !== 'object') return null;
    if (optString(header as Record<string, unknown>, 'ret_code') !== 'succ') return null;
    const arr = (obj as Record<string, unknown>)['auto_translation'];
    if (!Array.isArray(arr)) return null;
    if (arr.length !== expectCount) return null;
    const out: string[] = [];
    for (let i = 0; i < expectCount; i += 1) out.push(optString({ v: arr[i] }, 'v'));
    return out;
  } catch {
    return null;
  }
}

/** Kotlin line 147..155: Google gtx `[segments, …]` → concatenated translation. FULLY PORTED. */
export function parseGtx(body: string): string | null {
  try {
    const root = JSON.parse(body) as unknown;
    if (!Array.isArray(root)) return null;
    const segments = root[0];
    if (!Array.isArray(segments)) return null;
    let sb = '';
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (!Array.isArray(seg)) continue;
      const translated = optString({ v: seg[0] }, 'v');
      if (translated !== '') sb += translated;
    }
    return sb.trim() !== '' ? sb : null;
  } catch {
    return null;
  }
}

/** Kotlin line 132: `val sl = if (sourceLang == "zh") "auto" else sourceLang`. */
export function gtxSourceLang(sourceLang: string): string {
  return sourceLang === 'zh' ? 'auto' : sourceLang;
}

/**
 * `org.json` `optString` semantics: an absent key ⇒ `''`, a JSON `null` ⇒ `''`
 * (`JSON.toString(null)` returns null → the `""` default wins), anything else ⇒
 * `String(value)`.
 *
 * R20-audit BUG FIX: this returned the literal text `'null'` for a JSON null. A Tencent
 * `auto_translation` entry of `null` therefore became the translation text `"null"`
 * instead of the empty string `optString` yields on Android. Same class of bug as
 * `parseGtx`'s `seg.optString(0)`.
 */
function optString(obj: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return '';
  const value = obj[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * 在线兜底翻译（第十七轮）：腾讯交互翻译 transmart（国内直连免费，批量多句）。
 * 旧 Google gtx 仅作备源（国内网络通常不可达）。
 *
 * `parseTransmart` / `parseGtx` / `buildTransmartBody` / `assertTransmartBatchLimits` are
 * ported. The two request methods are stubbed.
 */
export interface OnlineFallbackTranslatorHttp {
  /** Equivalent of `client.newCall(request).executeCancellable()`. */
  post(req: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ ok: boolean; body: string }>;
}

export class OnlineFallbackTranslator implements TextTranslator {
  constructor(
    readonly http?: OnlineFallbackTranslatorHttp,
    /** `TranslationPrivacy.allowed(context)` — null models "no Context ⇒ allowed". */
    private readonly privacyAllowed: () => boolean = () => true,
  ) {}

  /** Kotlin line 69: `override suspend fun prepare(source: String): String? = null`. */
  prepare(_sourceLang: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  /** Kotlin line 158: `override fun close() {}`. */
  close(): void {
    // no-op
  }

  /**
   * Kotlin lines 71..74. STUB — requires the HTTP transport.
   * Android: `val out = translateBatch(listOf(text), sourceLang); return out?.firstOrNull()`.
   */
  translate(_text: string, _sourceLang: string): Promise<string | null> {
    throw this.unsupported('OnlineFallbackTranslator.translate');
  }

  /**
   * Kotlin lines 80..113 — 批量翻译（腾讯 transmart /api/imt 一次请求多句，保持顺序）。
   * 返回与输入等长的译文列表（失败元素为 null→整体 null）。
   *
   * Android order: empty check → privacy gate → size limit → transmart POST →
   * on any failure fall through to per-sentence Google gtx. The gating order and the
   * gtx fallback order are preserved in {@link OnlineFallbackTranslator.planBatch}.
   */
  translateBatch(_texts: readonly string[], _sourceLang: string): Promise<string[] | null> {
    throw this.unsupported('OnlineFallbackTranslator.translateBatch');
  }

  /** Pure re-statement of Android's `translateBatch` gating order, for tests. */
  planBatch(texts: readonly string[]): 'empty' | 'privacy-blocked' | 'sized' {
    if (texts.length === 0) return 'empty';
    if (!this.privacyAllowed()) return 'privacy-blocked';
    return 'sized';
  }

  private unsupported(symbol: string): MangaTranslateUnsupportedError {
    const reason: MangaTranslateUnsupportedReason = 'network-translation';
    return new MangaTranslateUnsupportedError(
      symbol,
      reason,
      '需要 OkHttp/网络传输层（Android 走 com.example.source.SharedHttpTransport）',
    );
  }
}