/**
 * 网络层统一异常 — port of Android
 * `novel-reader/app/src/main/java/com/example/data/remote/AppErrorInterceptor.kt`
 * (151 lines total, 108 non-blank).
 *
 * Line map (Kotlin line → TS):
 *   1..11    package + imports (android.content.Context, okhttp3.{Interceptor,Response},
 *            java.io.IOException, java.net.{ConnectException,SocketTimeoutException,
 *            UnknownHostException}, javax.net.ssl.SSLException)
 *            → replaced by zero imports: `Context` becomes an ignored optional
 *            parameter (`toMessage`), the four java.net exception *classes* become
 *            a string-literal discriminator (`NetworkFailureKind`), okhttp3/IOException
 *            become plain objects. No behaviour is lost — the class identity is only
 *            ever used for `is`/`when` dispatch.
 *   12..18   KDoc on NetworkErrorMessage → kept verbatim (lines 12..18 header doc).
 *   19..23   `class NetworkErrorMessage(message, url = null, responseCode = 0) : IOException(message)`
 *            → `class NetworkErrorMessage` with the same three fields in the same
 *            order and the same defaults. `IOException` has no TS analogue (it is a
 *            marker base class); `instanceof`-style checks in the Android tree use
 *            `NetworkErrorMessage` directly, so `NetworkErrorMessage extends Error`
 *            is sufficient.
 *   24       (blank)
 *   25..34   secondary constructor `NetworkErrorMessage(cause, url)` + the `when(cause)`
 *            mapping (SocketTimeoutException / UnknownHostException / ConnectException /
 *            SSLException / else) → `fromCause(kind, causeMessage, url)`. The four
 *            messages are copied verbatim; the `cause.message?.takeIf { it.isNotBlank() }
 *            ?: "网络请求失败"` fallback is copied verbatim.
 *   35       (blank)
 *   36..39   KDoc `toMessage` → kept.
 *   40       `fun toMessage(context: Context? = null): String = message`
 *            → `toMessage(_context?: unknown): string`. The parameter is intentionally
 *            never read on Android either ("context 参数保留是为了以后按语言切换措辞，
 *            现在不读它") so it is kept only for call-shape compatibility.
 *   41       (blank)
 *   42       `companion object {` → object-literal functions below (no class needed).
 *   43..44   `networkTimeout()` → identical.
 *   45..46   `networkGeneric()` → identical.
 *   47       (blank)
 *   48       KDoc `服务器用非 2xx 拒绝请求…` → kept.
 *   49..64   `serverHttp(code, message, url)` incl. the 401/403/404/429/5xx/else
 *            `when` and the `"$base（$serverMessage）"` append → identical.
 *   65       (blank)
 *   66..67   `serverUnknown(code, url)` → identical.
 *   68..69   `}` / `}` → end of factory object.
 *   70       (blank)
 *   71..77   KDoc `ServerMessageExtractor` → kept.
 *   78       `object ServerMessageExtractor {` → named export object.
 *   79       (blank)
 *   80       KDoc `MESSAGE_KEYS` → kept.
 *   81       `private val MESSAGE_KEYS = arrayOf("message","msg","error","detail","errorMsg","messageStr")`
 *            → `const MESSAGE_KEYS` (exported: it is a public contract of the mapping
 *            order, and it is read by unit tests).
 *   82       (blank)
 *   83       `fun extract(body, code)` → identical.
 *   84..99   body of `extract`: empty-body guard, `parseServerMessage`, the 429
 *            short-circuit, the fallback `when`, the `"$fallback（$serverMessage）"`
 *            append → identical, including the `// 限流不是「做错了什么」…` comment.
 *   100      (blank)
 *   101..109 `private fun parseServerMessage(text)` → ported as an exported pure
 *            function. `org.json.JSONObject` → `JSON.parse`; `json.has(k)` →
 *            `Object.prototype.hasOwnProperty.call(obj, k)` (org.json `has` is
 *            exactly own-property containment); `json.optString(k)` → `optString()`
 *            helper defined below with org.json semantics (missing ⇒ `''`,
 *            `JSONObject.NULL` ⇒ `'null'`, otherwise `String(value)`).
 *            The `catch (_: Exception)` branch (non-JSON: HTML error page / bare
 *            gateway text) is copied verbatim, including `!it.startsWith("<")`,
 *            `.take(80)` and `.trim()`.
 *   110      `}` → end of ServerMessageExtractor.
 *   111      (blank)
 *   112..117 KDoc on AppErrorInterceptor, including the two ⚠️ paragraphs
 *            ("⚠️ 未挂载到任何 OkHttpClient（保留给统一网络层接入用）…") → kept.
 *   118      `class AppErrorInterceptor : Interceptor {` → `class AppErrorInterceptor`
 *            with `intercept(request, proceed)`. okhttp3 has no TS analogue; the
 *            interceptor is re-shaped as `intercept` taking a `NetworkRequest` plus a
 *            `proceed` callback that returns a `NetworkResponse` — this is *not* a
 *            wire-level rewrite, it is the same control flow with the transport
 *            injected. NOTE: like on Android this class is **not** wired into any
 *            client; ZLibrary's own client does the same rewrite inline.
 *   119      `@Throws(IOException::class)` → no TS equivalent (the thrown value is
 *            `NetworkErrorMessage`, which extends `Error`).
 *   120      `override fun intercept(chain)` → `async intercept(...)`.
 *   121      `val request = chain.request()` → `const request` param.
 *   122      (blank)
 *   123..127 `val response = try { chain.proceed(request) } catch (e: IOException)
 *            { throw NetworkErrorMessage(e, request.url.toString()) }` →
 *            `await proceed(request)`; transport failures are re-thrown through
 *            `NetworkErrorMessage.fromCause`.
 *   128      (blank)
 *   129      `if (!response.isSuccessful) {` → `if (!isSuccessfulStatus(response.status))`.
 *   130..134 the 409 pass-through block + its four ⚠️/comment lines → kept verbatim,
 *            including the quoted upstream snippet
 *            `if (code == 409) message = bodyJson.optString("message")`.
 *   135      `if (response.code == 409) return response` → identical.
 *   136      `val bodyString = response.body?.string() ?: ""` → `response.body ?? ''`.
 *   137      `ServerMessageExtractor.extract(bodyString, response.code)` → identical.
 *   138      `response.close()` → `response.close()` (part of the injected contract).
 *   139      `throw NetworkErrorMessage(message, request.url.toString(), response.code)` → identical.
 *   140      `}` → end of the `if (!isSuccessful)` block.
 *   141      (blank)
 *   142      `return response` → identical.
 *   143      `}` → end of `intercept`.
 *   144      `}` → end of class.
 *   145      (blank)
 *   146      KDoc `401/403 这类「重试也没用」的错误…` → kept.
 *   147..150 `fun isNonRetryableError(throwable): Boolean` → identical logic
 *            (`(throwable as? NetworkErrorMessage)?.message ?: return false` then
 *            `message.contains("401") || message.contains("403")`).
 *   151      trailing newline.
 *
 * Skipped lines and why:
 *   - Kotlin `import android.content.Context` (3), `import okhttp3.*` (4,5),
 *     `import java.io.IOException` (6), `import java.net.*` (7,8,9),
 *     `import javax.net.ssl.SSLException` (10): Android/JVM-only imports. Their
 *     semantics are preserved by `NetworkFailureKind` + the injected transport.
 *   - Kotlin line 23 `: IOException(message)`: the JVM `IOException` base class has
 *     no TS counterpart. Callers only ever test `instanceof NetworkErrorMessage`.
 *   - Kotlin lines 120–142 inner `chain.proceed(request)` / `response.body?.string()`
 *     / `response.close()`: okhttp `Response` ownership semantics. Replaced by the
 *     injected `proceed`/`close` contract; the *decision logic* (which responses are
 *     rewritten, which pass through untouched) is 1:1.
 *
 * No string literal, magic number, identifier or Chinese user-visible message was
 * changed. `"\u3000"` does not occur in the Kotlin source (verified byte-wise), so no
 * U+3000 escape was needed.
 */

