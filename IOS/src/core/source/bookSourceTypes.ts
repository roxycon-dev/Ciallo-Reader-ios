/**
 * Book source settings — Legado-compatible config parse/serialize/merge.
 * Pure TS; storage/UI binding lives outside core.
 */

export interface BookSourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  group?: string;
  bookSourceUrl?: string;
  searchUrl?: string;
  ruleBookList?: string;
  ruleBookName?: string;
  ruleAuthor?: string;
  ruleCoverUrl?: string;
  ruleChapterList?: string;
  ruleChapterName?: string;
  ruleChapterUrl?: string;
  ruleContent?: string;
  ruleNextContentUrl?: string;
  loginUrl?: string;
  header?: string;
  exploreUrl?: string;
  weight?: number;
  enabledIsAdult?: boolean;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

function asOptionalBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

export function parseBookSourceJson(json: string): BookSourceConfig {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('book source JSON must be an object');
  }
  const o = raw as Record<string, unknown>;

  const bookSourceUrl = asString(o['bookSourceUrl']);
  const id = asString(o['id']) ?? bookSourceUrl ?? '';
  if (id.length === 0) {
    throw new Error('book source JSON missing id');
  }
  const name = asString(o['name']) ?? asString(o['bookSourceName']) ?? id;

  const cfg: BookSourceConfig = {
    id,
    name,
    enabled: asBool(o['enabled'], true),
  };

  const group = asString(o['group']) ?? asString(o['bookSourceGroup']);
  if (group !== undefined) cfg.group = group;

  const assign = (key: keyof BookSourceConfig, val: string | undefined): void => {
    if (val !== undefined) {
      (cfg as unknown as Record<string, unknown>)[key] = val;
    }
  };

  assign('bookSourceUrl', bookSourceUrl);
  assign('searchUrl', asString(o['searchUrl']));
  assign('ruleBookList', asString(o['ruleBookList']));
  assign('ruleBookName', asString(o['ruleBookName']));
  assign('ruleAuthor', asString(o['ruleAuthor']));
  assign('ruleCoverUrl', asString(o['ruleCoverUrl']));
  assign('ruleChapterList', asString(o['ruleChapterList']));
  assign('ruleChapterName', asString(o['ruleChapterName']));
  assign('ruleChapterUrl', asString(o['ruleChapterUrl']));
  assign('ruleContent', asString(o['ruleContent']));
  assign('ruleNextContentUrl', asString(o['ruleNextContentUrl']));
  assign('loginUrl', asString(o['loginUrl']));
  assign('header', asString(o['header']));
  assign('exploreUrl', asString(o['exploreUrl']));

  const weight = asOptionalNumber(o['weight']);
  if (weight !== undefined) cfg.weight = weight;

  const adult = asOptionalBool(o['enabledIsAdult']);
  if (adult !== undefined) cfg.enabledIsAdult = adult;

  return cfg;
}

export function serializeBookSource(src: BookSourceConfig): string {
  const ordered: Record<string, unknown> = {
    id: src.id,
    name: src.name,
    enabled: src.enabled,
  };
  const optionalKeys: Array<keyof BookSourceConfig> = [
    'group',
    'bookSourceUrl',
    'searchUrl',
    'ruleBookList',
    'ruleBookName',
    'ruleAuthor',
    'ruleCoverUrl',
    'ruleChapterList',
    'ruleChapterName',
    'ruleChapterUrl',
    'ruleContent',
    'ruleNextContentUrl',
    'loginUrl',
    'header',
    'exploreUrl',
    'weight',
    'enabledIsAdult',
  ];
  for (const key of optionalKeys) {
    const val = src[key];
    if (val !== undefined) ordered[key] = val;
  }
  return JSON.stringify(ordered);
}

/** Merge by id: incoming replaces existing (Android-style full replace). */
export function mergeSources(
  existing: BookSourceConfig[],
  incoming: BookSourceConfig[],
): BookSourceConfig[] {
  const map = new Map<string, BookSourceConfig>();
  for (const s of existing) map.set(s.id, s);
  for (const s of incoming) map.set(s.id, s);
  return [...map.values()];
}

