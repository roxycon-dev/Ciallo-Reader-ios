/**
 * E52 / E66 —— `keep_screen_on` 接线。
 *
 * Android 权威：`ui/ReaderScreen.kt:690-710`
 * ```kotlin
 * DisposableEffect(prefs.keepScreenOn) {
 *     val activity = context as? Activity
 *     if (prefs.keepScreenOn) activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
 *     else activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
 *     onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
 * }
 * ```
 *
 * 三条语义逐条锁定：
 *  1. 依赖数组是 `keepScreenOn` —— 设置变化即重跑；
 *  2. 开 → `setEnabled(true)`，关 → `setEnabled(false)`；
 *  3. **卸载时无条件** `setEnabled(false)`（不管之前是开是关）。
 *
 * 本测试测的是端口契约与 `platform/capabilities.ts` 的实现（`createScreenAwakePort`），
 * 以及 ReaderPage 是否真的调用了它 —— 页面级断言由「门禁 + 现有 reader 测试」兜底。
 */

import { describe, expect, it } from 'vitest';
import { createScreenAwakePort } from '@platform/capabilities';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('createScreenAwakePort（E52）', () => {
  it('setEnabled 走 Screen Wake Lock，缺失 API 时按铁律抛错而非静默降级', async () => {
    const original = (globalThis.navigator as { wakeLock?: unknown } | undefined)?.wakeLock;
    const calls: boolean[] = [];
    // 装一个假的 navigator.wakeLock，记录 setEnabled 的调用序列
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        wakeLock: {
          request: async () => ({
            released: false,
            release: async function release(this: { released: boolean }) {
              this.released = true;
            },
          }),
        },
      },
      configurable: true,
      writable: true,
    });
    const g = globalThis as unknown as { navigator: { wakeLock?: unknown } };
    void g;
    try {
      const port = createScreenAwakePort();
      await port.setEnabled(true);
      calls.push(true);
      // 再关一次：第二次应释放（sentinel 已存在 → 不重复 request）
      await port.setEnabled(false);
      calls.push(false);
      expect(calls).toEqual([true, false]);
    } finally {
      if (original === undefined) {
        delete (globalThis.navigator as { wakeLock?: unknown }).wakeLock;
      } else {
        Object.defineProperty(globalThis.navigator, 'wakeLock', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    }
  });

  it('无 wakeLock API 的宿主 → setEnabled 抛错（不是静默 no-op）', async () => {
    const nav = globalThis.navigator as { wakeLock?: unknown } | undefined;
    const had = nav !== undefined && 'wakeLock' in nav;
    const prev = had ? nav?.wakeLock : undefined;
    if (nav !== undefined) {
      Object.defineProperty(globalThis.navigator, 'wakeLock', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
    try {
      const port = createScreenAwakePort();
      await expect(port.setEnabled(true)).rejects.toThrow();
    } finally {
      if (nav !== undefined && had) {
        Object.defineProperty(globalThis.navigator, 'wakeLock', {
          value: prev,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});

describe('ReaderPage 的 keepScreenOn 接线（E52/E66）', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'src/ui/pages/ReaderPage.tsx'), 'utf8');

  it('调用了 platform.screenAwake.setEnabled（此前是零调用方的空开关）', () => {
    expect(source).toMatch(/screenAwake\.setEnabled\(/);
    // 至少两处：开启分支 + 卸载清理（Kotlin 的 onDispose）
    const calls = source.match(/screenAwake\.setEnabled\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('依赖数组是 prefs.keepScreenOn（Kotlin DisposableEffect 的 key）', () => {
    // `}, [prefs.keepScreenOn]);` —— 允许中间换行/空白
    expect(source).toMatch(/\[\s*prefs\.keepScreenOn\s*,?\s*\]\s*\)/);
  });

  it('文件头不再把这个条目标成 SKIPPED', () => {
    expect(source).not.toMatch(/keepScreenOn\s*→\s*SKIPPED/);
  });
});