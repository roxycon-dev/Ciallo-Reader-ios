import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('Xbook discovery opens its real text chapter and downloads a complete EPUB to the shelf', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const snapshot = (name: string) => readFileSync(resolve('tests/fixtures/xbookcn', `${name}.html`), 'utf8');
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url()); if (['localhost', '127.0.0.1'].includes(url.hostname)) { await route.continue(); return; }
    if (url.hostname !== 'xbookcn.app') { await route.abort('failed'); return; }
    const html = /^\/book\/[a-f0-9]+\/[0-9]+$/.test(url.pathname) ? snapshot('chapter') : url.pathname.startsWith('/book/') ? snapshot('detail') : snapshot('search');
    await route.fulfill({ status: 200, contentType: 'text/html;charset=utf-8', body: html, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/'); await page.getByTestId('onboarding_skip_button').click({ timeout: 30_000 });
  await page.getByRole('button', { name: '发现', exact: true }).click(); await page.getByRole('tab', { name: '小说', exact: true }).click();
  await page.getByRole('button', { name: /聚合发现/ }).click(); await page.getByRole('button', { name: '书阁', exact: true }).click();
  const work = page.getByRole('button', { name: '打开 总裁X总裁', exact: true }); await expect(work).toBeVisible({ timeout: 20_000 }); await work.click();
  const directory = page.locator('[data-route="comicChapters"]'); await expect(directory).toContainText('总裁X总裁');
  await expect(directory).toContainText('001');
  await directory.getByRole('button', { name: '整本下载', exact: true }).click();
  await expect(directory.getByRole('button', { name: '已下载 · 阅读', exact: true })).toBeVisible({ timeout: 30_000 });
  await directory.getByRole('button', { name: /继续阅读/ }).click();
  await expect(page.locator('[data-route="novelReaderOnline"]')).toContainText('陆思羡', { timeout: 15_000 });
  await page.screenshot({ path: '.tmp/xbook-online-acceptance.png' });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(directory).toBeVisible();
  await directory.getByRole('button', { name: '已下载 · 阅读', exact: true }).click();
  await expect(page.locator('.rd-stage')).toBeVisible();
  await expect(page.locator('.rd-stage')).toContainText('陆思羡');
  expect(errors).toEqual([]);
});
