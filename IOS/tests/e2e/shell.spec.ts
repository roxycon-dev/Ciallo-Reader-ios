import { test, expect } from '@playwright/test';

/**
 * 开屏页（Android `ui/SplashScreen.kt`）。
 *
 * 关键事实（照抄 Kotlin）：
 *  - L182 / L298 用**手绘 LOGO**（`contentDescription = "Ciallo Reader"`），
 *    明确「替换原『Ciallo Reader』文字标题」。所以断言的是
 *    `role=img[name="Ciallo Reader"]`，**不是**一个 heading。
 *  - 品牌串是 `Ciallo Reader`，不是旧版的 `Ciallo阅读`。
 *  - 时序：淡入 400ms → 停留 900ms → 淡出 350ms → `safeOnSplashFinished()`
 *    → `hasSeenOnboarding ? main : onboarding`。
 */
test.describe('开屏页', () => {
  test('渲染手绘 LOGO（contentDescription = "Ciallo Reader"）', async ({ page }) => {
    await page.goto('/');
    // 开屏最长停留 ~1.65s，LOGO 在这段时间内必然可见
    await expect(page.getByRole('img', { name: 'Ciallo Reader' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('开屏后自动离开，进入引导页或主壳', async ({ page }) => {
    await page.goto('/');
    // Android: hasSeenOnboarding ? "home" : "onboarding"
    // 首次安装（无记录）→ onboarding
    await expect(page.locator('.main-shell, [class*="onboarding"]').first()).toBeVisible({
      timeout: 15_000,
    });
    // splash 必须已经卸载
    await expect(page.locator('.splash-page')).toHaveCount(0);
  });

  test('开屏页没有未捕获异常', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    await page.goto('/');
    await page.waitForTimeout(3000);
    expect(errors, `未捕获异常：\n${errors.join('\n')}`).toEqual([]);
  });
});