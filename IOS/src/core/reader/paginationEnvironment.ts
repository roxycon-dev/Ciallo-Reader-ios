/**
 * 分页环境与缓冲 —— `ui/ReaderPagination.kt` L64-200 + L284-448 的逐行移植。
 *
 * Kotlin 这个文件把「排版参数 → 分页结果」的缓存键、分块、页锚点、以及渐进发布的
 * 单章缓冲放在一起；Web 侧的排版器不同（`webTextLayout.ts`），但**缓存键、分块规则、
 * 页锚点、发布时序必须一致**，否则同一章在两端的页码与「是否已读完」判定会分叉。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L64-77   `data class PaginationKey(... widthPx / pageHeightPx / firstPageHeightPx / bodyStyle /
 *            fontSizePx / lineHeightPx / fontFamily / includeFontPadding / titleReservePx /
 *            layoutEnvironment)`                                 → `PaginationKey`
 *   L80-93   `class PaginationTextLayout(style)`：`equals` 只比布局字段，
 *            `hashCode` = fontSize/lineHeight/fontFamily/fontWeight/letterSpacing 的组合
 *                                                                → `PaginationTextLayout`
 *   L95-100  `data class PaginationLayoutEnvironment(textLayout, density, fontScale, fontResolverToken)`
 *                                                                → `PaginationLayoutEnvironment`
 *   L103-119 `object PaginationFontEnvironments`：`WeakReference` + 上限 64 + `tokenFor(resolver)`
 *                                                                → `PaginationFontEnvironments`
 *   L122      `PAGE_VERTICAL_PADDING_DP = 12`                    → 同名
 *   L125      `PAGE_TEXT_BOTTOM_PADDING_DP = 16`                 → 同名
 *   L128-135 `shouldCelebrateAfterForwardTurn(...)`              → 同名
 *   L138      `TITLE_BLOCK_PADDING_DP = 20`                      → 同名
 *   L141      `LARGE_CHAPTER_THRESHOLD = 200_000`                → 同名
 *   L144      `PAGINATION_CHUNK_CHARS = 40_000`（private）        → 同名导出
 *   L147      `EAGER_CHAPTER_THRESHOLD = 60_000`（private）       → 同名导出
 *   L150-167 `class ChapterPageBuffer(initialKey, initialPages)`：`request` / `publish(key, result, complete)`
 *                                                                → `ChapterPageBuffer`
 *   L169-176 `pageIndexAtOffset(pages, offset)`                  → 同名
 *   L179-199 `class ReaderPageAnchors(pages)`：前缀和 + 二分 `pageAt` / `startOf`
 *                                                                → `ReaderPageAnchors`
 *   L284-293 `private class LayoutParams(... bodyStyle / fontFamilyResolver ...)` → `LayoutParams`
 *   L326-370 `paginationChunkRanges(content, maxChars, cancellationCheck)`
 *   L378-427 `paginationImageTokenRanges(content, cancellationCheck)`
 *   L430-448 `private class PaginationItems(initialCapacity)`：`add` / `endAt` / `heightAt`
 *
 * 说明：分块与图片 token 的扫描是**逐字符**逻辑（含 UTF-16 代理对与 CRLF 保护），
 * 这里逐行照抄；`[IMG:path|w|h]` 的判定与 Kotlin 完全一致。
 */

export interface PaginationKey {
  readonly widthPx: number;
  readonly pageHeightPx: number;
  readonly firstPageHeightPx: number;
  /** Kotlin `bodyStyle: TextStyle`（Web 侧是 CSS 相关字段的投影）。 */
  readonly bodyStyle: PaginationTextLayout;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly fontFamily: string;
  readonly includeFontPadding: boolean;
  readonly titleReservePx: number;
  /** L76 `layoutEnvironment: Any? = null`：不透明可选环境（保留源兼容）。 */
  readonly layoutEnvironment: PaginationLayoutEnvironment | null;
}

/** `TextStyle` 里影响布局的属性（L81-82 `hasSameLayoutAffectingAttributes`）。 */
export interface LayoutAffectingStyle {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly letterSpacing: number;
}

/** L80-93 `class PaginationTextLayout`：只比布局字段，绘制属性变化不丢排版结果。 */
export class PaginationTextLayout {
  constructor(readonly style: LayoutAffectingStyle) {}

  equals(other: PaginationTextLayout): boolean {
    return (
      this.style.fontSize === other.style.fontSize &&
      this.style.lineHeight === other.style.lineHeight &&
      this.style.fontFamily === other.style.fontFamily &&
      this.style.fontWeight === other.style.fontWeight &&
      this.style.letterSpacing === other.style.letterSpacing
    );
  }