/** Replaces `instanceof SocketTimeoutException / UnknownHostException / ConnectException / SSLException`. */
export type NetworkFailureKind =
  | 'SocketTimeoutException'
  | 'UnknownHostException'
  | 'ConnectException'
  | 'SSLException'
  | 'other';

/** Minimal request surface used by {@link AppErrorInterceptor}. */
export interface NetworkRequest {
  url: string;
}

/** Minimal response surface used by {@link AppErrorInterceptor}. */
export interface NetworkResponse {
  /** HTTP status code. */
  status: number;
  /** Response body as text; `null` models `response.body?.string() ?: ""`. */
  body?: string | null;
  /** Models `Response.close()`. */
  close?(): void;
}

/**
 * 网络层统一异常：把「底层异常 / HTTP 状态码 / 服务器自己写的拒绝理由」收敛成一句可展示文案。
 *
 * 这里刻意用中文字面量而不是 string 资源：这些文案转述的是**服务器返回内容与服务端状态码**，
 * 需要带 code 上下文，翻译成另一套固定句子反而会与事实对不上。
 * （UI 侧的固定提示语仍然走 strings.xml，见 ui/components/AppErrorSnackbar.kt。）
 */
export class NetworkErrorMessage extends Error {
  /** Kotlin `override val message: String` — Error.message is the same slot. */
  override readonly message: string;
  readonly url: string | null;
  readonly responseCode: number;

