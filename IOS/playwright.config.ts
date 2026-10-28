import { defineConfig } from '@playwright/test';

/**
 * Playwright 配置 —— CI（GitHub Actions）与本机共用同一份。
 *
 * 浏览器策略：**WebKit 为主**。
 *  1. iOS 设备上的 WebView 就是 WKWebView，WebKit 的渲染/JS 语义最接近真机。
 *  2. 本机 Windows 上 Chromium 下载曾经失败过（EPERM / 下载中断），WebKit 稳定。
 *  3. Chromium 的安装步骤在 CI 里是 best-effort（失败只 warning），但**不在这里启用**
 *     —— 启用一个可能没装上的 project 会让整个 job 挂掉。
 *
 * 想要跑 Chromium 时显式 opt-in：
 *   PLAYWRIGHT_EXTRA_BROWSERS=chromium npx playwright test
 */

const extraBrowsers = (process.env.PLAYWRIGHT_EXTRA_BROWSERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    viewport: { width: 393, height: 852 },
  },
  projects: [
    {
      // 主力：iPhone 14 Pro 尺寸 + WebKit。
      name: 'iphone-14-pro-webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    ...extraBrowsers.map((browserName) => ({
      name: `iphone-14-pro-${browserName}`,
      use: {
        browserName: browserName as 'chromium',
        ...(browserName === 'chromium' && process.env.PLAYWRIGHT_CHROME_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } }
          : {}),
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    })),
  ],
  /**
   * 服务由谁来起：
   *  - CI：外部已经 `npx vite preview --port 4173` 起好了（workflow 里显式做），
   *         所以这里不重复起。
   *  - 本机：起 dev server（`npm run dev`，5173）。
   * 想本机也对着 dist 产物跑：`E2E_BASE_URL=http://localhost:4173 npm run preview` 再 `npm run e2e`。
   */
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run preview:ci',
        url: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