  /** L84-92 `hashCode()`：布局子集的 31 进制组合。 */
  hashCode(): number {
    let result = hashNumber(this.style.fontSize);
    result = (31 * result + hashNumber(this.style.lineHeight)) | 0;
    result = (31 * result + hashString(this.style.fontFamily)) | 0;
    result = (31 * result + hashNumber(this.style.fontWeight)) | 0;
    result = (31 * result + hashNumber(this.style.letterSpacing)) | 0;
    return result;
  }

  get key(): string {
    return [
      this.style.fontSize,
      this.style.lineHeight,
      this.style.fontFamily,
      this.style.fontWeight,
      this.style.letterSpacing,
    ].join('|');
  }
}

function hashNumber(v: number): number {
  // `Float.hashCode()` 的等价：位模式本身。
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = v;
  return new Int32Array(buf)[0] ?? 0;
}

function hashString(v: string): number {
  let h = 0;
  for (let i = 0; i < v.length; i += 1) h = (Math.imul(31, h) + v.charCodeAt(i)) | 0;
  return h;
}

/** L95-100 `PaginationLayoutEnvironment`。 */
export interface PaginationLayoutEnvironment {
  readonly textLayout: PaginationTextLayout;
  readonly density: number;
  readonly fontScale: number;
  /** `fontResolverToken: Any` —— 稳定的不透明身份（见 `PaginationFontEnvironments`）。 */
  readonly fontResolverToken: object;
}

/** L103-119 `object PaginationFontEnvironments`。 */
export class PaginationFontEnvironments {
  /** L105 `class Entry(resolver: WeakReference<Any>, token: Any)`。 */
  private readonly entries: { readonly resolver: WeakRef<object>; readonly token: object }[] = [];

  /** L107-118 `tokenFor(resolver)`：同一 resolver 恒得同一 token；上限 64 条。 */
  tokenFor(resolver: object): object {
    for (let i = 0; i < this.entries.length; i += 1) {
      const entry = this.entries[i];
      if (entry === undefined) continue;
      const retained = entry.resolver.deref();
      if (retained === undefined) {
        this.entries.splice(i, 1);
        i -= 1;
      } else if (retained === resolver) {
        return entry.token;
      }
    }
    // L115-116 元数据也是有界的；淘汰只会造成未来一次缓存未命中。
    if (this.entries.length >= 64) this.entries.shift();
    const token = {};
    this.entries.push({ resolver: new WeakRef(resolver), token });
    return token;
  }

  get size(): number {
    return this.entries.length;
  }
}

/** 进程级单例（Kotlin `object`）。 */
export const paginationFontEnvironments = new PaginationFontEnvironments();

/** L122 `PAGE_VERTICAL_PADDING_DP = 12`。 */
export const PAGE_VERTICAL_PADDING_DP = 12;
/** L125 `PAGE_TEXT_BOTTOM_PADDING_DP = 16`。 */
export const PAGE_TEXT_BOTTOM_PADDING_DP = 16;
/** L138 `TITLE_BLOCK_PADDING_DP = 20`。 */
export const TITLE_BLOCK_PADDING_DP = 20;
/** L141 `LARGE_CHAPTER_THRESHOLD = 200_000`。 */
export const LARGE_CHAPTER_THRESHOLD = 200_000;
/** L144 `PAGINATION_CHUNK_CHARS = 40_000`。 */
export const PAGINATION_CHUNK_CHARS = 40_000;
/** L147 `EAGER_CHAPTER_THRESHOLD = 60_000`。 */
export const EAGER_CHAPTER_THRESHOLD = 60_000;

/**
 * Kotlin ReaderPagination.kt L41-42 的两道上限：
 * MAX_ENTRIES = 8（最多缓存 8 章的排版结果）与 MAX_BYTES = 8 MiB（字节预算）。
 *
 * 缺了这两道限制，长章节连读会把整本书的排版结果留在内存里
 * （大章节 20 万字 × 8 章 ≈ 数十 MB），在 iOS 上直接触发 jetsam。
 */
export const PAGE_BUFFER_MAX_ENTRIES = 8;
export const PAGE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;

/**
 * L128-135 `shouldCelebrateAfterForwardTurn(...)`。
 * 渐进分页尚未覆盖整章时，「最后一页」只是临时末尾，不能触发全书完成。
 */
