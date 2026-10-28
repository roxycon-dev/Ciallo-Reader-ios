/**
 * E79 —— `BackupManager` 的 JSON 兼容信封。
 *
 * Android 权威：`com.example.data.BackupManager.kt`（L9-108）+ 
 * `com.example.god.GodMomentRepository.kt`（L103-158）。
 *
 * 这条通道在 iOS 侧原本**完全不存在**（`grep exportBackupJson src/` 零命中），
 * 意味着 Android 导出的 JSON 备份文件在 iOS 上无法导入。本文件补上它。
 *
 * 测试重点：
 *  - base64（NO_WRAP 导出 / DEFAULT 宽容导入）能无损往返；
 *  - 16 MiB / 24 MiB 两条容量闸门；
 *  - `archive` 存在 ⇒ 走 ZIP 通道并立即返回（preferences/godMoments 不参与）；
 *  - 神回数组 **不含 `coverPath`**，且导入时 `coverPath` 恒为 null；
 *  - 7 个 preferences 的取值区间逐条对齐 Kotlin L93-99。
 */

import { describe, expect, it } from 'vitest';
import {
  buildJsonBackup,
  decodeBase64Default,
  encodeBase64NoWrap,
  exportGodMomentsJson,
  importGodMomentsJson,
  JSON_ARCHIVE_MAX_BYTES,
  JSON_ENCODED_MAX_CHARS,
  JSON_PREFERENCE_KEYS,
  kotlinFloatToString,
  parseJsonBackup,
  readFontSize,
  readLineHeight,
  readPageTurnMode,
  readReaderTheme,
  readRestReminderMinutes,
  readScreenOrientationLock,
  readSplashPureMode,
  type JsonPreferenceKey,
} from '@core/backup/backupManagerJson';
import type { GodMoment } from '@core/god/godTypes';

function moment(over: Partial<GodMoment> = {}): GodMoment {
  return {
    id: 7,
    contentType: 'comic',
    bookId: 'src::comic',
    chapterId: 'src::comic#3',
    bookTitle: '三体',
    chapterTitle: '第3话',
    chapterNumber: 3,
    title: '永不熄灭',
    titleIsCustom: true,
    rating: 4.5,
    note: '好',
    coverPath: '/data/user/0/x/files/god_covers/7.jpg',
    coverSource: 'page|2|',
    cropParams: 'l0.06,t0.06,r0.94,b0.94',
    createdAt: 1000,
    updatedAt: 2000,
    ...over,
  };
}

describe('base64（Kotlin android.util.Base64）', () => {
  it('NO_WRAP 往返无损，且无换行', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255, 1024]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + 11) & 0xff;
      const encoded = encodeBase64NoWrap(bytes);
      expect(encoded.includes('\n'), `len=${len}`).toBe(false);
      expect(Array.from(decodeBase64Default(encoded))).toEqual(Array.from(bytes));
    }
  });

  it('DEFAULT 解码容忍空白与 URL-safe 字母表', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbe]);
    const std = encodeBase64NoWrap(bytes);
    expect(decodeBase64Default(`  ${std.slice(0, 2)}\n${std.slice(2)}  `)).toEqual(bytes);
    // URL-safe：把 + / 换成 - _
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64Default(urlSafe)).toEqual(bytes);
  });
});

describe('exportBackupJson (Kotlin L50-80)', () => {
  it('组装出 archive / exportTime / booksCount / preferences 四个键', () => {
    const json = buildJsonBackup({
      archiveBytes: Uint8Array.from([1, 2, 3, 4]),
      booksCount: 12,
      preferences: { fontSize: '16' },
      now: 1234,
    });
    const o = JSON.parse(json) as unknown as Record<string, unknown>;
    expect(Object.keys(o).sort()).toEqual(['archive', 'booksCount', 'exportTime', 'preferences']);
    expect(o['exportTime']).toBe(1234);
    expect(o['booksCount']).toBe(12);
    expect(decodeBase64Default(o['archive'] as string)).toEqual(Uint8Array.from([1, 2, 3, 4]));
    // Kotlin L74：godMoments 为 null 时**不写**这个键
    expect('godMoments' in o).toBe(false);
  });

  it('godMoments 非 null 时才写入（Kotlin L56/L74）', () => {
    const json = buildJsonBackup({
      archiveBytes: Uint8Array.from([9]),
      booksCount: 1,
      preferences: {},
      godMoments: [moment()],
      now: 1,
    });
    const o = JSON.parse(json) as unknown as Record<string, unknown>;
    expect(Array.isArray(o['godMoments'])).toBe(true);
    expect((o['godMoments'] as unknown[]).length).toBe(1);
  });

  it('归档超过 16 MiB 直接拒绝并给出 Kotlin 原文案（Kotlin L53）', () => {
    expect(() =>
      buildJsonBackup({
        archiveBytes: new Uint8Array(JSON_ARCHIVE_MAX_BYTES + 1),
        booksCount: 0,
        preferences: {},
        now: 0,
      }),
    ).toThrow('备份超过 JSON 容量，请使用 ZIP 备份接口');
  });
});

