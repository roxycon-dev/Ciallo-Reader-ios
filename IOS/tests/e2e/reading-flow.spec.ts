import { expect, test, type Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { encode } from 'fast-png';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => console.error('[reading-flow]', error));
});
test.afterEach(async ({ page }, result) => {
  if (result.status !== result.expectedStatus) {
    console.error('[reading-layout]', await page.locator('.comic-engine-layer img').evaluateAll((images) => images.map((image) => {
      const ancestry = []; let element: Element | null = image;
      while (element && ancestry.length < 14) { const rect = element.getBoundingClientRect(); ancestry.push({ tag: element.tagName, class: element.className, w: rect.width, h: rect.height, display: getComputedStyle(element).display }); element = element.parentElement; }
      return ancestry;
    })));
    await page.screenshot({ path: '.tmp/takeover-reading-failure.png' });
  }
});

async function enterApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('onboarding_screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('onboarding_skip_button').click();
  await expect(page.locator('.main-shell')).toBeVisible({ timeout: 15_000 });
}

test('local TXT picker imports actual chapters and opens the reader', async ({ page }) => {
  await enterApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('empty_bookshelf_import_button').click();
  await (
    await chooser
  ).setFiles({
    name: '接力验收.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '第一章 相遇\n这是一段真正从本地 TXT 文件导入的正文。\n第二章 出发\n这是第二章的真实内容。',
    ),
  });
  await expect(page.getByText('接力验收', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('#root')).toContainText('真正从本地 TXT', { timeout: 15_000 });
  await expect(page.locator('.rd-stage')).toBeVisible();
  await page.screenshot({ path: '.tmp/takeover-local-reader.png' });
});

test('source management shows real builtins and accepts custom JSON', async ({ page }) => {
  await enterApp(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByTestId('library_help_entry_card').click();
  await page.getByRole('button', { name: '打开书源管理', exact: true }).click();
  await expect(page.getByText('MangaDex 漫画', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导入 JSON 书源', exact: true }).click();
  await page.getByRole('button', { name: '粘贴 JSON 配置', exact: true }).click();
  await page.getByRole('textbox', { name: '书源 JSON' }).fill(
    JSON.stringify({
      id: 'acceptance_custom',
      name: '接力验收书源',
      baseUrl: 'https://example.com',
      htmlSearch: {
        url: '/search?q={keyword}',
        listSelector: '@css:li',
        title: '@css:a@text',
        detailUrl: '@css:a@href',
      },
    }),
  );
  await page.getByRole('button', { name: '确定导入', exact: true }).click();
  await expect(page.getByText('接力验收书源', { exact: true })).toBeVisible();
  const toggle = page.getByRole('switch', { name: '接力验收书源 启用开关', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: '.tmp/takeover-source-management.png' });
});

test('local CBZ opens its real stored pages in the complete comic reader', async ({ page }) => {
  await enterApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('empty_bookshelf_import_button').click();
  const data = new Uint8Array(64 * 96 * 4);
  for (let pixel = 0; pixel < 64 * 96; pixel++) { data[pixel * 4 + 1] = 170; data[pixel * 4 + 2] = 136; data[pixel * 4 + 3] = 255; }
  const png = encode({ width: 64, height: 96, data, channels: 4, depth: 8 });
  await (await chooser).setFiles({ name: '漫画验收.cbz', mimeType: 'application/vnd.comicbook+zip',
    buffer: Buffer.from(zipSync({ '01.png': png, '02.png': png })) });
  await expect(page.getByText('漫画验收', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.hp-book-card__cover-img').first()).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: '继续阅读', exact: true }).click();
  await expect(page.locator('.comic-core')).toBeVisible();
  const image = page.locator('.comic-engine-layer img').first();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('2/2', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.tmp/takeover-local-comic.png' });
});