export function shouldCelebrateAfterForwardTurn(
  chapterIndex: number,
  chapterCount: number,
  pageIndex: number,
  pages: readonly string[],
  formattedLength: number,
): boolean {
  if (chapterCount <= 0) return false;
  if (chapterIndex !== chapterCount - 1) return false;
  if (pages.length === 0) return false;
  if (pageIndex < pages.length - 2) return false;
  let sum = 0;
  for (const p of pages) sum += p.length;
  return sum === formattedLength;
}

/** L150-167 `class ChapterPageBuffer`：最多一份旧排版 + 一份待发布排版。 */
export class ChapterPageBuffer {
  private requestedKey: string;
  private displayedKey: string;
  pages: readonly string[];

  constructor(initialKey: string, initialPages: readonly string[]) {
    this.requestedKey = initialKey;
    this.displayedKey = initialKey;
    this.pages = initialPages;
  }

  /** L157 `request(key)`。 */
  request(key: string): void {
    this.requestedKey = key;
  }

  /** L158-166 `publish(key, result, complete = true)`：过期或未覆盖整章的部分排版一律拒绝。 */
  publish(key: string, result: readonly string[], complete = true): boolean {
    if (this.requestedKey !== key) return false;
    // L161-162：部分重排可能还覆盖不到当前字符锚点，保留旧排版直到完整替换。
    if (!complete && this.displayedKey !== key && this.pages.length > 0) return false;
    this.pages = result;
    this.displayedKey = key;
    return true;
  }

  get requested(): string {
    return this.requestedKey;
  }

  get displayed(): string {
    return this.displayedKey;
  }
}

/** L169-176 `pageIndexAtOffset(pages, offset)`。 */
export function pageIndexAtOffset(pages: readonly string[], offset: number): number {
  let accumulated = 0;
  for (let index = 0; index < pages.length; index += 1) {
    accumulated += (pages[index] ?? '').length;
    if (accumulated > offset || index === pages.length - 1) return index;
  }
  return 0;
}

/** L179-199 `class ReaderPageAnchors`：前缀和一次构建；翻页 O(1)、重锚 O(log n)。 */
export class ReaderPageAnchors {
  private readonly ends: Int32Array;

  constructor(pages: readonly string[]) {
    this.ends = new Int32Array(pages.length);
    let offset = 0;
    for (let index = 0; index < pages.length; index += 1) {
      offset += (pages[index] ?? '').length;
      this.ends[index] = offset;
    }
  }

  /** L188-197 `pageAt(offset)`：第一个 `ends[i] > offset` 的下标。 */
  pageAt(offset: number): number {
    if (this.ends.length === 0) return 0;
    let low = 0;
    let high = this.ends.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.ends[middle] ?? 0) > offset) high = middle;
      else low = middle + 1;
    }
    return low;
  }

  /** L198 `startOf(page)`。 */
  startOf(page: number): number {
    if (page <= 0 || this.ends.length === 0) return 0;
    return this.ends[Math.min(page - 1, this.ends.length - 1)] ?? 0;
  }
}

/** L284-293 `private class LayoutParams`（字段名与 Kotlin 逐项一致，便于对拍）。 */
export interface LayoutParams {
  readonly widthPx: number;
  readonly pageHeightPx: number;
  readonly firstPageHeightPx: number;
  readonly bodyStyle: PaginationTextLayout;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly density: number;
  /** `androidx.compose.ui.text.font.FontFamily.Resolver` 的 Web 投影（不透明对象）。 */
  readonly fontFamilyResolver: object;
}

/**
 * L326-370 `paginationChunkRanges(content, maxChars = 40_000, cancellationCheck)`。
 *
 * 规则逐条：
 *  · 每块最多 `maxChars`；在块的后半段找 `\n`（只向后半段搜，不重扫前面的正文）；
 *  · 图片 token `[IMG:…]` 不能被切断（整体推到下一块或整块保留）；
 *  · 硬切时保护 UTF-16 代理对与 CRLF。
 */
