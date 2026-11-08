import { expect, test, type Page } from '@playwright/test';

async function enterPin(page: Page, pin: string): Promise<void> {
  const panel = page.locator('.privacy-windows-pin-card');
  for (const digit of pin) await panel.getByRole('button', { name: digit, exact: true }).click();
}
test('privacy setup, wrong-PIN rejection, change and disable use the persisted verifier', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await page.getByTestId('onboarding_skip_button').click({ timeout: 30_000 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '隐私模式', exact: true }).click();
  await expect(page.locator('.privacy-windows-pin-title')).toHaveText('设置隐私密码'); await enterPin(page, '123456');
  await expect(page.locator('.privacy-windows-pin-title')).toHaveText('再次输入以确认'); await enterPin(page, '123456');
  const manage = page.locator('.privacy-windows-manage-card'); await expect(manage).toBeVisible();
  await manage.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '管理', exact: true }).click(); await enterPin(page, '654321');
  await expect(page.locator('.privacy-windows-pin-error-slot')).toContainText('密码错误'); await enterPin(page, '123456'); await expect(manage).toBeVisible();
  await manage.getByRole('button', { name: '修改密码', exact: true }).click(); await enterPin(page, '123456');
  await expect(page.locator('.privacy-windows-pin-title')).toHaveText('输入新密码'); await enterPin(page, '654321');
  await expect(page.locator('.privacy-windows-pin-title')).toHaveText('再次输入以确认'); await enterPin(page, '654321'); await expect(manage).toBeVisible();
  await manage.getByRole('button', { name: '关闭隐私模式', exact: true }).click(); await enterPin(page, '123456');
  await expect(page.locator('.privacy-windows-pin-error-slot')).toContainText('密码错误'); await enterPin(page, '654321');
  await expect(page.getByRole('switch', { name: '隐私模式', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.privacy-windows-pin-card')).toHaveCount(0); expect(errors).toEqual([]);
});

test('a protected shelf stays hidden and category management requires its real PIN', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/'); await page.getByTestId('onboarding_skip_button').click({ timeout: 45_000 });
  const chooser = page.waitForEvent('filechooser'); await page.getByTestId('empty_bookshelf_import_button').click();
  await (await chooser).setFiles({ name: '受保护的书.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 正文\n这段内容应受到分类密码保护。') });
  await expect(page.getByText('受保护的书', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('switch', { name: '隐私模式', exact: true }).click();
  await enterPin(page, '123456'); await expect(page.locator('.privacy-windows-pin-title')).toHaveText('再次输入以确认'); await enterPin(page, '123456');
  const manage = page.locator('.privacy-windows-manage-card'), protection = manage.getByRole('switch', { name: '保护分类 默认', exact: true });
  await protection.click(); await expect(protection).toHaveAttribute('aria-checked', 'true'); await manage.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '书架', exact: true }).click(); await expect(page.getByText('受保护的书', { exact: true })).toHaveCount(0);
  const category = page.getByRole('button', { name: '分类 默认，已选中', exact: true });
  const rect = await category.boundingBox(); expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await expect(page.locator('.privacy-windows-pin-card')).toBeVisible(); await expect(page.getByRole('dialog', { name: '默认', exact: true })).toHaveCount(0);
  await enterPin(page, '654321'); await expect(page.locator('.privacy-windows-pin-error-slot')).toContainText('密码错误');
  await expect(page.getByText('受保护的书', { exact: true })).toHaveCount(0); await enterPin(page, '123456');
  await expect(page.getByText('受保护的书', { exact: true }).first()).toBeVisible();
});
