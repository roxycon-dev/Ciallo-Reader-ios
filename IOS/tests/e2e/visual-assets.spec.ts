import { expect, test } from '@playwright/test';
import { encode } from 'fast-png';

test('a custom wallpaper appears across tabs and the poster remains in Settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([12, 26, 38, 255], i);
  const buffer = Buffer.from(encode({ width: 32, height: 32, channels: 4, depth: 8, data: pixels }));
  const photo = { name: 'night.png', mimeType: 'image/png', buffer };

  await page.goto('/');
  await page.getByTestId('onboarding_skip_button').click({ timeout: 35_000 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('开屏海报图片').setInputFiles(photo);
  await expect(page.getByRole('img', { name: '海报预览' })).toBeVisible();

  const background = page.locator('.settings-list > .glass-card').filter({
    has: page.getByText('软件背景', { exact: true }),
  });
  await background.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('软件背景图片').setInputFiles(photo);
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-wallpaper', 'dark');
  const backdrop = shell.locator('.app-wallpaper img');
  await expect.poll(() => backdrop.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(32);

  await page.getByRole('button', { name: '统计', exact: true }).click();
  await expect(page.locator('.tab-screen-header__title').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(backdrop).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('img', { name: '海报预览' })).toBeVisible();
  await background.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(backdrop).toHaveCount(0);
  await expect(page.getByRole('img', { name: '海报预览' })).toBeVisible();
  expect(errors).toEqual([]);
});
