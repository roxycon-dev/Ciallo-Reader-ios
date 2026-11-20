/**
 * `data/LegacyEpubLayout.kt`（120 行）→ `src/core/data/legacyEpubLayout.ts`。
 *
 * 老版本导入的 EPUB 只存了纯文本（没有 `formatting` / `writingMode`）。这个模块在
 * 阅读器打开旧书时**补算**排版：重新解析 EPUB 拿到带样式的文本，再把新样式
 * 「对齐」到旧正文的字符坐标上。
 *
 * 对齐为什么要按「可见字符」而不是下标：旧正文经过了空白折叠（HTML 里连续空白
 * 变一个空格、块级标签之间插换行），新解析出来的文本空格数不同 → 直接按下标平移
 * 会把样式画到隔壁字上。所以 `transferBookStyles` 先各自求「非空白且非图片 token
 * 的字符序列」，要求两者**逐字相同**，再按序列下标映射。
 *
 * 三处细节：
 * 1. **`[IMG:…]` 整体跳过**：图片 token 在两次解析里可能位置一致但内容不同，
 *    参与比对会让整本书判为「对不上」。
 * 2. **`from.size != to.size` 或任一字符不同 → 返回 null**（整本放弃补算），
 *    而不是尽力对齐 —— 错位的样式比没有样式更糟。
 * 3. **`nextIndex` 用 `binarySearch` 的插入点**：`style.end` 落在两字符之间时，
 *    `-1` 后得到「最后一个仍在区间内的字符下标」。
 */
import type { BookTextSpan } from './formattedBookText';

/**
 * L100-120 `transferBookStyles(fresh, existing, styles)`。
 *
 * 返回 `null` 表示「对不齐，放弃」。
 */
export function transferBookStyles(
  fresh: string,
  existing: string,
  styles: readonly BookTextSpan[],
): BookTextSpan[] | null {
  if (fresh === existing) return [...styles];

  const from = visibleIndices(fresh);
  const to = visibleIndices(existing);

  if (from.length !== to.length) return null;
  for (let i = 0; i < from.length; i += 1) {
    if (fresh[(from[i] as number)] !== existing[(to[i] as number)]) return null;
  }

  const nextIndex = (offset: number): number => {
    const found = binarySearch(from, offset);
    return found >= 0 ? found : -found - 1;
  };

  const out: BookTextSpan[] = [];
  for (const style of styles) {
    const start = nextIndex(style.start);
    const end = nextIndex(style.end) - 1;
    if (end < start || start < 0 || start >= to.length) continue;
    out.push({ start: to[start] as number, end: (to[end] as number) + 1, style: style.style });
  }
  return out;
}

/**
 * L102-109 `visible(text)`：非空白、且不在 `[IMG:…]` 区间内的字符下标（升序）。
 *
 * 图片 token 用一次顺序扫描跳过 —— 正则 `findAll` 得到区间后逐个比对，
 * 比"先删除再记原下标"更省一次分配。
 */
export function visibleIndices(text: string): number[] {
  const ranges: Array<readonly [number, number]> = [];
  const pattern = /\[IMG:[^\]]*\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) ranges.push([match.index, match.index + match[0].length]);

  const out: number[] = [];
  let rangeIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    while (rangeIndex < ranges.length && index >= (ranges[rangeIndex] as readonly [number, number])[1]) rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (range !== undefined && index >= range[0] && index < range[1]) continue;
    if (/\s/.test(text[index] as string)) continue;
    out.push(index);
  }
  return out;
}