describe('神回独立数组（Kotlin GodMomentRepository L103-158）', () => {
  it('导出恰好 14 个字段，且**不含 coverPath**', () => {
    const rows = exportGodMomentsJson([moment()]);
    expect(rows).toHaveLength(1);
    const keys = Object.keys(rows[0] as unknown as Record<string, unknown>).sort();
    expect(keys).toEqual(
      [
        'bookId',
        'bookTitle',
        'chapterId',
        'chapterTitle',
        'chapterNumber',
        'contentType',
        'coverSource',
        'createdAt',
        'cropParams',
        'id',
        'note',
        'rating',
        'title',
        'titleIsCustom',
        'updatedAt',
      ].sort(),
    );
    expect('coverPath' in (rows[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('导入时 coverPath 恒为 null（Kotlin L147 硬编码）', () => {
    const rows = exportGodMomentsJson([moment()]);
    const { moments } = importGodMomentsJson(rows as unknown as unknown[], 999);
    expect(moments).toHaveLength(1);
    expect((moments[0] as GodMoment).coverPath).toBeNull();
  });

  it('rating 始终被 coerceIn(0.5, 5)（Kotlin L145）', () => {
    const rows = [
      { ...exportGodMomentsJson([moment()])[0], rating: 99 },
      { ...exportGodMomentsJson([moment()])[0], rating: -3 },
      { ...exportGodMomentsJson([moment()])[0], rating: 3.5 },
    ];
    const { moments } = importGodMomentsJson(rows, 1);
    expect(moments.map((m) => m.rating)).toEqual([5, 0.5, 3.5]);
  });

  it('bookId / chapterId 为空的行被跳过且不计数（Kotlin L153-155）', () => {
    const base = exportGodMomentsJson([moment()])[0] as unknown as Record<string, unknown>;
    const rows = [
      { ...base, bookId: 'ok' },
      { ...base, bookId: '' },
      { ...base, chapterId: '   ' },
      'not an object',
      null,
    ];
    const { moments, skipped } = importGodMomentsJson(rows, 1);
    expect(moments).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('缺省值逐条对齐 Kotlin L137/L148/L149/L150', () => {
    const { moments } = importGodMomentsJson(
      [{ bookId: 'b', chapterId: 'c' }],
      4242,
    );
    const m = moments[0] as GodMoment;
    expect(m.contentType).toBe('comic');
    expect(m.rating).toBe(5);
    expect(m.titleIsCustom).toBe(false);
    expect(m.chapterNumber).toBe(0);
    expect(m.createdAt).toBe(4242);
    expect(m.updatedAt).toBe(4242);
    expect(m.coverSource).toBe('page|0|');
    expect(m.coverPath).toBeNull();
    // id = 0（Kotlin L136）
    expect(m.id).toBe(0);
  });
});

describe('kotlinFloatToString（Kotlin Float.toString()，BackupManager.kt L60-61 导出侧）', () => {
  it('整数值恒带 .0，非整数走最短表示', () => {
    expect(kotlinFloatToString(18)).toBe('18.0');
    expect(kotlinFloatToString(28)).toBe('28.0');
    expect(kotlinFloatToString(0)).toBe('0.0');
    expect(kotlinFloatToString(16.5)).toBe('16.5');
    expect(kotlinFloatToString(0.15)).toBe('0.15');
    expect(kotlinFloatToString(-3.5)).toBe('-3.5');
  });

  it('非有限值与 Kotlin 同名输出', () => {
    expect(kotlinFloatToString(Number.NaN)).toBe('NaN');
    expect(kotlinFloatToString(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(kotlinFloatToString(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });
});

describe('restoreBackupJson 的解析（Kotlin L82-108）', () => {
  it('archive 存在 ⇒ hasArchive=true 且解出 ZIP 字节', () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const parsed = parseJsonBackup(
      buildJsonBackup({ archiveBytes: zip, booksCount: 0, preferences: {}, now: 0 }),
    );
    expect(parsed.hasArchive).toBe(true);
    expect(Array.from(parsed.archiveBytes ?? [])).toEqual(Array.from(zip));
  });

  it('archive 缺失 ⇒ hasArchive=false（轻量恢复路径）', () => {
    const parsed = parseJsonBackup(
      JSON.stringify({ exportTime: 1, booksCount: 2, preferences: { fontSize: '20' } }),
    );
    expect(parsed.hasArchive).toBe(false);
    expect(parsed.archiveBytes).toBeNull();
    expect(parsed.preferences.fontSize).toBe('20');
    // Kotlin L91：preferences 键存在且是对象 ⇒ hasPreferences=true。
    expect(parsed.hasPreferences).toBe(true);
  });

  it('preferences 键缺失 / 非对象 ⇒ hasPreferences=false（Kotlin L91 return false 的判定源）', () => {
    expect(parseJsonBackup('{"exportTime":1}').hasPreferences).toBe(false);
    expect(parseJsonBackup('{"preferences":null}').hasPreferences).toBe(false);
    expect(parseJsonBackup('{"preferences":"x"}').hasPreferences).toBe(false);
    expect(parseJsonBackup('{"preferences":[1]}').hasPreferences).toBe(false);
    // 空对象仍是对象。
    expect(parseJsonBackup('{"preferences":{}}').hasPreferences).toBe(true);
  });

  it('archive 字段超过 24MiB 拒绝（Kotlin L86）', () => {
    const huge = 'A'.repeat(JSON_ENCODED_MAX_CHARS + 4);
    expect(() => parseJsonBackup(JSON.stringify({ archive: huge }))).toThrow(
      '备份 archive 字段超过 24MiB',
    );
  });

  it('非法 JSON 抛出中文文案', () => {
    expect(() => parseJsonBackup('{ not json')).toThrow('备份内容不是合法 JSON');
    expect(() => parseJsonBackup('[]')).toThrow('备份内容不是合法 JSON');
    expect(() => parseJsonBackup('null')).toThrow('备份内容不是合法 JSON');
  });

  it('godMoments 非数组时视为 null（Kotlin optJSONArray）', () => {
    expect(parseJsonBackup(JSON.stringify({ godMoments: 'x' })).godMoments).toBeNull();
    expect(parseJsonBackup(JSON.stringify({ godMoments: [1] })).godMoments).toHaveLength(1);
  });
});

describe('preferences 取值区间（Kotlin L93-99）', () => {
  const p = (o: Partial<Record<JsonPreferenceKey, string>>) => o;

  it('键名集合与 Kotlin L59-67 一致', () => {
    expect(JSON_PREFERENCE_KEYS).toEqual([
      'fontSize',
      'lineHeight',
      'readerTheme',
      'pageTurnMode',
      'splashPureMode',
      'screenOrientationLock',
      'restReminderMinutes',
    ]);
  });

  it('fontSize 8..80 / lineHeight 8..120（Kotlin L93-94）', () => {
    expect(readFontSize(p({ fontSize: '16' }))).toBe(16);
    expect(readFontSize(p({ fontSize: '7.9' }))).toBeNull();
    expect(readFontSize(p({ fontSize: '80.1' }))).toBeNull();
    expect(readLineHeight(p({ lineHeight: '120' }))).toBe(120);
    expect(readLineHeight(p({ lineHeight: '121' }))).toBeNull();
  });

  it('readerTheme 0..5 / pageTurnMode 0..4（Kotlin L95-96）', () => {
    expect(readReaderTheme(p({ readerTheme: '5' }))).toBe(5);
    expect(readReaderTheme(p({ readerTheme: '6' }))).toBeNull();
    expect(readPageTurnMode(p({ pageTurnMode: '4' }))).toBe(4);
    expect(readPageTurnMode(p({ pageTurnMode: '5' }))).toBeNull();
  });

  it('splashPureMode 用 toBooleanStrictOrNull（只接受 "true"/"false"）', () => {
    expect(readSplashPureMode(p({ splashPureMode: 'true' }))).toBe(true);
    expect(readSplashPureMode(p({ splashPureMode: 'false' }))).toBe(false);
    expect(readSplashPureMode(p({ splashPureMode: 'TRUE' }))).toBeNull();
    expect(readSplashPureMode(p({ splashPureMode: '1' }))).toBeNull();
  });

  it('screenOrientationLock 0..2 / restReminderMinutes 0..1440（Kotlin L98-99）', () => {
    expect(readScreenOrientationLock(p({ screenOrientationLock: '2' }))).toBe(2);
    expect(readScreenOrientationLock(p({ screenOrientationLock: '3' }))).toBeNull();
    expect(readRestReminderMinutes(p({ restReminderMinutes: '1440' }))).toBe(1440);
    expect(readRestReminderMinutes(p({ restReminderMinutes: '1441' }))).toBeNull();
  });
});