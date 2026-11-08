/**
 * 神回数据模型 + 序列化 —— Android `god/GodMomentModels.kt`（335 行 / 300 非空）逐值移植。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/GodMomentModels.kt`）：
 *   - 21-30  `GodContentType`（COMIC/NOVEL + `of(code)` 兜底 COMIC）→ `GodContentType` / `GOD_CONTENT_TYPE_LABELS`
 *   - 33-43  `GodRankingStyle`（label/desc）→ `@core/god/godRankingSettings.GOD_RANKING_STYLES`
 *   - 46-50  `GodSort`（rating/recent/book）→ `GodSort` / `GOD_SORT_LABELS`
 *   - 59-78  `CoverSource`（ComicPage/Album/NovelExcerpt）→ 判别联合 `CoverSource`
 *   - 80-84  `CoverSource.toTag()` → `coverSourceToTag()`
 *   - 86-104 `parseCoverSource()`（含 `toIntOrNull` 脏值兜底）→ `parseCoverSource()`
 *   - 117-135 `CropParams` + `cropAspect` + `toTag()` → `CropParams` / `cropParamsToTag()`
 *   - 142-156 `CropParams.parse()`（`coerceIn(0,1)` + `normalized()`）→ `parseCropParams()`
 *   - 159-170 `CropParams.normalized()`（左右/上下归正 + 0.02 最小边）→ `normalizeCropParams()`
 *   - 174-175 `round3()` → `kotlinFloat3String()`（含 Kotlin `Float.toString()` 的十进制格式）
 *   - 186-234 `GodMomentEntity`（16 列 + `source`/`crop`/`effectiveTitle`/`defaultTitle`）→ `GodMoment`
 *   - 228-229 `effectiveTitle()` → `effectiveGodTitle()`
 *   - 231-233 `defaultTitle()` → `defaultGodTitle()`
 *   - 238-241 `GodMomentItem` → `GodMomentItem`
 *   - 266-277 `GodMomentRequest` → `GodMomentInput` / `GodMomentPatch`（见 godReaderBinding 的同名类型）
 *   - 327-335 `sortedForRanking(sort)` → `sortGodMoments()` / `rankGodMoments()`
 *
 * 本次逐行复核的修正：
 *   - **`cropParamsToTag` 的落库字节**（L135-137 + L174-175）：Kotlin `round3()` 用
 *     `Float.toString()`，恒带一位小数 ⇒ 默认值是 `"1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0"`；
 *     此前 TS 用 `String(round3(v))` 得到 `"1,0,0,0,0,0,1,1"` —— 能解析回来但**字节不同**，
 *     跨端备份比对 / 逐行 diff 会不一致。改为按 `k/1000` 直接拼 Kotlin 格式。
 *   - **`parseCropParams` 的脏值判定**（L145 `p.getOrNull(i)?.toFloatOrNull() ?: d`）：
 *     `Number.parseFloat` 是前缀解析（`"1,5"`→1、`" 1.5"`→1.5、`"1.5abc"`→1.5），
 *     Kotlin `toFloatOrNull()` 三种全部 `null` → 回落默认值。新增 `kotlinToFloatOrNull()`
 *     （整串匹配 + 剥 `f`/`F` 后缀），与本文件既有的 `kotlinToIntOrNull()` 同一套理由。
 *   - **`defaultGodTitle` 的 `ifBlank` 语义**（L231-233）：`chapterTitle.ifBlank { … }`
 *     在非 blank 时返回**原串**，此前 TS 返回 `chapterTitle.trim()`，把两端空白吃掉。
 *
 * 本文件是 `src/core`，不 import React / DOM / Capacitor。
 */

export const GOD_RATING_MIN = 0.5;
export const GOD_RATING_MAX = 5;
export const GOD_RATING_STEP = 0.5;
export const GOD_TITLE_MAX = 30;
export const GOD_NOTE_MAX = 500;

export type GodContentType = 'comic' | 'novel';

export const GOD_CONTENT_TYPE_LABELS: Record<GodContentType, string> = {
  comic: '漫画',
  novel: '小说',
};

export type GodSort = 'rating' | 'recent' | 'book';

export const GOD_SORT_LABELS: Record<GodSort, string> = {
  rating: '评分',
  recent: '最近添加',
  book: '书籍',
};

export interface GodMoment {
  id: number;
  contentType: GodContentType;
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  title: string;
  titleIsCustom: boolean;
  rating: number;
  note: string;
  coverPath: string | null;
  coverSource: string;
  cropParams: string;
  createdAt: number;
  updatedAt: number;
}

export interface GodMomentItem {
  entity: GodMoment;
  rank: number;
}

export interface GodMomentInput {
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle?: string;
  chapterNumber?: number;
  contentType?: GodContentType;
  title?: string;
  titleIsCustom?: boolean;
  rating?: number;
  note?: string;
  coverPath?: string | null;
  coverSource?: string;
  cropParams?: string;
}

