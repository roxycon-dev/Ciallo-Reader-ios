/**
 * E62 —— 沉浸式状态栏接线。
 *
 * Android 权威：`ui/ReaderScreen.kt:709-726` 与 `ui/comic/ComicReaderCore.kt:400-423`
 * ```kotlin
 * DisposableEffect(Unit) {
 *     hideSystemBars()           // controller.hide(statusBars()) / systemBars()
 *                                //   + BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
 *     onDispose { showSystemBars() }   // controller.show(statusBars())
 * }
 * ```
 *
 * 三条语义逐条锁定：
 *  1. 进入阅读/漫画 → `statusBars.setHidden(true)`；卸载时无条件 `statusBars.setHidden(false)`；
 *  2. 依赖数组是 `[]` —— 与设置无关，仅挂载/卸载各跑一次（Kotlin `DisposableEffect(Unit)`）；
 *  3. web-mock 端口按铁律显式抛错（网页语境没有 OS 状态栏可隐藏），不静默降级；
 *     `setHidden(false)` 是「恢复」语义，本就没改过，安全空返回。
 *
 * 本测试测的是端口契约与 `platform/capabilities.ts` 的 `createStatusBarPort` 实现，
 * 以及 ReaderPage / ComicReaderPage 是否真的调用了它 —— 页面级断言由本文件逐一锁定。
 */

import { describe, expect, it } from 'vitest';
import { createStatusBarPort, STATUS_BAR_UNAVAILABLE } from '@platform/capabilities';
import { createWebMockPlatform } from '@platform/web-mock';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('createStatusBarPort（E62，web-mock）', () => {
  it('setHidden(true) 显式抛错：网页语境没有 OS 状态栏可隐藏（不静默降级）', async () => {
    const port = createStatusBarPort();
    await expect(port.setHidden(true)).rejects.toThrow(STATUS_BAR_UNAVAILABLE);
  });

  it('setHidden(false) 是安全的恢复语义，空返回不抛错', async () => {
    const port = createStatusBarPort();
    await expect(port.setHidden(false)).resolves.toBeUndefined();
  });
});

describe('PlatformBundle 含 statusBars 端口（E62 装配）', () => {
  it('web-mock 工厂装配了 statusBars，且为 StatusBarPort 实现', () => {
    const platform = createWebMockPlatform();
    expect(platform.statusBars).toBeDefined();
    expect(typeof platform.statusBars.setHidden).toBe('function');
  });
});

describe('ReaderPage 的沉浸式状态栏接线（E62）', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'src/ui/pages/ReaderPage.tsx'), 'utf8');

  it('调用了 platform.statusBars.setHidden（进入隐藏 + 卸载恢复）', () => {
    expect(source).toMatch(/statusBars\.setHidden\(/);
    // 至少两处：开启分支 + 卸载清理（Kotlin 的 onDispose）
    const calls = source.match(/statusBars\.setHidden\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('依赖数组是 []（Kotlin DisposableEffect(Unit) 的 key）', () => {
    // 从 setHidden(true) 出发，往后在 600 字符内应出现 `}, []);`
    expect(source).toMatch(/statusBars\.setHidden\(true\)[\s\S]{0,600}?\[\s*\]\s*\)/);
  });

  it('文件头不再把这个条目标成 SKIPPED / 待接', () => {
    expect(source).not.toMatch(/statusBar.*→\s*SKIPPED/);
    expect(source).not.toMatch(/E62.*待接/);
  });
});

describe('ComicReaderPage 的沉浸式状态栏接线（E62）', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'src/ui/pages/ComicReaderPage.tsx'), 'utf8');

  it('调用了 platform.statusBars.setHidden（进入隐藏 + 卸载恢复）', () => {
    expect(source).toMatch(/statusBars\.setHidden\(/);
    const calls = source.match(/statusBars\.setHidden\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('依赖数组是 []（Kotlin DisposableEffect(Unit) 的 key）', () => {
    expect(source).toMatch(/statusBars\.setHidden\(true\)[\s\S]{0,600}?\[\s*\]\s*\)/);
  });

  it('文件正文不再把这个条目标成 SKIPPED / 待接', () => {
    expect(source).not.toMatch(/statusBar.*→\s*SKIPPED/);
    expect(source).not.toMatch(/E62.*待接/);
  });
});
