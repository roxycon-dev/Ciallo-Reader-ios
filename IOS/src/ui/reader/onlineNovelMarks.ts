/**
 * `ui/reader/OnlineNovelMarks.kt`（46 行）→ `src/ui/reader/onlineNovelMarks.ts`。
 *
 * 在线小说的「划线 / 批注」存储：按 `SHA-256(book + "\0" + chapter)` 分桶，
 * 每章最多 100 条，先写的在前。
 *
 * 三处语义：
 *
 * 1. **key 里带 `\u0000`**：书名与章节名任何组合都不会互相撞（`"a" + "b"` 与
 *    `"ab" + ""` 在无分隔符时相同）。
 * 2. **`save` 先按区间找同一条**（`start`/`end` 都相同）并**复用它的 id** ——
 *    编辑同一条批注时 id 不变，列表不会闪成「删一条 + 加一条」。
 * 3. **`load` 与 `save` 都截到 100 条**：`load` 是防御存量数据，`save` 是上限。
 *    顺序是「新条目置首 + 其余保持原序」（`listOf(value) + existing.filter`）。
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { ReaderMark } from './readerTextCoordinates';

/** L10 `data class OnlineNovelMark(id, mark, text, note)`。 */
export interface OnlineNovelMark {
  readonly id: string;
  readonly mark: ReaderMark;
  readonly text: string;
  readonly note: string;
}

/** L13 `getSharedPreferences("online_reader_marks", MODE_PRIVATE)` 的最小形状。 */
export interface OnlineMarksStore {
  getString(key: string): string | null;
  putString(key: string, value: string): void;
}

/** L19 / L31 的上限。 */
export const ONLINE_NOVEL_MARK_LIMIT = 100;
/** L22 / L30 的固定颜色 `Color(0xff71ccba)`。 */
export const ONLINE_NOVEL_MARK_COLOR = 0xff71ccba;
/** L14 的存储名。 */
export const ONLINE_NOVEL_MARKS_STORE = 'online_reader_marks';

/** L14-15 桶键：`SHA-256(book + "\u0000" + chapter)` 的小写十六进制。 */
export function onlineNovelMarksKey(book: string, chapter: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${book}\u0000${chapter}`)));
}

/** L12 `internal class OnlineNovelMarks(context, book, chapter)`。 */
export class OnlineNovelMarks {
  private readonly key: string;

  constructor(
    private readonly store: OnlineMarksStore,
    book: string,
    chapter: string,
  ) {
    this.key = onlineNovelMarksKey(book, chapter);
  }

  /** L17-25 `load()` —— 坏 JSON 一律返回空列表（`runCatching().getOrDefault(emptyList())`）。 */
  load(): OnlineNovelMark[] {
    try {
      const raw: unknown = JSON.parse(this.store.getString(this.key) ?? '[]');
      if (!Array.isArray(raw)) return [];
      const out: OnlineNovelMark[] = [];
      for (const item of raw.slice(0, ONLINE_NOVEL_MARK_LIMIT)) {
        const record = item as Record<string, unknown>;
        out.push({
          id: String(record['id']),
          mark: {
            start: Number(record['start']),
            end: Number(record['end']),
            underline: record['underline'] === true,
            color: ONLINE_NOVEL_MARK_COLOR,
          },
          text: String(record['text']),
          note: typeof record['note'] === 'string' ? record['note'] : '',
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * L27-32 `save(existing, start, end, text, note, underline)`。
   *
   * 同区间复用 id；新条目置首；整体截到 100 条。
   */
  save(
    existing: readonly OnlineNovelMark[],
    start: number,
    end: number,
    text: string,
    note: string,
    underline: boolean,
  ): OnlineNovelMark[] {
    const previous = existing.find((item) => item.mark.start === start && item.mark.end === end);
    const value: OnlineNovelMark = {
      id: previous?.id ?? randomUuid(),
      mark: { start, end, underline, color: ONLINE_NOVEL_MARK_COLOR },
      text,
      note,
    };
    const merged = [value, ...existing.filter((item) => item.id !== value.id)].slice(0, ONLINE_NOVEL_MARK_LIMIT);
    return this.persist(merged);
  }

  /** L34-35 `remove(existing, id)`。 */
  remove(existing: readonly OnlineNovelMark[], id: string): OnlineNovelMark[] {
    return this.persist(existing.filter((item) => item.id !== id));
  }

  /** L37-45 `persist(marks)` —— 字段顺序与 Kotlin 的 `put` 链一致。 */
  private persist(marks: readonly OnlineNovelMark[]): OnlineNovelMark[] {
    const array = marks.map((item) => ({
      id: item.id,
      start: item.mark.start,
      end: item.mark.end,
      text: item.text,
      note: item.note,
      underline: item.mark.underline,
    }));
    this.store.putString(this.key, JSON.stringify(array));
    return [...marks];
  }
}

/** `UUID.randomUUID()`（缺 WebCrypto 时明确抛错，不返回固定值）。 */
function randomUuid(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (webCrypto === undefined) throw new Error('当前环境缺少 crypto.randomUUID');
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
