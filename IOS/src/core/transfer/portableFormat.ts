import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { BACKUP_TABLES, TABLES } from '@core/db/schemaV13';
import { isTransferHash, isTransferSessionId, requireTransfer, TRANSFER_MAX_BYTES } from './transferWire';

export const TRANSFER_CATEGORIES = ['BOOKS', 'FAVORITES', 'ANNOTATIONS', 'HISTORY', 'SETTINGS', 'RESOURCES', 'SOURCES'] as const;
export type TransferCategory = typeof TRANSFER_CATEGORIES[number];
export const TRANSFER_CATEGORY_LABELS: Record<TransferCategory, string> = {
  BOOKS: '书籍与离线原文件', FAVORITES: '收藏与分类', ANNOTATIONS: '书签标注神回', HISTORY: '阅读进度记录', SETTINGS: '阅读设置预设', RESOURCES: '背景字体', SOURCES: '书源',
};
export const PORTABLE_TABLE_CATEGORY: Record<string, TransferCategory> = {
  books: 'BOOKS', chapters: 'BOOKS', categories: 'BOOKS', favorites: 'FAVORITES', favorite_categories: 'FAVORITES',
  bookmarks: 'ANNOTATIONS', highlights: 'ANNOTATIONS', god_moments: 'ANNOTATIONS', reading_records: 'HISTORY', reading_sessions: 'HISTORY', comic_progress: 'HISTORY', comic_chapter_read: 'HISTORY',
};
export const PORTABLE_ENTRY_MAX_BYTES = 512 * 1024 * 1024;
export const PORTABLE_METADATA_MAX_BYTES = 8 * 1024 * 1024;
export const PORTABLE_MAX_ROWS = 1_000_000;
export const PORTABLE_ROWS_HEADER = { version: 2, schema: 13 } as const;
export type PortableRow = Record<string, string | number | null>;
export interface PortableEnvelope { table: string; row: PortableRow; identity?: string; parentOnly?: boolean; bodyVersion?: string; }
export interface PortableEntry { path: string; size: number; sha256: string; }
export interface PortableManifest {
  format: 'ciallo-transfer'; version: 2; schema: 13; packageId: string; createdAt: number;
  categories: TransferCategory[]; counts: Record<string, number>; expandedBytes: number; entries: PortableEntry[];
  warnings: string[]; containsProtected: boolean; protectedFavorites: boolean;
}
export interface PortableArchivePreview {
  packageId: string; version: 1 | 2; counts: Record<string, number>; expandedBytes: number;
  categories: TransferCategory[]; warnings: string[]; containsProtected: boolean; protectedFavorites: boolean;
}
export function portableObject(value: unknown, message = '数据包对象格式错误'): Record<string, unknown> {
  requireTransfer(value !== null && typeof value === 'object' && !Array.isArray(value), message); return value as Record<string, unknown>;
}
function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
export function portableEntryPath(path: unknown): asserts path is string {
  requireTransfer(typeof path === 'string' && path.length > 0 && path.length <= 1024 && !path.includes('\\') && ![...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && !path.startsWith('/') && !path.endsWith('/'), '资源路径无效');
  requireTransfer(path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..') && !path.includes(':'), '资源路径越界');
  requireTransfer(path === 'database.rows' || path === 'settings.json' || path.startsWith('files/'), '不是 Ciallo 数据包');
}
export function parsePortableManifest(text: string): PortableManifest {
  requireTransfer(new TextEncoder().encode(text).length <= PORTABLE_METADATA_MAX_BYTES, '清单过大');
  const value = portableObject(JSON.parse(text));
  requireTransfer(value.format === 'ciallo-transfer' && value.version === 2 && value.schema === 13, '不支持的数据版本，请升级应用');
  requireTransfer(isTransferSessionId(value.packageId) && boundedInteger(value.createdAt, 0, Number.MAX_SAFE_INTEGER), '数据包标识或时间错误');
  requireTransfer(Array.isArray(value.categories) && value.categories.length > 0 && value.categories.every((category) => typeof category === 'string' && (TRANSFER_CATEGORIES as readonly string[]).includes(category)) && new Set(value.categories).size === value.categories.length, '数据类别错误');
  requireTransfer(Array.isArray(value.entries) && value.entries.length >= 2 && value.entries.length < 50000, '清单缺失或文件过多');
  const seen = new Set<string>(), filesystemNames = new Set<string>(), entries: PortableEntry[] = [];
  let expandedBytes = 0;
  for (const raw of value.entries) {
    const entry = portableObject(raw); portableEntryPath(entry.path);
    const filesystemName = entry.path.normalize('NFC').toLocaleLowerCase('en-US');
    requireTransfer(!seen.has(entry.path) && !filesystemNames.has(filesystemName), '资源路径重复或在本机文件系统上冲突');
    requireTransfer(boundedInteger(entry.size, 0, PORTABLE_ENTRY_MAX_BYTES) && isTransferHash(entry.sha256), '清单文件大小或摘要无效');
    expandedBytes += entry.size; requireTransfer(expandedBytes <= TRANSFER_MAX_BYTES, '数据包超过 4GiB');
    seen.add(entry.path); filesystemNames.add(filesystemName); entries.push({ path: entry.path, size: entry.size, sha256: entry.sha256 });
  }
  requireTransfer(seen.has('database.rows') && seen.has('settings.json') && value.expandedBytes === expandedBytes, '数据包清单不完整');
  const rawCounts = portableObject(value.counts), counts: Record<string, number> = Object.create(null) as Record<string, number>;
  let totalRows = 0;
  for (const [table, count] of Object.entries(rawCounts)) {
    requireTransfer(BACKUP_TABLES.includes(table) && boundedInteger(count, 1, PORTABLE_MAX_ROWS), '清单数据表或数量无效');
    totalRows += count; requireTransfer(totalRows <= PORTABLE_MAX_ROWS, '数据条目过多'); counts[table] = count;
  }
  requireTransfer(Array.isArray(value.warnings) && value.warnings.length <= 50000 && value.warnings.every((warning) => typeof warning === 'string' && warning.length <= 8192), '数据包提示无效');
  requireTransfer(typeof value.containsProtected === 'boolean' && typeof value.protectedFavorites === 'boolean', '隐私保护信息缺失');
  return { format: 'ciallo-transfer', version: 2, schema: 13, packageId: value.packageId, createdAt: value.createdAt,
    categories: value.categories as TransferCategory[], counts, entries, expandedBytes, warnings: value.warnings as string[], containsProtected: value.containsProtected, protectedFavorites: value.protectedFavorites };
}

export function parsePortableRowsHeader(line: string): void {
  const value = portableObject(JSON.parse(line));
  requireTransfer((value.version === 1 || value.version === 2) && (value.schema === 12 || value.schema === 13), '不支持的数据版本，请升级应用');
}
export function parsePortableRow(line: string): PortableEnvelope {
  requireTransfer(line.length <= 512 * 1024, '数据行过大');
  const envelope = portableObject(JSON.parse(line)), row = portableObject(envelope.row);
  requireTransfer(typeof envelope.table === 'string' && BACKUP_TABLES.includes(envelope.table), '包含未知数据表');
  const definition = TABLES.find((table) => table.name === envelope.table)!;
  requireTransfer(Object.keys(row).length === definition.columns.length && definition.columns.every((column) => Object.hasOwn(row, column.name)), '数据字段与当前版本不兼容');
  for (const column of definition.columns) {
    const value = row[column.name];
    requireTransfer(value !== null || !column.notNull, '必填数据为空');
    if (value !== null) requireTransfer(column.type === 'TEXT' ? typeof value === 'string' : column.type === 'INTEGER' ? typeof value === 'number' && Number.isSafeInteger(value) : column.type === 'REAL' && typeof value === 'number' && Number.isFinite(value), '数据库字段类型错误');
    if (typeof value === 'string' && ['filePath', 'coverUri', 'localThumbPath', 'coverPath'].includes(column.name)) validatePortableResource(value);
  }
  if (envelope.table === 'chapters') {
    requireTransfer((row.content as string).length <= 256000, '章节正文过大');
    for (const match of (row.content as string).matchAll(/\[IMG:([^\]]+)]/g)) validatePortableResource(match[1]!);
  }
  if (envelope.table === 'reading_records' || envelope.table === 'reading_sessions') requireTransfer(boundedInteger(row.durationSeconds, 0, 172800), '阅读时长超出合理范围');
  if (envelope.table === 'reading_sessions') requireTransfer((row.endTimeMs as number) >= (row.startTimeMs as number) && boundedInteger(row.startHour, 0, 23), '阅读会话时间无效');
  if (envelope.table === 'books') {
    requireTransfer(envelope.identity === undefined || typeof envelope.identity === 'string' && /^(?:online|file|body):[a-f0-9]{64}$/.test(envelope.identity), '书籍稳定身份无效');
    requireTransfer(envelope.bodyVersion === undefined || isTransferHash(envelope.bodyVersion), '章节版本无效');
    requireTransfer(envelope.parentOnly === undefined || typeof envelope.parentOnly === 'boolean', '关联书籍标记无效');
  }
  return { table: envelope.table, row: row as PortableRow,
    ...(envelope.identity !== undefined ? { identity: envelope.identity as string } : {}),
    ...(envelope.parentOnly !== undefined ? { parentOnly: envelope.parentOnly as boolean } : {}),
    ...(envelope.bodyVersion !== undefined ? { bodyVersion: envelope.bodyVersion as string } : {}) };
}
function validatePortableResource(value: string): void {
  if (!value.includes('@FILES@')) return;
  const path = value.startsWith('file://') ? value.slice(7) : value;
  requireTransfer(path.startsWith('@FILES@/'), '资源占位路径错误');
  portableEntryPath(`files/${path.slice(8)}`);
}

/** Incremental validation retains identities and references rather than all rows
 * or chapter bodies. The native archive reader supplies one bounded line. */
export class PortableRowsInspector {
  readonly counts: Record<string, number> = Object.create(null) as Record<string, number>;
  private readonly books = new Set<number>();
  private readonly references = new Set<number>();
  private total = 0;
  containsProtected = false;
  add(envelope: PortableEnvelope): void {
    requireTransfer(++this.total <= PORTABLE_MAX_ROWS, '数据条目过多');
    const { table, row } = envelope;
    if (table === 'books') { requireTransfer(!this.books.has(row.id as number), '重复书籍标识'); this.books.add(row.id as number); }
    if (['chapters', 'bookmarks', 'highlights', 'reading_records', 'reading_sessions'].includes(table) && row.bookId !== null) this.references.add(row.bookId as number);
    if (table === 'categories' && row.isProtected !== 0) this.containsProtected = true;
    this.counts[table] = (this.counts[table] ?? 0) + 1;
  }
  finish(manifest?: PortableManifest): void {
    requireTransfer([...this.references].every((book) => this.books.has(book)), '数据包含缺失的关联书籍');
    if (manifest) requireTransfer(Object.keys(this.counts).length === Object.keys(manifest.counts).length && Object.entries(this.counts).every(([table, count]) => manifest.counts[table] === count), '数据数量与清单不符');
  }
}

export function portableOnlineIdentity(sourceId: string, comicId: string): string {
  return `online:${bytesToHex(sha256(new TextEncoder().encode(`${sourceId}\0${comicId}`)))}`;
}
export interface PortableChapterBody { chapterOrder: number; title: string; content: string; }
/** Matches Android chapterVersion; image locations do not change body identity. */
export function portableChapterVersion(chapters: Iterable<PortableChapterBody>): string {
  const hash = sha256.create(), encoder = new TextEncoder();
  for (const chapter of chapters) {
    for (const value of [String(chapter.chapterOrder), chapter.title, chapter.content.replace(/\[IMG:[^\]]+]/g, '[IMG]')]) { hash.update(encoder.encode(value)); hash.update(new Uint8Array([0])); }
  }
  return bytesToHex(hash.digest());
}
