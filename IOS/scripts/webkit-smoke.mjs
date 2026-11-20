/**
 * webkit-smoke.mjs —— 用 **WebKit**（iOS Safari 的引擎）打开构建产物，证明它真的能跑。
 *
 * 为什么不用 Chromium：iOS 上 WKWebView 用的是 WebKit。Chromium 通过不代表 Safari 通过
 * （`Intl.Segmenter`、`DecompressionStream`、CSS `backdrop-filter`、`-webkit-` 前缀的
 * 行为都不同）。这个脚本加载 `dist/`，收集 `pageerror` 与 console error，并截图。
 *
 * 用法：
 *   node scripts/serve-web.mjs --port 4300 &        # 或另开窗口
 *   node scripts/webkit-smoke.mjs http://127.0.0.1:4300/ build/webkit-smoke.png
 */
import { webkit, devices } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4300/';
const shot = process.argv[3] ?? 'build/webkit-smoke.png';

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices['iPhone 14 Pro'] });
const page = await context.newPage();

const errors = [];
const warnings = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error') errors.push(`console.error: ${text}`);
  else if (message.type() === 'warning') warnings.push(text);
});

const started = Date.now();
let title = '';
let robot = '';
let bodySample = '';
let htmlLength = 0;

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(4000);
  title = await page.title();
  htmlLength = (await page.content()).length;
  bodySample = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  const ua = await page.evaluate(() => navigator.userAgent);
  robot = ua.includes('WebKit') && !ua.includes('Chrome') ? 'WebKit (iOS Safari engine)' : ua.slice(0, 80);
  await page.screenshot({ path: shot, fullPage: false });
} catch (error) {
  errors.push(`navigation: ${error.message}`);
} finally {
  await browser.close();
}

const elapsed = Date.now() - started;
const fatal = errors.filter((line) => !/favicon|Manifest|apple-touch/i.test(line));

console.log(JSON.stringify({ url, engine: robot, title, htmlLength, elapsed_ms: elapsed, bodySample, fatalErrors: fatal, warnings: warnings.slice(0, 5), screenshot: shot }, null, 2));

if (fatal.length > 0) process.exitCode = 1;
