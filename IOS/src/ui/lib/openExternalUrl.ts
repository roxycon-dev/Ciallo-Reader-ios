/**
 * 打开外部页面的唯一入口（E67：`@capacitor/browser` 接线）。
 *
 * 对应 Android 的一组 `Intent(Intent.ACTION_VIEW, Uri.parse(url))` + `startActivity`：
 *  · `library/LibraryLoginDialog.kt:246` —「去注册」；
 *  · `source/ZLibraryLoginDialog.kt:328` —「去注册」；
 *  · `ui/SettingsTabScreen.kt` 的 `LocalUriHandler.openUri` — GitHub 发布页 / 项目主页。
 *
 * ── 为什么不能继续用 `window.open(url, '_blank')` ──────────────────────────
 * WKWebView 用 `WKUIDelegate` 拦截 `_blank` 导航；没有对应处理时它**既不报错、
 * 也不打开**——用户点了没反应。这是典型的静默失败，违反项目铁律。
 * iOS 侧走 `@capacitor/browser`（`SFSafariViewController`），额外好处是
 * 注册/登录完成后 cookie 落在 Safari 容器里，与 Android Custom Tabs 语义一致；
 * 若在 WKWebView 内部打开则拿不到那些 cookie，登录态对不上。
 *
 * ── 为什么用动态 `import('@platform/index')` ────────────────────────────────
 * `src/core/**` 禁止 import 平台模块；`src/ui/**` 可以但**不要**静态引入，
 * 否则浏览器 dev（web-mock）与原生（ios-native）两套端口会被打进同一 chunk，
 * 动态 import 让 Vite 正常分树，也和 `appStore.setAutoNightModePreference` 等
 * 既有调用点保持同一写法。
 *
 * ── 失败语义 ────────────────────────────────────────────────────────────────
 * **永远 reject**，绝不静默成功。调用方负责 toast 与 Kotlin 逐字一致的文案
 * （`LibraryLoginDialog.kt` / `ZLibraryLoginDialog.kt` 的「无法打开注册页面」）。
 *
 * ⚠️ 注意：Kotlin 的 `runCatching { handler.openUri(url) }.onFailure { toast }`
 * 是**同步** try/catch，而这里的失败只能以 rejection 表达（iOS 侧
 * `SFSafariViewController` 要等 present 结束）。所以调用点必须写成
 * `void openExternalUrl(u).then(() => {}, () => toast(...))`，
 * **不能**留 `try { openExternalUrl(u) } catch {}` —— 那样 catch 永远抓不到，
 * 正是原来 `window.open` 无返回值检查时的双重静默失败。
 */

export async function openExternalUrl(url: string): Promise<void> {
  const { getPlatform } = await import('@platform/index');
  await getPlatform().externalBrowser.open(url);
}

/**
 * Android `LocalUriHandler.openUri(uri)` —— Compose 的 `openUri` 只处理
 * http/https/intent 等能交给系统的 scheme，其余原样丢给默认处理器。
 * 这里保持等价：空串直接抛错（Kotlin 会 `Uri.parse("")` 得到空 Uri 后
 * `startActivity` 抛 `ActivityNotFoundException`，同样是失败）。
 */
export async function openExternalUri(uri: string): Promise<void> {
  if (uri.trim() === '') {
    throw new Error('无法打开外部页面：链接为空（Android `LocalUriHandler.openUri("")` 同样会失败）。');
  }
  await openExternalUrl(uri);
}