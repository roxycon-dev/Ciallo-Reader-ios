/**
 * Android source: `com.example.source.SourceLog.kt` (38 lines, 32 non-blank)
 *
 * 全局书源调试日志（内存环形缓冲，最多保留 [MAX] 条）。
 *
 * 书源每次请求（搜索/目录/正文）的 URL、方法、HTTP 状态、错误原因都会记录在这里，
 * 供「书源管理 → 调试日志」界面实时查看与一键复制，方便用户反馈问题。
 *
 * Line mapping:
 *   L14       `object SourceLog`                     → `export const SourceLog`
 *   L16       `private const val MAX = 300`          → `MAX_ENTRIES = 300`
 *   L17       `private val entries = ArrayDeque<String>()` → `entries: string[]`
 *            (`removeFirst()` on overflow → `shift()`)
 *   L18       `SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.CHINA)` → `formatTimestamp`
 *   L20-31    `log(source, message)`                 → `log`
 *     L21-23    URL masking + secret redaction      → the two `.replace` chains (same regexes)
 *     L24       `[敏感信息已隐藏]` override          → same, still tested against the RAW
 *               `message`, not the masked copy (Kotlin tests `message`, not `safe`)
 *     L25       `"${fmt.format(Date())} [$source] $redacted"` → same layout
 *     L26-29    `synchronized(entries)` ring buffer → dropped (JS is single-threaded)
 *     L30       `if (BuildConfig.DEBUG) Log.i("SourceLog", line)` → `logSink?.(LOG_TAG, line)`
 *   L33-35    `dump()`                              → `dump()`, same empty-buffer text
 *   L37       `clear()`                             → `clear()`
 *
 * ── KOTLIN L30 → an injected sink, and why ────────────────────────────────────────
 * Kotlin writes the line to logcat **only in debug builds** (`BuildConfig.DEBUG`).
 * There is no honest way to reproduce that condition inside `src/core`: the layer must
 * not read `import.meta.env` (see `core/source/zlibrary/network/zLibraryNetworkLogger.ts`
 * for the same decision), and a direct `console.info` would need an `eslint-disable`,
 * which the review protocol forbids. So `android.util.Log.i` becomes an injectable sink —
 * the same shape already used by `core/library/libraryImageBytes.ts`
 * (`ImageBytesHooks.log`) — and it defaults to **silent**, which is the behaviour a
 * release build has. A host installs it under its own dev/native-DEBUG gate:
 *
 * ```ts
 * if (import.meta.env.DEV) SourceLog.setLogSink((tag, line) => console.info(tag, line));
 * ```
 *
 * This is the one place where the port is deliberately quieter than the current code:
 * before this change `log()` printed to the console unconditionally. `dump()` — the
 * user-visible 「书源管理 → 调试日志」 surface — is byte-for-byte unchanged.
 */

/** Kotlin `private const val MAX = 300`. */
const MAX_ENTRIES = 300;

/** Kotlin L30 `android.util.Log.i("SourceLog", line)` — the tag argument. */
export const SOURCE_LOG_TAG = 'SourceLog';

const entries: string[] = [];

/**
 * Kotlin `android.util.Log.i(tag, message)`. Silent until a host installs one, which is
 * exactly how `BuildConfig.DEBUG` behaves for a release APK. See the header note.
 */
export type SourceLogSink = (tag: string, line: string) => void;

let logSink: SourceLogSink | null = null;

/**
 * Kotlin L30's `BuildConfig.DEBUG` gate. `null` (the default) is the release behaviour:
 * entries are still buffered and still visible through `dump()`.
 */
export function setLogSink(sink: SourceLogSink | null): void {
  logSink = sink;
}

/** SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.CHINA) equivalent — zero-padded, 24-hour. */
function formatTimestamp(date: Date): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return (
    `${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ` +
    `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

export const SourceLog = {
  log(source: string, message: string): void {
    // Kotlin L21-23: mask URLs down to scheme://host/…, then redact `k=v` secrets.
    const safe = message
      .replace(/https?:\/\/[^\s]+/g, (hit) => {
        try {
          const u = new URL(hit);
          return `${u.protocol}//${u.host}/…`;
        } catch {
          return '[URL]';
        }
      })
      .replace(
        /(cookie|authorization|password|userkey|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi,
        '$1=[redacted]',
      );
    // Kotlin L24 tests the RAW `message`, so a secret anywhere blanks the whole line.
    const redacted = /(cookie|authorization|password|userkey|api[_-]?key|token)\s*[:=]/i.test(
      message,
    )
      ? '[敏感信息已隐藏]'
      : safe;
    const line = `${formatTimestamp(new Date())} [${source}] ${redacted}`;
    entries.push(line);
    while (entries.length > MAX_ENTRIES) entries.shift();
    // Kotlin L30 — `if (BuildConfig.DEBUG)`, i.e. no-op until a host installs a sink.
    logSink?.(SOURCE_LOG_TAG, line);
  },
  /** Kotlin L33-35 — the user-visible 「调试日志」 text, joined by newlines. */
  dump(): string {
    if (entries.length === 0) return '（暂无书源请求日志，请先执行一次搜索）';
    return entries.join('\n');
  },
  /** Kotlin L37. */
  clear(): void {
    entries.length = 0;
  },
};