function tryParseOne(raw: unknown): BookSourceConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  try {
    return parseBookSourceJson(JSON.stringify(raw));
  } catch {
    return null;
  }
}

export function parseBookSourceList(json: string): BookSourceConfig[] {
  const trimmed = json.trim();
  if (trimmed.length === 0) throw new Error('empty book source payload');
  const raw: unknown = JSON.parse(trimmed);
  if (Array.isArray(raw)) {
    const out: BookSourceConfig[] = [];
    for (const item of raw) {
      const cfg = tryParseOne(item);
      if (cfg !== null) out.push(cfg);
    }
    if (out.length === 0) throw new Error('book source array has no valid entries');
    return out;
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    const list = o['data'] ?? o['sources'] ?? o['list'];
    if (Array.isArray(list)) {
      const out: BookSourceConfig[] = [];
      for (const item of list) {
        const cfg = tryParseOne(item);
        if (cfg !== null) out.push(cfg);
      }
      if (out.length > 0) return out;
    }
    return [parseBookSourceJson(trimmed)];
  }
  throw new Error('book source JSON must be an object or array');
}

export function serializeBookSourceList(sources: BookSourceConfig[]): string {
  return JSON.stringify(sources.map((src) => JSON.parse(serializeBookSource(src))));
}

export function setSourceEnabled(
  sources: BookSourceConfig[],
  id: string,
  enabled: boolean,
): BookSourceConfig[] {
  return sources.map((src) => (src.id === id ? { ...src, enabled } : src));
}

export function moveSource(
  sources: BookSourceConfig[],
  id: string,
  direction: 'up' | 'down',
): BookSourceConfig[] {
  const idx = sources.findIndex((src) => src.id === id);
  if (idx < 0) return sources;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= sources.length) return sources;
  const next = sources.slice();
  const a = next[idx];
  const b = next[target];
  if (a === undefined || b === undefined) return sources;
  next[idx] = b;
  next[target] = a;
  return next;
}

export function describeBookSource(src: BookSourceConfig): string {
  const parts: string[] = [];
  if (src.group !== undefined && src.group.length > 0) parts.push(src.group);
  if (src.bookSourceUrl !== undefined && src.bookSourceUrl.length > 0) parts.push(src.bookSourceUrl);
  if (src.weight !== undefined) parts.push(`权重 ${String(src.weight)}`);
  if (src.enabledIsAdult === true) parts.push('成人');
  return parts.length > 0 ? parts.join(' · ') : src.id;
}

export function countEnabledSources(sources: BookSourceConfig[]): number {
  return sources.reduce((acc, src) => (src.enabled ? acc + 1 : acc), 0);
}

// ---------------------------------------------------------------------------
// Appended: Android `com.example.source.BookSource.kt` (source interface) —
// the line-by-line port lives in ./bookSource (abstract class with Kotlin
// default-method bodies); re-exported here so the book-source type surface has
// one entry point. No declarations are duplicated.
// ---------------------------------------------------------------------------
export { BookSource } from './bookSource';

// ---------------------------------------------------------------------------
// Appended: Android `com.example.source.SourceConfig.kt` — JSON rule/config
// data classes (BookFieldRule, SearchRule, DetailRule, DownloadRule,
// HtmlSearchRule, HtmlChapterRule, HtmlContentRule, SourceConfig) + their
// Kotlin-default factory functions. Definitions: ./sourceConfig.
// ---------------------------------------------------------------------------
export type {
  BookFieldRule,
  SearchRule,
  DetailRule,
  DownloadRule,
  HtmlSearchRule,
  HtmlChapterRule,
  HtmlContentRule,
  SourceConfig,
} from './sourceConfig';
export {
  createBookFieldRule,
  createSearchRule,
  createDetailRule,
  createDownloadRule,
  createHtmlSearchRule,
  createHtmlChapterRule,
  createHtmlContentRule,
  createSourceConfig,
} from './sourceConfig';
