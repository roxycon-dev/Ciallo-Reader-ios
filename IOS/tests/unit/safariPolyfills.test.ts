import { describe, expect, it } from 'vitest';
import { installSafari16Polyfills, safari16RuntimeGaps } from '../../src/platform/web/polyfills';

/**
 * `crypto.randomUUID` 是 secure-context-only；WKWebView 从 `capacitor://localhost` 提供页面时
 * 它不是 secure context，而全仓有 6 处无守卫直调（书源导入 / 本地书籍导入 / 分享 / 漫画预设）。
 * `src/platform/web/polyfills.ts` 在模块加载时自调用一次；`main.tsx` 又显式调用一次，
 * 目的是让「入口必须 import 它」这件事在代码里可见。本测试钉住这两点。
 */
describe('safari16 runtime polyfill', () => {
  it('leaves a usable v4 generator behind after the module loads', () => {
    expect(typeof crypto.randomUUID).toBe("function");
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(crypto.randomUUID()).not.toBe(crypto.randomUUID());
  });

  it('is idempotent and reports no remaining gap', () => {
    expect(installSafari16Polyfills()).toBe(false);
    expect(safari16RuntimeGaps()).not.toContain('crypto.randomUUID');
  });
});
