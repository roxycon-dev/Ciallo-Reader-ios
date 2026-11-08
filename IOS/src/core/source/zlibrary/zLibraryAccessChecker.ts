/**
 * Kotlin → TS: `source/zlibrary/ZLibraryAccessChecker.kt` (36 lines, 31 non-blank)
 *             → `src/core/source/zlibrary/zLibraryAccessChecker.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import com.example.source.SourceException → `import { LoginRequired, NetworkError } from '../sourceException'`
 *   L4        import okhttp3.Response                → SKIPPED — replaced by the injected
 *                                                      `AccessCheckerResponse` interface below
 *   L5        import org.jsoup.nodes.Document        → `import type { HtmlDocument } from './parser/htmlDocument'`
 *   L7        object ZLibraryAccessChecker          → `export const ZLibraryAccessChecker`
 *   L9        fun checkResponse(response, htmlDoc = null) → `checkResponse(response, htmlDoc = null)`
 *   L10-15    403/503 + `Server: cloudflare` branch   → verbatim (same message template)
 *   L17-34    Cloudflare title / login-wall branch    → verbatim (same messages + `LoginRequired`)
 *   L35-36    closing braces                          → n/a
 *
 * Adaptation: `okhttp3.Response` is an injected structural interface
 * (`AccessCheckerResponse`: `code` + `header(name)`), because `ZLibraryParserManager`
 * only ever passes the synthetic `fakeResponse()` and nothing in `src/core` should depend on
 * an OkHttp-shaped type. A WHATWG `Response` adapter is a one-liner in the platform layer:
 * `{ code: response.status, header: (n) => response.headers.get(n) }`.
 */

import { LoginRequired, NetworkError } from '../sourceException';
import type { HtmlDocument } from './parser/htmlDocument';

/** Structural stand-in for `okhttp3.Response` (the two members used here). */
export interface AccessCheckerResponse {
  readonly code: number;
  header(name: string): string | null;
}

export const ZLibraryAccessChecker = {
  checkResponse(response: AccessCheckerResponse, htmlDoc: HtmlDocument | null = null): void {
    if (response.code === 403 || response.code === 503) {
      const serverHeader = response.header('Server') ?? '';
      if (serverHeader.toLowerCase().includes('cloudflare')) {
        throw new NetworkError(`触发 Cloudflare 防火墙保护 (HTTP ${response.code})`);
      }
    }

    if (htmlDoc !== null) {
      const title = htmlDoc.title();
      if (
        title.toLowerCase().includes('just a moment') ||
        title.toLowerCase().includes('attention required') ||
        title.toLowerCase().includes('cloudflare')
      ) {
        throw new NetworkError('触发 Cloudflare 人机验证，请更换节点或检查网页访问状态');
      }

      if (
        htmlDoc.select('form[action*=/login]').length > 0 &&
        htmlDoc.select('input[name=email]').length > 0 &&
        htmlDoc.select('.book-item, z-bookcard, .resItemBox, #booksList').length === 0
      ) {
        if (title.toLowerCase().includes('login') || title.toLowerCase().includes('sign in')) {
          throw new LoginRequired();
        }
      }
    }
  },
};