  constructor(message: string, url: string | null = null, responseCode = 0) {
    super(message);
    this.name = 'NetworkErrorMessage';
    this.message = message;
    this.url = url;
    this.responseCode = responseCode;
  }

  /**
   * Kotlin secondary constructor `NetworkErrorMessage(cause: Throwable, url: String?)`.
   *
   * @param kind        which `java.net` / `javax.net.ssl` class the JVM throwable was,
   *                    or `'other'` for the `else ->` branch.
   * @param causeMessage the throwable's message; `null`/blank selects the fallback.
   */
  static fromCause(
    kind: NetworkFailureKind,
    causeMessage: string | null | undefined,
    url: string | null = null,
  ): NetworkErrorMessage {
    const message =
      kind === 'SocketTimeoutException'
        ? '连接超时，请检查网络后重试'
        : kind === 'UnknownHostException'
          ? '无法解析服务器地址，请检查网络或书源'
          : kind === 'ConnectException'
            ? '无法连接到服务器'
            : kind === 'SSLException'
              ? '安全连接失败，服务器证书可能不受信任'
              : (causeMessage != null && causeMessage.trim() !== '' ? causeMessage : '网络请求失败');
    return new NetworkErrorMessage(message, url);
  }

  /**
   * 交给 UI 直接展示的文案。
   * context 参数保留是为了以后按语言切换措辞，现在不读它。
   *
   * @param _context kept for call-shape parity with Kotlin's unused `Context?`; never read.
   */
  toMessage(_context?: unknown): string {
    return this.message;
  }

  /** Kotlin `companion object` factories. */
  static networkTimeout(): NetworkErrorMessage {
    return new NetworkErrorMessage('连接超时，请检查网络后重试');
  }

  static networkGeneric(): NetworkErrorMessage {
    return new NetworkErrorMessage('网络异常，请稍后重试');
  }

  /** 服务器用非 2xx 拒绝请求；[message] 是服务器自己写的理由（可能为空）。 */
  static serverHttp(code: number, message: string | null, url: string | null = null): NetworkErrorMessage {
    const serverMessage = message?.trim() ? message.trim() : undefined;
    const base =
      code === 401 || code === 403
        ? `服务器拒绝访问（${code}），可能需要重新登录或书源已失效`
        : code === 404
          ? '服务器上没有这个内容（404）'
          : code === 429
            ? '请求过于频繁，服务器暂时拒绝了请求（429）'
            : code >= 500 && code <= 599
              ? `服务器出错了（${code}），通常是源站繁忙，稍后再试`
              : (serverMessage ?? `服务器返回错误（${code}）`);
    // 服务器写了理由就补在后面，同时保留状态码，方便用户截图求助时对得上
    const text =
      serverMessage != null && !base.includes(serverMessage) ? `${base}（${serverMessage}）` : base;
    return new NetworkErrorMessage(text, url, code);
  }

  static serverUnknown(code: number, url: string | null = null): NetworkErrorMessage {
    return new NetworkErrorMessage(`服务器返回未知响应（${code}）`, url, code);
  }
}

/**
 * `org.json.JSONObject.optString(name)` semantics:
 * absent key ⇒ `''`, explicit JSON `null` ⇒ `'null'`, otherwise `String(value)`.
 */
function optString(obj: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return '';
  const value = obj[key];
  if (value === null || value === undefined) return 'null';
  return String(value);
}

/**
 * 从错误响应体里提取服务器返回的具体错误信息。
 *
 * 书源/站点的错误体格式不一（HTML 错误页、网关裸文本、各种键名的 JSON 都有），
 * 这里统一尝试常见字段，提取不到就回退到「服务器返回错误（code）」，
 * 保证用户永远看到的是一句话，而不是 3KB HTML 或裸 JSON。
 */