export type GodMomentPatch = Partial<Omit<GodMoment, 'id' | 'createdAt'>>;

export type CoverSource =
  | { kind: 'comicPage'; pageIndex: number; pageId: string }
  | { kind: 'album'; uri: string }
  | { kind: 'novelExcerpt'; chapterId: string; start: number; end: number };

export interface CropParams {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  cropL: number;
  cropT: number;
  cropR: number;
  cropB: number;
}

export const DEFAULT_CROP_PARAMS: CropParams = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  cropL: 0,
  cropT: 0,
  cropR: 1,
  cropB: 1,
};

export function clampGodRating(value: number): number {
  const stepped = Math.round(value / GOD_RATING_STEP) * GOD_RATING_STEP;
  const clamped = Math.min(GOD_RATING_MAX, Math.max(GOD_RATING_MIN, stepped));
  return Math.round(clamped * 10) / 10;
}

export function formatGodRating(value: number): string {
  return value.toFixed(1);
}

export function defaultGodTitle(
  bookTitle: string,
  chapterTitle: string,
  chapterNumber: number,
): string {
  // Kotlin `defaultTitle()`（GodMomentModels.kt L231-233）：
  //   `if (bookTitle.isBlank()) (chapterTitle.ifBlank { "第${chapterNumber}话" }) else …`
  // ⚠️ `ifBlank` 返回的是**原串**（只在 blank 时用默认值），所以这里必须返回未裁剪的
  // `chapterTitle` —— 此前返回 `chapterTitle.trim()`，把两端空白吃掉了（两端有空格时
  // 排行榜 / 详情页 / 弹窗标题与安卓不同）。
  if (bookTitle.trim() === '') {
    return chapterTitle.trim() !== '' ? chapterTitle : `第${chapterNumber}话`;
  }
  return `${bookTitle} 第${chapterNumber}话`;
}

export function effectiveGodTitle(
  moment: Pick<
    GodMoment,
    'title' | 'titleIsCustom' | 'bookTitle' | 'chapterTitle' | 'chapterNumber'
  >,
): string {
  if (moment.titleIsCustom && moment.title.trim() !== '') return moment.title;
  return defaultGodTitle(moment.bookTitle, moment.chapterTitle, moment.chapterNumber);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortGodMoments(list: readonly GodMoment[], sort: GodSort): GodMoment[] {
  const copy = [...list];
  if (sort === 'rating') {
    copy.sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt);
  } else if (sort === 'recent') {
    copy.sort((a, b) => b.createdAt - a.createdAt);
  } else {
    copy.sort(
      (a, b) =>
        compareStrings(a.bookTitle, b.bookTitle) ||
        a.chapterNumber - b.chapterNumber ||
        b.rating - a.rating,
    );
  }
  return copy;
}

export function rankGodMoments(
  list: readonly GodMoment[],
  sort: GodSort = 'rating',
): GodMomentItem[] {
  return sortGodMoments(list, sort).map((entity, index) => ({ entity, rank: index + 1 }));
}

/**
 * Kotlin `CoverSource.comicDefault(pageIndex: Int = 0)`（GodMomentModels.kt L74-77）
 * = `ComicPage(pageIndex, "")` —— **原样透传**，不做任何夹紧 / 取整
 * （参数已是 `Int`，负值也是合法页号语义之外的值但 Kotlin 不会拦）。
 */
export function defaultCoverSource(pageIndex = 0): CoverSource {
  return { kind: 'comicPage', pageIndex, pageId: '' };
}

export function coverSourceToTag(source: CoverSource): string {
  if (source.kind === 'comicPage') return `page|${source.pageIndex}|${source.pageId}`;
  if (source.kind === 'album') return `album|${source.uri}`;
  return `novel|${source.chapterId}|${source.start}|${source.end}`;
}

/**
 * Kotlin `String.toIntOrNull()` 的等价：**整串**必须是一个合法十进制 Int，
 * 否则返回 null（调用方 `?: 0` 兜 0）。
 *
 * ⚠️ 不能用 `Number.parseInt`：它对 `"3abc"` → 3、`" 3"` → 3、`"3.7"` → 3，
 * 而 Kotlin 三种情况全部 `null` → 0。coverSource 是入库字段（备份也照搬），
 * 脏 tag 的解析结果必须与安卓一致，否则同一行数据两端读出不同页号。
 */
function kotlinToIntOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  // Kotlin 允许前导 '+'（screenFloatValue 规则），不允许前导空格 / 小数点 / 尾缀。
  if (!/^[+-]?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    ? value
    : null;
}

