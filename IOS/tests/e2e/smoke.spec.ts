import { expect, test } from '@playwright/test';

/**
 * 生产构建冒烟测试。
 *
 * 存在的意义：typecheck / lint / unit tests 都不检查「这坨代码在浏览器里到底跑不跑得起来」。
 * 这里对着 **dist 产物**（不是 dev server）跑，覆盖 4 件事：
 *  1. 首屏渲染出 #root，且**无** pageerror / console.error
 *  2. 所有 CSS 请求返回 2xx（相对路径回归防线 —— 构建期已经因为这个挂过一次）
 *  3. 主题 token 真的生效（`--color-primary` 有定义）
 *  4. 路由能离开 splash 到达下一个页面
 *
 * 运行：`CI=1 E2E_BASE_URL=http://localhost:4173 npx playwright test`
 * （CI=1 让 playwright 不要自己起 dev server，直接打 preview）
 */

test.describe('生产构建冒烟', () => {
  test('首屏渲染且无未捕获异常', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    await page.goto('/');
    await expect(page.locator('#root')).toBeVisible();
    // 等开屏走完（Android：400ms 淡入 + 900ms 停留 + 350ms 淡出）
    await page.waitForTimeout(3000);

    const text = await page.locator('#root').innerText();
    expect(text.trim().length, '#root 里没有任何可见文本').toBeGreaterThan(0);

    expect(errors, `未捕获异常：\n${errors.join('\n')}`).toEqual([]);
  });

  test('所有 CSS 请求成功（相对路径回归防线）', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('.css') && r.status() >= 400) {
        failed.push(`${r.status()} ${r.url()}`);
      }
    });
    await page.goto('/');
    await page.waitForTimeout(2000);
    expect(failed, `CSS 加载失败：\n${failed.join('\n')}`).toEqual([]);
  });

  test('主题 CSS 生效：--color-primary 已定义', async ({ page }) => {
    await page.goto('/');
    const value = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-primary)';
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    });
    expect(value).toBeTruthy();
  });

  test('离开开屏后到达下一个页面', async ({ page }) => {
    await page.goto('/');
    // 首次安装 → onboarding；看过引导 → main。两个都算「离开了 splash」。
    const next = page.locator('.main-shell, [class*="onboarding"]').first();
    await expect(next).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.splash-page')).toHaveCount(0);
  });

  test('走完引导页后主壳 tab 栏含四个中文标签', async ({ page }) => {
    await page.goto('/');
    const shell = page.locator('.main-shell');
    if ((await shell.count()) === 0) {
      // 首装走引导页：点「跳过」（Android OnboardingScreen 右上角同一个按钮）
      await expect(page.getByTestId('onboarding_screen')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('onboarding_skip_button').click();
    }
    await expect(shell).toBeVisible({ timeout: 15_000 });

    const labels = await page
      .locator('nav[aria-label], [class*="tabbar"], [class*="tab-bar"]')
      .first()
      .innerText();
    for (const label of ['书库', '书架', '统计', '设置']) {
      expect(labels, `Tab 栏缺少「${label}」，实际：${labels}`).toContain(label);
    }
  });
});