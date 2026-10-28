/**
 * E91 —— `AutoNovelSource` 的更新时间必须用**设备默认时区**，与 Android 一致。
 *
 * Kotlin `source/impl/AutoNovelSource.kt:92`：
 * ```kotlin
 * SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.CHINA).format(java.util.Date(it * 1000))
 * ```
 *
 * `Locale.CHINA` 只影响**区域格式**（本页模式下输出纯数字，所以没有可见差异）；
 * 时区来自 `SimpleDateFormat` 的默认 `TimeZone.getDefault()`，即**设备当前时区**。
 *
 * iOS 侧此前显式传 `timeZone: 'Asia/Shanghai'`，在非东八区设备上「更新时间」会差一个
 * 偏移量。本测试锁定「不钉时区」这个语义。
 */

import { describe, expect, it, afterEach } from 'vitest';
import { formatAutoNovelUpdatedAt } from '@core/source/impl/autoNovelSource';

/** 用固定的 TZ 环境变量验证「跟随设备时区」。 */
function withTimeZone(tz: string, fn: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('AutoNovelSource 更新时间格式（E91）', () => {
  afterEach(() => {
    // 交还 Node 对时区变更的缓存（Node 会在首次访问 Date 时读取 TZ）。
  });

  it('格式恒为 yyyy-MM-dd HH:mm', () => {
    // 2021-01-02 03:04:05 UTC
    const out = formatAutoNovelUpdatedAt(1_609_556_645);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('跟随设备时区，而不是钉死东八区', () => {
    // 同一时刻在 UTC 与 Asia/Shanghai 下应给出不同的小时/日期 —— 这正是 E91 的行为差异点。
    const seconds = 1_609_556_645; // 2021-01-02T03:04:05Z
    withTimeZone('UTC', () => {
      const utc = formatAutoNovelUpdatedAt(seconds);
      withTimeZone('Asia/Shanghai', () => {
        const sh = formatAutoNovelUpdatedAt(seconds);
        // 东八区比 UTC 快 8 小时 ⇒ 同一时刻的本地时间不同。
        expect(utc).not.toBe(sh);
        // UTC 下就是 03:04
        expect(utc.endsWith('03:04')).toBe(true);
      });
    });
  });

  it('在东八区设备上与 Android 一致（Asia/Shanghai 本地时间）', () => {
    const seconds = 1_609_556_645; // 2021-01-02T03:04:05Z
    withTimeZone('Asia/Shanghai', () => {
      // 东八区 = UTC+8 ⇒ 2021-01-02 11:04
      expect(formatAutoNovelUpdatedAt(seconds)).toBe('2021-01-02 11:04');
    });
  });

  it('UTC 设备上给出 UTC 本地时间（Android 同样如此）', () => {
    const seconds = 1_609_556_645;
    withTimeZone('UTC', () => {
      expect(formatAutoNovelUpdatedAt(seconds)).toBe('2021-01-02 03:04');
    });
  });
});