export function parseCoverSource(tag: string | null | undefined): CoverSource {
  if (tag === null || tag === undefined || tag.trim() === '') return defaultCoverSource();
  const parts = tag.split('|');
  const head = parts[0];
  if (head === 'page') {
    // Kotlin L91-94：`pageIndex = p.getOrNull(1)?.toIntOrNull() ?: 0`
    return {
      kind: 'comicPage',
      pageIndex: kotlinToIntOrNull(parts[1]) ?? 0,
      pageId: parts[2] ?? '',
    };
  }
  if (head === 'album') return { kind: 'album', uri: parts[1] ?? '' };
  if (head === 'novel') {
    // Kotlin L96-100：`p.getOrNull(2)?.toIntOrNull() ?: 0` / `getOrNull(3)…`
    return {
      kind: 'novelExcerpt',
      chapterId: parts[1] ?? '',
      start: kotlinToIntOrNull(parts[2]) ?? 0,
      end: kotlinToIntOrNull(parts[3]) ?? 0,
    };
  }
  return defaultCoverSource();
}

/**
 * Kotlin `Float.toString()` 的等价（`round3` 之后的取值）。
 *
 * ⚠️ **这是入库 / 进备份的字节**：Kotlin `round3(v) = ((v*1000f).roundToInt()/1000f).toString()`
 * （GodMomentModels.kt L174-175），而 `Float.toString()` **永远带小数点且至少一位小数**
 * —— `CropParams.DEFAULT.toTag()` 在安卓是 `"1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0"`。
 * 此前 TS 用 `String(round3(v))` 得到 `"1,0,0,0,0,0,1,1"`：两端都能解析回来，
 * 但**同一份数据在两端落库/导出/比对的字节不同**（`cropParams` 是 Room 列也是备份字段）。
 * `round3` 的结果恒为 `k/1000`（k 为整数），所以按 `k` 直接拼十进制即可复现 Kotlin 输出。
 */
function kotlinFloat3String(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const k = Math.round(value * 1000);
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(k);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${whole}.${frac === '' ? '0' : frac}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeCropParams(crop: CropParams): CropParams {
  const l = clamp01(crop.cropL);
  const t = clamp01(crop.cropT);
  const r = clamp01(crop.cropR);
  const b = clamp01(crop.cropB);
  const minL = Math.min(l, r);
  const minT = Math.min(t, b);
  return {
    scale: crop.scale,
    offsetX: crop.offsetX,
    offsetY: crop.offsetY,
    rotationDeg: crop.rotationDeg,
    cropL: minL,
    cropR: Math.min(1, Math.max(Math.max(l, r), minL + 0.02)),
    cropT: minT,
    cropB: Math.min(1, Math.max(Math.max(t, b), minT + 0.02)),
  };
}

export function cropParamsToTag(crop: CropParams): string {
  const values = [
    crop.scale,
    crop.offsetX,
    crop.offsetY,
    crop.rotationDeg,
    crop.cropL,
    crop.cropT,
    crop.cropR,
    crop.cropB,
  ];
  return values.map((value) => kotlinFloat3String(value)).join(',');
}

/**
 * Kotlin `String.toFloatOrNull()` 的等价。
 *
 * 与同文件里的 `kotlinToIntOrNull` 同一套理由：`Number.parseFloat` 是**前缀**解析 ——
 * `"1,5"` → 1、`" 1.5"` → 1.5、`"1.5abc"` → 1.5，而 Kotlin `toFloatOrNull()`
 * （`screenFloatValue` 的 `matches()` 语义）这三种全部 `null` → 回落到默认值。
 * `cropParams` 是 Room 列 + 备份字段，两端必须读出同一组数。
 *
 * 接受的写法与 Kotlin 一致：十进制（可带小数点 / `eE` 指数 / `f F` 后缀）、
 * `NaN`、`Infinity`，可带前导 `+` / `-`，且**必须整串匹配**。
 * （Kotlin 还接受十六进制浮点如 `0x1p3`；`CropParams.toTag()` 永不产出该形式。）
 */
function kotlinToFloatOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^[+-]?(?:NaN|Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]?)$/.test(raw)) {
    return null;
  }
  // Kotlin 的 `f` / `F` 后缀只是 float 字面量标记，`Number()` 不认 —— 先剥掉再转。
  return Number(raw.replace(/[fF]$/, ''));
}

export function parseCropParams(tag: string | null | undefined): CropParams {
  if (tag === null || tag === undefined || tag.trim() === '') {
    return { ...DEFAULT_CROP_PARAMS };
  }
  const parts = tag.split(',');
  const read = (index: number, fallback: number): number =>
    kotlinToFloatOrNull(parts[index]) ?? fallback;
  return normalizeCropParams({
    scale: read(0, 1),
    offsetX: read(1, 0),
    offsetY: read(2, 0),
    rotationDeg: read(3, 0),
    cropL: read(4, 0),
    cropT: read(5, 0),
    cropR: read(6, 1),
    cropB: read(7, 1),
  });
}
