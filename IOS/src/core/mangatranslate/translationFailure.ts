/**
 * translationFailure.ts  ←  novel-reader/app/src/main/java/com/example/mangatranslate/TranslationFailure.kt
 *
 * Kotlin source: 37 lines / 30 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-2     package decl                          — package decl                 │
 * │ L4-5     data class TranslationFailure         — ported verbatim              │
 * │ L6       `fun exception()`                     — ported verbatim              │
 * │ L7-33    companion object constants + `http`   — ported verbatim              │
 * │          + `from(Throwable)`                                 (see mapping note) │
 * │ L36      `class TranslationException`          — ported verbatim              │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comment kept verbatim: "Safe, actionable diagnostics. Never expose the
 * response body, endpoint or API key."
 *
 * ADAPTATIONS
 * - `java.net.SocketTimeoutException` / `TimeoutCancellationException` → the JS
 *   equivalents are `DOMException` with `name === 'TimeoutError'` (fetch/AbortSignal)
 *   and `AbortError` (an aborted `AbortController`). The two Kotlin branches are
 *   therefore one `isTimeoutLike()` helper; the resulting `TranslationFailure` is
 *   the same object either way, so the observable behaviour matches.
 * - `java.io.IOException` → any `TypeError` from `fetch` (network-level failure).
 *   The Kotlin branch is checked *after* the timeout branch, so the ordering below
 *   is preserved exactly.
 * - `OutOfMemoryError` → there is no JS equivalent; a `RangeError` from a typed-array
 *   allocation is the closest signal and is mapped to the same "memory" failure.
 * - `IllegalArgumentException` → `TypeError` / `RangeError` (bad argument shape).
 *   `TypeError` also covers the IOException case, so IOException is tested *first* —
 *   mirroring Kotlin, where `IOException` is a `Exception` and `IllegalArgumentException`
 *   is a `RuntimeException`; both are unrelated, so no overlap exists on that side,
 *   but on ours the narrower network test must win.
 */

export interface TranslationFailure {
  readonly code: string;
  readonly description: string;
  readonly retryable: boolean;
}

export function createTranslationFailure(
  code: string,
  description: string,
  retryable = false,
): TranslationFailure {
  return { code, description, retryable };
}

/** Kotlin L6 `fun exception() = TranslationException(this)`. */
export function translationFailureException(failure: TranslationFailure): TranslationException {
  return new TranslationException(failure);
}

export class TranslationException extends Error {
  readonly failure: TranslationFailure;

  constructor(failure: TranslationFailure) {
    super(failure.description);
    this.name = 'TranslationException';
    this.failure = failure;
  }
}

/* ── companion object constants (Kotlin L8-16) ─────────────────────────────── */

export const TRANSLATION_PRIVACY: TranslationFailure = createTranslationFailure(
  'privacy',
  '隐私模式禁止在线翻译，请关闭隐私模式后再试',
);

export const TRANSLATION_MODELS: TranslationFailure = createTranslationFailure(
  'models',
  'OCR 模型未就绪，请到翻译设置检查下载',
);

export const TRANSLATION_OCR: TranslationFailure = createTranslationFailure(
  'ocr',
  '文字识别未成功，请检查清晰度或选择原文语言',
  true,
);

export const TRANSLATION_OCR_ENGINE: TranslationFailure = createTranslationFailure(
  'ocr_init',
  'OCR 引擎加载失败，请关闭翻译后重新开启',
  true,
);

export const TRANSLATION_EMPTY: TranslationFailure = createTranslationFailure(
  'empty',
  '未获得有效译文，请检查原文语言或切换翻译引擎',
  true,
);

export const TRANSLATION_CONFIG: TranslationFailure = createTranslationFailure(
  'config',
  '请先配置 AI 地址和模型名',
);

export const TRANSLATION_FORMAT: TranslationFailure = createTranslationFailure(
  'format',
  '服务返回的译文格式不正确，请更换模型或重试',
  true,
);

