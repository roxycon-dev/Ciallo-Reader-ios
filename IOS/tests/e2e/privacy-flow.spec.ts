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