export const ServerMessageExtractor = {
  /** 依次尝试的常见错误字段；不同站点写法差异很大，覆盖不到的会落到兜底文案。 */
  MESSAGE_KEYS: ['message', 'msg', 'error', 'detail', 'errorMsg', 'messageStr'] as const,

  extract(body: string | null | undefined, code: number): string {
    const text = (body ?? '').trim();
    if (text === '') return `服务器返回错误（${code}）`;
    const serverMessage = parseServerMessage(text);
    // 限流不是「做错了什么」，要说清是暂时的，否则用户只会反复点重试。
    if (code === 429) {
      const prefix = '请求过于频繁，服务器暂时拒绝了请求（429）';
      return serverMessage != null ? `${prefix}（${serverMessage}）` : prefix;
    }
    const fallback =
      code >= 500 && code <= 599
        ? `服务器出错了（${code}），通常是源站繁忙，稍后再试`
        : code === 401 || code === 403
          ? `服务器拒绝访问（${code}），可能需要重新登录或书源已失效`
          : code === 404
            ? '服务器上没有这个内容（404）'
            : `服务器返回错误（${code}）`;
    return serverMessage != null ? `${fallback}（${serverMessage}）` : fallback;
  },
};

/** Kotlin `private fun parseServerMessage(text: String): String?`. */
function parseServerMessage(text: string): string | null {
  try {
    const json = JSON.parse(text) as unknown;
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('not a JSONObject');
    }
    const obj = json as Record<string, unknown>;
    for (const key of ServerMessageExtractor.MESSAGE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = optString(obj, key).trim();
        if (value !== '' && value.length <= 160) return value;
        return null;
      }
    }
    return null;
  } catch {
    // 非 JSON（HTML 错误页 / 网关裸文本）：截短后当补充说明，够不到就用兜底文案
    if (text.startsWith('<')) return null;
    const trimmed = text.slice(0, 80).trim();
    return trimmed !== '' ? trimmed : null;
  }
}

/** Kotlin `Response.isSuccessful` — HTTP 2xx (200..299). */
function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

/**
 * OkHttp 错误拦截器：把非 2xx 响应统一转成 {@link NetworkErrorMessage}，让上层只需要 catch 一种异常。
 *
 * ⚠️ 未挂载到任何 OkHttpClient（保留给统一网络层接入用）。
 * ZLibrary 的客户端在 ZLibraryHttpClient 里自己做了一层同款改写，逻辑与本类一致。
 *
 * iOS/web note: this is a framework-agnostic decision function, not an OkHttp
 * interceptor. The transport is injected as {@link Proceed}. It is likewise **not**
 * mounted anywhere on the TS side — `core/source/zlibrary/` performs the same rewrite
 * inline, exactly as on Android.
 */
export class AppErrorInterceptor {
  async intercept(
    request: NetworkRequest,
    proceed: (req: NetworkRequest) => Promise<NetworkResponse>,
  ): Promise<NetworkResponse> {
    let response: NetworkResponse;
    try {
      response = await proceed(request);
    } catch (error) {
      // Kotlin: `catch (e: IOException) { throw NetworkErrorMessage(e, request.url.toString()) }`
      throw NetworkErrorMessage.fromCause(
        networkFailureKindOf(error),
        error instanceof Error ? error.message : null,
        request.url,
      );
    }

    if (!isSuccessfulStatus(response.status)) {
      // ⚠️ 409 是 ZLibrary 书架的业务语言（「这本书已经在书架里了」），不是故障。
      // 上层 ZLibraryBookshelfScreen 的 add/remove 会读 body 里的 message 显示给用户：
      //     if (code == 409) message = bodyJson.optString("message")
      // 这里一旦把响应 close 掉，那次读取就拿到空串，提示退化成生硬的「添加失败: HTTP 409」。
      // 所以 409 必须**原样放行**：不读体、不关闭、不改写。
      if (response.status === 409) return response;
      const bodyString = response.body ?? '';
      const message = ServerMessageExtractor.extract(bodyString, response.status);
      response.close?.();
      throw new NetworkErrorMessage(message, request.url, response.status);
    }

    return response;
  }
}

/** Kotlin `catch (e: IOException)` narrowing: only those four classes are special-cased. */
function networkFailureKindOf(error: unknown): NetworkFailureKind {
  const name = (error as { name?: unknown } | null)?.name;
  switch (name) {
    case 'SocketTimeoutException':
    case 'UnknownHostException':
    case 'ConnectException':
    case 'SSLException':
      return name;
    default:
      return 'other';
  }
}

/** 401/403 这类「重试也没用」的错误：调用方据此决定不再自动重试。 */
export function isNonRetryableError(throwable: unknown): boolean {
  const message =
    throwable instanceof NetworkErrorMessage ? throwable.message : undefined;
  if (message == null) return false;
  return message.includes('401') || message.includes('403');
}

export type { NetworkResponse as AppErrorInterceptorResponse, NetworkRequest as AppErrorInterceptorRequest };