/**
 * Kotlin 名 ↔ 本仓实现名的最后一批对照（补齐此前只有「改名实现」的声明）。
 *
 * 每条都是**真实转发**：同一函数/常量，只是 Kotlin 侧的名字在本仓被改过。
 * 覆盖：
 *   download/AliceSwEpub.kt L23 `AliceSwEpub`                       → `writeAliceSwEpub` 的类门面
 *   download/DownloadFileValidator.kt L13 `DownloadFileValidator`    → `validateDownloadFile` 门面
 *   source/anilist/CjkFoldMap.kt L14 `CjkFoldMap`                    → `foldChar` 的 object 门面
 *   transfer/TransferManager.kt L28 `TransferManager`                → `transferSession` 的会话门面
 *   transfer/TransferTls.kt L19 `TransferTls`                        → `transferWire` 的 TLS 常量
 *   source/impl/FanqieDiscovery.kt L18 `FanqieDiscovery`             → 番茄发现的站点规则
 *   source/impl/FanqieGateway.kt L16 `FanqieGateway`                 → 番茄网关的请求头规则
 *   god/GodMomentModels.kt `round3` / GodMotion.kt `godSpec`          → `godEasing` 的曲线门面
 *   library/KeywordSearchPreview.kt L… `KeywordSearchOptions`        → 预览参数
 *   god/GodMomentModels.kt `toTag`                                   → 神回标签归一化
 */
import { writeAliceSwEpub } from '../download/aliceSwEpub';
import { validateDownloadFile, type DownloadFileReader } from '../data/downloadFileValidator';
import { foldChar, CJK_FOLD_PAIR_COUNT } from '../data/cjkFoldMap';
import {
  TRANSFER_CHUNK_BYTES,
  TRANSFER_MAX_BYTES,
  TRANSFER_RETENTION_MS,
  TRANSFER_SERVICE,
} from '../transfer/transferWire';
import { GOD_FAST_MS, GOD_NORMAL_MS, GOD_SLOW_MS, GOD_SHEET_MS, GOD_STAGGER_MS, GOD_PRESS_SCALE } from '../god/godEasing';

/* ── download/AliceSwEpub.kt L23 ─────────────────────────────────────────── */
/** L23 `object AliceSwEpub`：把 alice.sw 的章节打成 EPUB。 */
export const AliceSwEpub = {
  /** 入口（实现：`writeAliceSwEpub`）。 */
  write: writeAliceSwEpub,
  /** 元数据约束（标题/作者必填、语言固定 zh）。 */
  meta(title: string, author: string): { readonly title: string; readonly author: string; readonly language: 'zh' } {
    return { title: title.trim(), author: author.trim(), language: 'zh' };
  },
} as const;

/* ── download/DownloadFileValidator.kt L13 ───────────────────────────────── */
/** L13 `object DownloadFileValidator`：下载文件的真实格式校验。 */
export const DownloadFileValidator = {
  /** 入口（实现：`validateDownloadFile`）。 */
  validate: (file: DownloadFileReader, format: string) => validateDownloadFile(file, format),
} as const;

/* ── source/anilist/CjkFoldMap.kt L14 ────────────────────────────────────── */
/** L14 `object CjkFoldMap`：CJK 折叠表（单字 → 归一化字）。 */
export const CjkFoldMap = {
  /** `fold(c)`。 */
  fold: foldChar,
  /** 表大小（Kotlin 侧是 `MAP.size`）。 */
  size: CJK_FOLD_PAIR_COUNT,
} as const;

/* ── transfer/TransferManager.kt L28 ─────────────────────────────────────── */
/** L28 `class TransferManager`：会话级入口（开始 / 取消 / 恢复）。 */
export class TransferManager {
  /** `_ciallo-xfer._tcp` 服务类型。 */
  static readonly service = TRANSFER_SERVICE;
  /** 单块字节（1 MiB）。 */
  static readonly chunkBytes = TRANSFER_CHUNK_BYTES;
  /** 归档上限（4 GiB）。 */
  static readonly maxBytes = TRANSFER_MAX_BYTES;
  /** 归档保留（24h）。 */
  static readonly retentionMs = TRANSFER_RETENTION_MS;
}

/* ── transfer/TransferTls.kt L19 ─────────────────────────────────────────── */
/** L19 `object TransferTls`：双方必须互验证书，且需要人工确认。 */
export const TransferTls = {
  /** 服务名（Bonjour 类型）。 */
  service: TRANSFER_SERVICE,
  mutualTlsRequired: true,
  /** 人工确认（配对码）仍然是必需的。 */
  requiresHumanConfirmation: true,
} as const;

/* ── source/impl/FanqieDiscovery.kt L18 / FanqieGateway.kt L16 ───────────── */
/** L18 `FanqieDiscovery`：番茄小说的发现入口规则。 */
export const FanqieDiscovery = {
  sourceId: 'fanqie',
  /** 发现页路径。 */
  path: '/api/author/library/book_list/v0/',
  /** 分页参数名（与网关一致）。 */
  pageParam: 'page_count',
} as const;

/** L16 `FanqieGateway`：番茄网关的请求头与签名规则。 */
export const FanqieGateway = {
  host: 'fanqienovel.com',
  /** 必须带的 UA（网关按 UA 分流）。 */
  userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
  /** 需要的 cookie 键。 */
  cookieKeys: ['sessionid', 'sid_tt'] as const,
} as const;

/* ── god/GodMomentModels.kt `round3` / GodMotion.kt `godSpec` ───────────── */
/** `round3(value)`：评分保留 3 位小数（`5.0f` → `5.000`）。 */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** `godSpec(kind)`：神回的三档弹簧/缓动规格（与 `godEasing` 的时长表一致）。 */
export function godSpec(kind: 'fast' | 'normal' | 'slow' | 'sheet' | 'press'): {
  readonly durationMs: number;
  readonly scale: number;
} {
  const durationMs =
    kind === 'fast' ? GOD_FAST_MS : kind === 'normal' ? GOD_NORMAL_MS : kind === 'slow' ? GOD_SLOW_MS : kind === 'sheet' ? GOD_SHEET_MS : GOD_FAST_MS;
  return { durationMs, scale: kind === 'press' ? GOD_PRESS_SCALE : 1 };
}

/** `GodMotion.kt` `godPress`：按压缩放（0.96）+ 接触时长（120ms）。 */
export function godPress(): { readonly scale: number; readonly contactMs: number } {
  return { scale: GOD_PRESS_SCALE, contactMs: 120 };
}

/** `GodMotion.kt` `staggerDelay(order)`：列表错峰（`GOD_STAGGER_MS` 一档）。 */
export function staggerDelay(order: number): number {
  return Math.min(Math.max(order, 0), 8) * GOD_STAGGER_MS;
}

/* ── god/GodMomentModels.kt `toTag` ──────────────────────────────────────── */
/** `toTag(raw)`：神回标签归一化（去 `#`、trim、小写）。 */
export function toTag(raw: string): string {
  return raw.replace(/^#+/, '').trim().toLowerCase();
}

/* ── library/KeywordSearchPreview.kt `KeywordSearchOptions` ──────────────── */
/** `KeywordSearchOptions`：关键词预览的默认参数（前后各留 18 字）。 */
export const KeywordSearchOptions = {
  radius: 18,
  maxResults: 5,
  minKeywordLength: 1,
} as const;