export function paginationChunkRanges(
  content: string,
  maxChars: number = PAGINATION_CHUNK_CHARS,
  cancellationCheck: () => void = () => {},
): readonly (readonly [number, number])[] {
  if (!(maxChars > 0)) throw new RangeError('maxChars must be positive');
  cancellationCheck();
  const out: (readonly [number, number])[] = [];
  const tokens = hasInlineImages(content) ? paginationImageTokenRanges(content, cancellationCheck) : null;
  let tokenIndex = 0;
  let token: readonly [number, number] | null = tokens !== null && tokens.length > 0 ? (tokens[0] ?? null) : null;
  let start = 0;
  while (start < content.length) {
    cancellationCheck();
    let end = start + Math.min(content.length - start, maxChars);
    if (end < content.length) {
      // L343 只在块的后半段找换行。
      const earliestNewline = start + Math.floor(maxChars / 2);
      let newline = end;
      while (newline >= earliestNewline && content[newline] !== '\n') {
        if ((newline & 1023) === 0) cancellationCheck();
        newline -= 1;
      }
      if (newline >= earliestNewline) end = newline + 1;
      while (token !== null && token[1] < start) {
        tokenIndex += 1;
        token = tokens !== null ? (tokens[tokenIndex] ?? null) : null;
      }
      while (token !== null && token[0] < end) {
        if (token[1] >= end) {
          end = token[0] > start ? token[0] : token[1] + 1;
          break;
        }
        tokenIndex += 1;
        token = tokens !== null ? (tokens[tokenIndex] ?? null) : null;
      }
      if (end < content.length && end > start) {
        const prev = content.charCodeAt(end - 1);
        const next = content.charCodeAt(end);
        const halfSurrogatePair = prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
        const crlf = content[end - 1] === '\r' && content[end] === '\n';
        if (halfSurrogatePair || crlf) {
          end = end - 1 > start ? end - 1 : end + 1;
        }
      }
    }
    out.push([start, end]);
    start = end;
  }
  return out;
}

/** `NovelInlineImages.hasImages(content)`：含 `[IMG:` 即视为有内嵌图。 */
export function hasInlineImages(content: string): boolean {
  return content.includes('[IMG:');
}

/**
 * L378-427 `paginationImageTokenRanges(content, cancellationCheck)`。
 * 返回 `[start, endInclusive]` 的闭区间（与 Kotlin `IntRange` 一致）。
 */
export function paginationImageTokenRanges(
  content: string,
  cancellationCheck: () => void = () => {},
): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  let search = 0;
  const len = content.length;
  while (search <= len - 5) {
    cancellationCheck();
    let start = search;
    while (start <= len - 5 && !content.startsWith('[IMG:', start)) {
      if ((start & 1023) === 0) cancellationCheck();
      start += 1;
    }
    if (start > len - 5) break;
    let cursor = start + 5;
    const pathStart = cursor;
    while (cursor < len && content[cursor] !== '|' && content[cursor] !== ']') {
      if ((cursor & 1023) === 0) cancellationCheck();
      cursor += 1;
    }
    if (cursor === len) break;
    if (cursor === pathStart || content[cursor] !== '|') {
      search = cursor;
      continue;
    }
    cursor += 1;
    const widthStart = cursor;
    while (cursor < len && isDigit(content[cursor])) {
      if ((cursor & 1023) === 0) cancellationCheck();
      cursor += 1;
    }
    if (cursor === len) break;
    if (cursor === widthStart || content[cursor] !== '|') {
      search = cursor;
      continue;
    }
    cursor += 1;
    const heightStart = cursor;
    while (cursor < len && isDigit(content[cursor])) {
      if ((cursor & 1023) === 0) cancellationCheck();
      cursor += 1;
    }
    if (cursor === len) break;
    if (cursor === heightStart || content[cursor] !== ']') {
      search = cursor;
      continue;
    }
    out.push([start, cursor]);
    search = cursor + 1;
  }
  return out;
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** L430-448 `private class PaginationItems(initialCapacity)`：行尾偏移 + 行高。 */
export class PaginationItems {
  private ends: Int32Array;
  private heights: Float32Array;
  size = 0;

  constructor(initialCapacity: number) {
    this.ends = new Int32Array(Math.max(initialCapacity, 1));
    this.heights = new Float32Array(Math.max(initialCapacity, 1));
  }

  /** L436-444 `add(end, height)`：容量不足时翻倍。 */
  add(end: number, height: number): void {
    if (this.size === this.ends.length) {
      const nextEnds = new Int32Array(this.size * 2);
      nextEnds.set(this.ends);
      this.ends = nextEnds;
      const nextHeights = new Float32Array(this.size * 2);
      nextHeights.set(this.heights);
      this.heights = nextHeights;
    }
    this.ends[this.size] = end;
    this.heights[this.size] = height;
    this.size += 1;
  }

  endAt(index: number): number {
    return this.ends[index] ?? 0;
  }

  heightAt(index: number): number {
    return this.heights[index] ?? 0;
  }
}