/** Kotlin `List<Int>.binarySearch`。 */
function binarySearch(items: readonly number[], key: number): number {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = items[mid] as number;
    if (value < key) low = mid + 1;
    else if (value > key) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

/* ══════════════════════════════════════════════════════════════════════════════
   L16-98 `recoverArchivedEpubLayout(context, book, dao)`
   ══════════════════════════════════════════════════════════════════════════════ */

/** 补算所需的外部能力（`ZipFile` / `BookDao` / `SharedPreferences` 的注入替身）。 */
export interface LegacyLayoutDeps {
  /** `ZipFile(source)` 的读取入口；路径不存在返回 null。 */
  readZipEntry(path: string, cap: number): Promise<Uint8Array | null>;
  /** `BookDao.hasChapterFormatting(bookId)`。 */
  hasChapterFormatting(bookId: number): Promise<boolean>;
  /** `BookDao.getChaptersByOrders(bookId, orders)`（按 chapterOrder 命中）。 */
  getChaptersByOrders(bookId: number, orders: readonly number[]): Promise<ReadonlyArray<ChapterRow>>;
  /** `BookDao.setChapterFormatting(bookId, rowId, content, formatting, writingMode)`。 */
  setChapterFormatting(
    bookId: number,
    rowId: number,
    content: string,
    formatting: string | null,
    writingMode: string | null,
  ): Promise<void>;
  /** `SharedPreferences("ebook_layout_read")` 的两条操作。 */
  getCachedSignature(key: string): Promise<string | null>;
  putCachedSignature(key: string, value: string): Promise<void>;
  /** `readBookHtml(html, styleSheets, defaultWritingMode)`。 */
  readBookHtml(html: string, styleSheets: readonly string[], defaultWritingMode: string | null): { text: string; spans: readonly BookTextSpan[]; writingMode: string | null };
  /** `EpubParser.extractCleanTextFromHtml(xhtml)`。 */
  extractCleanText(html: string): string;
}

/** `BookDao` 里用到的列。 */
export interface ChapterRow {
  readonly id: number;
  readonly chapterOrder: number;
  readonly content: string;
}

/** `recoverArchivedEpubLayout` 的输入书。 */
export interface LegacyBook {
  readonly id: number;
  readonly isComic: boolean;
  readonly filePath: string;
}

/** L29-32 每 12 章落一次库（Kotlin `if (pending.size >= 12) applyBatch()`）。 */
export const LEGACY_LAYOUT_BATCH = 12;
/** L35 单条目上限 2 MiB；样式表 512 KiB、container 128 KiB。 */
export const LEGACY_ENTRY_CAP = 2 * 1024 * 1024;
export const LEGACY_STYLESHEET_CAP = 512_000;
export const LEGACY_CONTAINER_CAP = 128 * 1024;

/**
 * L16-98 `recoverArchivedEpubLayout`。
 *
 * 早退条件（顺序照抄）：非漫画、路径不是本地文件、扩展名不是 epub、
 * 签名（size:mtime）与缓存一致、`hasChapterFormatting` 已为真。
 *
 * 返回值：`true` 表示本次真的补算了（调试与测试用）。
 */
export async function recoverArchivedEpubLayout(
  deps: LegacyLayoutDeps,
  book: LegacyBook,
  signatureOf: (path: string) => Promise<{ size: number; modified: number; isFile: boolean; extension: string } | null>,
): Promise<boolean> {
  if (book.isComic) return false;
  const info = await signatureOf(book.filePath);
  if (info === null || !info.isFile || info.extension.toLowerCase() !== 'epub') return false;

  const cacheKey = `epub:${String(book.id)}`;
  const signature = `${String(info.size)}:${String(info.modified)}`;
  if ((await deps.getCachedSignature(cacheKey)) === signature) return false;
  if (await deps.hasChapterFormatting(book.id)) {
    await deps.putCachedSignature(cacheKey, signature);
    return false;
  }

  const read = async (path: string, cap: number): Promise<string | null> => {
    const bytes = await deps.readZipEntry(path, cap);
    if (bytes === null) return null;
    return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  };

  const container = await read('META-INF/container.xml', LEGACY_CONTAINER_CAP);
  if (container === null) return false;
  const packagePath = firstAttr(container, 'rootfile', 'full-path');
  if (packagePath === null) return false;
  const opf = await read(packagePath, LEGACY_ENTRY_CAP);
  if (opf === null) return false;

  const byHref = manifestHrefs(opf);
  const packageMode = packageWritingMode(opf);

  const styles = new Map<string, string>();
  let physical = 0;
  let pending: ChapterDraft[] = [];

  const applyBatch = async (): Promise<void> => {
    if (pending.length === 0) return;
    const rows = await deps.getChaptersByOrders(book.id, pending.map((draft) => draft.chapterOrder));
    const byOrder = new Map<number, ChapterRow>();
    for (const row of rows) byOrder.set(row.chapterOrder, row);
    for (const fresh of pending) {
      const old = byOrder.get(fresh.chapterOrder);
      if (old === undefined) continue;
      const aligned = transferBookStyles(fresh.content, old.content, fresh.spans);
      if (aligned === null) continue;
      await deps.setChapterFormatting(book.id, old.id, old.content, encodeSpans(aligned), fresh.writingMode);
    }
    pending = [];
  };

  for (const idref of spineIdrefs(opf)) {
    const href = byHref.get(idref);
    if (href === undefined) continue;
    const path = resolveLegacyPath(packagePath, href);
    if (path === null) continue;
    const xhtml = await read(path, LEGACY_ENTRY_CAP);
    if (xhtml === null) continue;

    const sheetPaths: string[] = [];
    for (const cssHref of stylesheetHrefs(xhtml).slice(0, 24)) {
      const cssPath = resolveLegacyPath(path, cssHref);
      if (cssPath === null) continue;
      const cached = styles.get(cssPath);
      if (cached !== undefined) {
        sheetPaths.push(cached);
        continue;
      }
      const css = await read(cssPath, LEGACY_STYLESHEET_CAP);
      if (css === null) continue;
      if (styles.size < 48) styles.set(cssPath, css);
      sheetPaths.push(css);
    }

    const parsed = deps.readBookHtml(xhtml, sheetPaths, packageMode);
    const priorText = deps.extractCleanText(xhtml);
    const aligned = transferBookStyles(parsed.text, priorText, parsed.spans);
    const rows = splitForLayout(priorText, aligned ?? [], parsed.writingMode, physical);
    physical += rows.length;
    for (const row of rows) {
      if (row.formatting !== null || row.writingMode !== null) pending.push(row);
    }
    if (pending.length >= LEGACY_LAYOUT_BATCH) await applyBatch();
  }
  await applyBatch();

  await deps.putCachedSignature(cacheKey, signature);
  return true;
}

interface ChapterDraft {
  readonly chapterOrder: number;
  readonly content: string;
  readonly spans: readonly BookTextSpan[];
  readonly formatting: string | null;
  readonly writingMode: string | null;
}

/** `FormattedBookText(...).chapters(bookId, physical, "")` 的最小投影（这里只需要草稿）。 */
function splitForLayout(
  text: string,
  spans: readonly BookTextSpan[],
  writingMode: string | null,
  fromOrder: number,
): ChapterDraft[] {
  const parts = splitByLimit(text, 30_000);
  const out: ChapterDraft[] = [];
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string;
    const end = offset + part.length;
    const local = spans
      .filter((span) => span.start < end && span.end > offset)
      .map((span) => ({ start: Math.max(span.start, offset) - offset, end: Math.min(span.end, end) - offset, style: span.style }));
    out.push({
      chapterOrder: fromOrder + index,
      content: part,
      spans: local,
      formatting: encodeSpans(local),
      writingMode,
    });
    offset = end;
  }
  return out;
}