export const TRANSLATION_TIMEOUT: TranslationFailure = createTranslationFailure(
  'timeout',
  '翻译请求超时，请检查网络或换用更快的模型',
  true,
);

export const TRANSLATION_NETWORK: TranslationFailure = createTranslationFailure(
  'network',
  '无法连接翻译服务，请检查网络和代理设置',
  true,
);

/** Kotlin L29 `is OutOfMemoryError -> TranslationFailure("memory", …)`. */
const TRANSLATION_MEMORY: TranslationFailure = createTranslationFailure(
  'memory',
  '页面过大，请降低图片清晰度后翻译',
);

/** Kotlin L30 `is IllegalArgumentException -> TranslationFailure("input", …)`. */
const TRANSLATION_INPUT: TranslationFailure = createTranslationFailure(
  'input',
  '页面或接口参数无效，请检查清晰度和翻译设置',
);

/** Kotlin L31 `else -> TranslationFailure("internal", …, retryable = true)`. */
const TRANSLATION_INTERNAL: TranslationFailure = createTranslationFailure(
  'internal',
  '翻译处理失败，请切换引擎或重新进入阅读器',
  true,
);

/** Kotlin L17-24 `fun http(status: Int)`. */
export function translationFailureForHttpStatus(status: number): TranslationFailure {
  if (status === 401 || status === 403) {
    return createTranslationFailure(
      'auth',
      `服务拒绝访问（${String(status)}），请检查 API Key 或切换引擎`,
    );
  }
  if (status === 402) {
    return createTranslationFailure('quota', '服务额度不足，请检查账户额度或切换引擎');
  }
  if (status === 404) {
    return createTranslationFailure('endpoint', '接口或模型不存在（404），请检查地址和模型名');
  }
  if (status === 429) {
    return createTranslationFailure('limited', '翻译服务繁忙或限流，请稍后重试', true);
  }
  if (status >= 500 && status <= 599) {
    return createTranslationFailure(
      'service',
      `翻译服务暂时不可用（${String(status)}），请稍后重试`,
      true,
    );
  }
  return createTranslationFailure('request', `服务未接受翻译请求（${String(status)}），请检查接口配置`);
}

/** Kotlin L25-32 `fun from(error: Throwable)` — branch order preserved verbatim. */
export function translationFailureFrom(error: unknown): TranslationFailure {
  if (error instanceof TranslationException) return error.failure;
  if (isTimeoutLike(error)) return TRANSLATION_TIMEOUT;
  if (isNetworkLike(error)) return TRANSLATION_NETWORK;
  if (isMemoryLike(error)) return TRANSLATION_MEMORY;
  if (isArgumentLike(error)) return TRANSLATION_INPUT;
  return TRANSLATION_INTERNAL;
}

/**
 * Kotlin `is java.net.SocketTimeoutException, is kotlinx.coroutines.TimeoutCancellationException`.
 * JS 侧对应 `AbortSignal.timeout()` 触发的 `TimeoutError` 与手动 abort 的 `AbortError`。
 */
function isTimeoutLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name;
  return name === 'TimeoutError' || name === 'AbortError' || /timeout/iu.test(error.message);
}

/** Kotlin `is java.io.IOException` — `fetch` 的网络层失败都是 `TypeError`。 */
function isNetworkLike(error: unknown): boolean {
  return error instanceof TypeError && !isTimeoutLike(error);
}

/** Kotlin `is OutOfMemoryError` — 无 JS 等价，typed-array 分配失败是最接近信号。 */
function isMemoryLike(error: unknown): boolean {
  return error instanceof RangeError && /allocation|memory|too large/iu.test(error.message);
}

/** Kotlin `is IllegalArgumentException`。 */
function isArgumentLike(error: unknown): boolean {
  return (
    (error instanceof TypeError && !isNetworkLike(error)) ||
    (error instanceof RangeError && !isMemoryLike(error))
  );
}
