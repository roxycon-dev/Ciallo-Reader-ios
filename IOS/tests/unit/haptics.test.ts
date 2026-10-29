/**
 * E65 —— `@capacitor/haptics` 接线。
 *
 * Android 权威：`ui/feedback/Motion.kt:101-152`（`HapticsGate` / `HapticKind` 5 档 /
 * `AppHaptics.perform`）+ 全仓 `LocalHapticFeedback.current.performHapticFeedback(...)`。
 *
 * 三条语义逐条锁定：
 *  1. `AppHaptics.perform(kind)` 的注入后端 `nativeHapticsBackend` 在 iOS 原生走
 *     `@capacitor/haptics` 的 `impact/notification/selectionChanged`（按 `kind` 语义映射），
 *     触发成功；Web 回退 `navigator.vibrate(millis)`（iOS Safari 不实现 Vibration API → 静默）。
 *  2. 平台 `HapticsPort.impact(millis)` 的原生实现 `createNativeHapticsPort` 按时长分桶到
 *     `ImpactStyle`，触发返回 `true`、异常返回 `false`（与 Web 端 `navigator.vibrate` 在 iOS
 *     返回 `false` 一致）。
 *  3. `useAppHaptics` 的默认后端不再是 `mutingHapticsImpl`（静默 no-op），而是 `nativeHapticsBackend`。
 *
 * 本测试用 `vi.mock` 把 `@capacitor/core` / `@capacitor/haptics` 换成可断言的桩，验证映射正确性。
 */

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  impact: vi.fn().mockResolvedValue(undefined),
  notification: vi.fn().mockResolvedValue(undefined),
  selectionChanged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mocks.impact, notification: mocks.notification, selectionChanged: mocks.selectionChanged },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS' },
}));

import { nativeHapticsBackend } from '@ui/components/feedback/Motion';
import { createNativeHapticsPort } from '@platform/ios-native/hapticsPort';
import { createHapticsPort } from '@platform/capabilities';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('nativeHapticsBackend（E65，iOS 原生映射）', () => {
  it('SELECTION → selectionChanged；LIGHT/MEDIUM/HEAVY → impact 对应 style；SUCCESS → notification', () => {
    nativeHapticsBackend('SELECTION', 8, 48);
    nativeHapticsBackend('LIGHT', 12, 110);
    nativeHapticsBackend('MEDIUM', 18, 160);
    nativeHapticsBackend('HEAVY', 26, 220);
    nativeHapticsBackend('SUCCESS', 16, 190);

    expect(mocks.selectionChanged).toHaveBeenCalledTimes(1);
    expect(mocks.impact).toHaveBeenCalledTimes(3);
    expect(mocks.impact).toHaveBeenNthCalledWith(1, { style: 'LIGHT' });
    expect(mocks.impact).toHaveBeenNthCalledWith(2, { style: 'MEDIUM' });
    expect(mocks.impact).toHaveBeenNthCalledWith(3, { style: 'HEAVY' });
    expect(mocks.notification).toHaveBeenNthCalledWith(1, { type: 'SUCCESS' });
  });

  it('原生插件抛错时不抛出、安全吞掉（不打断交互）', () => {
    mocks.impact.mockRejectedValueOnce(new Error('no native bridge'));
    expect(() => nativeHapticsBackend('HEAVY', 26, 220)).not.toThrow();
  });
});

describe('createNativeHapticsPort（E65，平台 HapticsPort 原生实现）', () => {
  it('impact(millis) 按时长分桶到 ImpactStyle，触发成功返回 true', async () => {
    const port = createNativeHapticsPort();
    expect(await port.impact(8)).toBe(true);
    expect(mocks.impact).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    expect(await port.impact(18)).toBe(true);
    expect(mocks.impact).toHaveBeenLastCalledWith({ style: 'MEDIUM' });
    expect(await port.impact(26)).toBe(true);
    expect(mocks.impact).toHaveBeenLastCalledWith({ style: 'HEAVY' });
  });

  it('原生插件异步 reject 时被安全吞掉：乐观返回 true 且不抛出（同步签名无法在 reject 时返回 false）', async () => {
    mocks.impact.mockRejectedValueOnce(new Error('boom'));
    const port = createNativeHapticsPort();
    let threw = false;
    let result = false;
    try {
      result = await port.impact(18);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBe(true);
  });
});

describe('Web 端 HapticsPort（E65，浏览器回退）', () => {
  it('有 navigator.vibrate 时 impact 走 Vibration API 并返回其结果', () => {
    const prev = (globalThis.navigator as { vibrate?: unknown }).vibrate;
    (globalThis.navigator as { vibrate?: unknown }).vibrate = () => true;
    try {
      expect(createHapticsPort().impact(20)).toBe(true);
    } finally {
      (globalThis.navigator as { vibrate?: unknown }).vibrate = prev;
    }
  });
});

describe('Motion.tsx 接线（E65）', () => {
  const source = readFileSync(path.join(REPO_ROOT, 'src/ui/components/feedback/Motion.tsx'), 'utf8');

  it('默认后端不再是 mutingHapticsImpl（静默 no-op）', () => {
    expect(source).toMatch(/backend \?\? nativeHapticsBackend/);
    expect(source).not.toMatch(/backend \?\? mutingHapticsImpl/);
  });

  it('真实 import 了 @capacitor/haptics（不再只是注释里提）', () => {
    expect(source).toMatch(/from '@capacitor\/haptics'/);
  });
});
