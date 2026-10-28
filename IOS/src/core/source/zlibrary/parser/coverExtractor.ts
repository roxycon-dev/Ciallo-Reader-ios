/**
 * Kotlin → TS: `source/zlibrary/parser/CoverExtractor.kt` (71 lines, 58 non-blank)
 *             → `src/core/source/zlibrary/parser/coverExtractor.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary.parser → SKIPPED (TS has no packages)
 *   L3        import android.util.Log        → `import { SourceLog } from '../../sourceLog'`
 *   L4        import org.jsoup.nodes.Element  → `import type { HtmlElement } from './htmlDocument'`
 *   L6-9      KDoc 统一封面提取…                 → preserved verbatim on `CoverExtractor`
 *   L10       internal object CoverExtractor  → `export const CoverExtractor`
 *   L12       private const val TAG           → `const TAG = 'ZLibCover'` inside the object
 *   L14       fun extract(root: Element)      → `extract(root: HtmlElement)`
 *   L15-18    `attrs` list literal             → verbatim
 *   L19       candidates list                 → verbatim
 *   L21-33    img attribute + srcset loop      → verbatim
 *   L34-39    `picture source[srcset]` loop    → verbatim
 *   L41-47    `style*='background-image'` loop  → verbatim
 *   L49-52    clean = map/filter/distinct      → verbatim (Set keeps first-occurrence order)
 *   L54-57    empty → Log.d + return ""        → verbatim message; `Log.d` → `SourceLog.log`
 *   L59-64    preferred cdn-zlib.sk/s3proxy    → verbatim
 *   L66-69    first http(s) or // else first  → verbatim
 *   L70-71    closing braces                   → n/a
 *
 * Adaptations:
 *   - `android.util.Log.d(TAG, …)` → `SourceLog.log(TAG, …)`; the project-wide
 *     `src/core/source/sourceLog.ts` buffer is the only logging channel in `src/core`.
 *   - `String.take(900)` → `.slice(0, 900)`.
 *   - `distinct()` → `Array.from(new Set(...))` (stable, first occurrence wins).
 *   - `String.contains(other, ignoreCase = true)` → `.toLowerCase().includes(...)` on both
 *     sides (Kotlin's ignoreCase comparison is locale-invariant).
 *   - `Regex.findAll(...).forEach` → `exec`-loop / `matchAll`.
 */

import { SourceLog } from '../../sourceLog';
import type { HtmlElement } from './htmlDocument';

export const CoverExtractor = {
  /**
   * 统一封面提取：兼容新版 z-bookcard 的 img 各种懒加载属性、srcset、
   * data-* 属性和 style 里的 background-image，以及协议相对地址 //host/...。
   */
  extract(root: HtmlElement): string {
    const attrs = [
      'data-src', 'data-original', 'data-lazy-src', 'data-url', 'src',
      'data-cover', 'data-img', 'data-image', 'data-background', 'data-bg',
    ];
    const candidates: string[] = [];

    // 收集所有 img / source 上的属性值
    for (const img of root.select('img')) {
      for (const attr of attrs) {
        const value = img.attr(attr).trim();
        if (value !== '' && !value.startsWith('data:image')) {
          candidates.push(value);
        }
      }
      for (const part of img.attr('srcset').split(',')) {
        const first = part.trim().split(' ')[0] ?? '';
        if (first.trim() !== '') candidates.push(first);
      }
    }
    for (const source of root.select('picture source[srcset], source[srcset]')) {
      for (const part of source.attr('srcset').split(',')) {
        const first = part.trim().split(' ')[0] ?? '';
        if (first.trim() !== '') candidates.push(first);
      }
    }

    // 新版页面有时把封面写在 style="background-image:url(...)"
    for (const el of root.select("[style*='background-image'], [style*='background']")) {
      for (const hit of el.attr('style').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        const value = (hit[1] ?? '').trim();
        if (value !== '') candidates.push(value);
      }
    }

    const clean = Array.from(
      new Set(
        candidates
          .map((it) => it.trim())
          .filter((it) => it !== '' && !it.startsWith('data:image')),
      ),
    );

    if (clean.length === 0) {
      SourceLog.log(TAG, `no cover in: ${root.outerHtml().slice(0, 900)}`);
      return '';
    }

    // 优先选能直接访问的 cdn-zlib.sk / s3proxy 封面域名
    const preferred = clean.find(
      (it) => it.toLowerCase().includes('cdn-zlib.sk') || it.toLowerCase().includes('s3proxy'),
    );
    if (preferred !== undefined) return preferred;

    // 其次选第一个 http(s) 或协议相对地址
    const absolute = clean.find(
      (it) => it.startsWith('http://') || it.startsWith('https://') || it.startsWith('//'),
    );
    return absolute ?? (clean[0] as string);
  },
};

/** Kotlin `private const val TAG = "ZLibCover"`. */
const TAG = 'ZLibCover';