/** 与 `splitChapterText` 相同的切分（这里避免循环依赖，只按长度硬切）。 */
function splitByLimit(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += limit) parts.push(text.slice(offset, offset + limit));
  return parts;
}

function encodeSpans(spans: readonly BookTextSpan[]): string | null {
  if (spans.length === 0) return null;
  return spans.map((span) => `${String(span.start)},${String(span.end)},${String(span.style)}`).join(';');
}

/** L43-50 `resolve(origin, href)`：拒绝对路径、带 scheme、反斜杠与越界。 */
export function resolveLegacyPath(origin: string, href: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(href.split('#')[0]?.split('?')[0] ?? '');
  } catch {
    return null;
  }
  if (relative.startsWith('/') || relative.includes(':') || relative.includes('\\')) return null;
  const slash = origin.lastIndexOf('/');
  const directory = slash < 0 ? '' : origin.slice(0, slash);
  const joined = `${directory}/${relative}`;
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const path = segments.join('/');
  return path === '' ? null : path;
}

/* ── 极简 OPF / XHTML 提取（只需要属性与 idref，不建 DOM） ───────────────── */

function firstAttr(xml: string, tag: string, attr: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match?.[1] ?? null;
}

/** L57 `manifest > item[id][href]` → id → href。 */
function manifestHrefs(opf: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = /\bid\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (id !== undefined && href !== undefined) out.set(id, href);
  }
  return out;
}

/** L76 `spine > itemref[idref]`。 */
function spineIdrefs(opf: string): string[] {
  const out: string[] = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = /\bidref\s*=\s*"([^"]*)"/i.exec(match[0])?.[1];
    if (idref !== undefined) out.push(idref);
  }
  return out;
}

/** L58-62 `meta[name=primary-writing-mode]` 或 `meta[property$=:writing-mode]`。 */
function packageWritingMode(opf: string): string | null {
  let mode: string | null = null;
  for (const match of opf.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /\bname\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    const property = /\bproperty\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (name.toLowerCase() !== 'primary-writing-mode' && !property.toLowerCase().endsWith(':writing-mode')) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    mode = normalizeMode(content);
  }
  return mode;
}

function normalizeMode(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'vertical-rl' || normalized === 'tb-rl') return 'vertical-rl';
  if (normalized === 'vertical-lr' || normalized === 'tb-lr') return 'vertical-lr';
  if (['horizontal-tb', 'horizontal-lr', 'horizontal-rl', 'lr-tb'].includes(normalized)) return 'horizontal-tb';
  return null;
}

/** L81 `link[rel=stylesheet][href]`。 */
function stylesheetHrefs(xhtml: string): string[] {
  const out: string[] = [];
  for (const match of xhtml.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = /\brel\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (rel.toLowerCase() !== 'stylesheet') continue;
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (href !== undefined) out.push(href);
  }
  return out;
}
