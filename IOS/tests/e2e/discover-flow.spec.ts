import { expect, test } from '@playwright/test';
import { encode } from 'fast-png';

test('discovery uses real source responses, persists follow/block choices and opens that work', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const manga = '11111111-1111-4111-8111-111111111111';
  const chapter = '22222222-2222-4222-8222-222222222222';
  const tag = '33333333-3333-4333-8333-333333333333';
  const image = encode({ width: 32, height: 48, channels: 4, depth: 8, data: new Uint8Array(32 * 48 * 4).fill(180) });
  const item = { id: manga, type: 'manga', attributes: { title: { en: '发现验收漫画' }, altTitles: [], description: { en: '来自实际发现接口的数据' },
    status: 'ongoing', originalLanguage: 'zh', updatedAt: '2026-10-28T00:00:00Z', contentRating: 'safe',
    tags: [{ id: tag, attributes: { name: { en: 'Adventure' }, group: 'genre' } }] },
  relationships: [{ type: 'cover_art', attributes: { fileName: 'cover.png' } }, { type: 'author', attributes: { name: '验收作者' } }] };
  const chapterItem = { id: chapter, type: 'chapter', attributes: { chapter: '1', title: '第一话 验收', translatedLanguage: 'zh', externalUrl: null,
    publishAt: new Date().toISOString(), pages: 1 }, relationships: [{ type: 'manga', id: manga }] };
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname)) { await route.continue(); return; }
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' } }); return; }
    if (url.hostname === 'uploads.mangadex.org' || url.hostname === 'images.example') { await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(image), headers: { 'access-control-allow-origin': '*' } }); return; }
    if (url.hostname !== 'api.mangadex.org') { await route.abort('failed'); return; }
    let body: object;
    if (url.pathname === '/manga/tag') body = { data: [{ id: tag, attributes: { name: { en: 'Adventure' }, group: 'genre' } }] };
    else if (url.pathname.startsWith('/at-home/server/')) body = { baseUrl: 'https://images.example', chapter: { hash: 'fixture', data: ['1.png'], dataSaver: ['1.png'] } };
    else if (url.pathname.endsWith('/feed') || url.pathname === '/chapter') body = { data: [chapterItem], total: 1, limit: 30, offset: 0 };
    else if (url.pathname === `/manga/${manga}`) body = { data: item };
    else body = { data: [item], total: 1, limit: 30, offset: 0 };
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByTestId('onboarding_skip_button').click({ timeout: 30_000 });
  await page.getByRole('button', { name: '发现', exact: true }).click();
  await expect(page.getByTestId('discover-page')).toBeVisible();
  await page.getByRole('button', { name: /聚合发现/ }).click();
  await page.getByRole('button', { name: 'MangaDex 漫画', exact: true }).click();
  const work = page.getByRole('button', { name: '打开 发现验收漫画', exact: true });
  await expect(work).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.discover-cover img').first()).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: '喜欢 发现验收漫画', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消喜欢 发现验收漫画', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '屏蔽', exact: true }).click();
  await expect(work).toHaveCount(0);
  await page.getByRole('button', { name: '发现设置', exact: true }).click();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '解除 · 发现验收漫画', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.discover-results--list')).toBeVisible();
  await expect(work).toBeVisible();
  await page.screenshot({ path: '.tmp/discovery-acceptance.png' });
  await work.click();
  const directory = page.locator('[data-route="comicChapters"]');
  await expect(directory).toContainText('发现验收漫画');
  await expect(directory).toContainText('第一话 验收');
  await directory.getByRole('button', { name: /继续阅读/ }).click();
  await expect(page.locator('[data-route="comicReaderOnline"]')).toBeVisible();
  await expect(page.locator('.comic-engine-layer img').first()).toHaveAttribute('src', /^blob:/);
  expect(errors).toEqual([]);
});
