/**
 * 网络类型探测的原生实现（iOS）。
 *
 * 对应 Android `ui/comic/ComicPageLoader.kt:696-703` 的
 * `wifiConnectedOrUnmetered()`：`ConnectivityManager.activeNetwork` +
 * `getNetworkCapabilities(...).hasTransport(TRANSPORT_WIFI) ||
 *  hasCapability(NET_CAPABILITY_NOT_METERED)`。
 *
 * `@capacitor/network` 的 `getStatus()` 返回 `{ connected, connectionType }`，
 * 其中 `connectionType` 就是 `'wifi' | 'cellular' | 'none' | 'unknown'`——
 * iOS 侧的等价物是 `NWPathMonitor` 的 `.wifi` / `.cellular`。
 *
 * ⚠️ 逐条映射 Kotlin 的兜底默认值：
 *  - `cm == null → return true`：插件抛错 → **放行**（宁多下不卡阅读）；
 *  - `activeNetwork == null → return false`：`connected === false` → **拦截**；
 *  - `getNetworkCapabilities() == null → return true`：`connectionType === 'unknown'`
 *    → **放行**（iOS 无「计费/不计费」公开标志，cellular 视为计费）。
 */
import { Network } from '@capacitor/network';
import type { NetworkPort } from '@platform/interfaces';

export function createNativeNetworkPort(): NetworkPort {
  return {
    async wifiConnectedOrUnmetered(): Promise<boolean> {
      try {
        const status = await Network.getStatus();
        // Kotlin L699 `cm.activeNetwork ?: return false` —— 完全无连接 → 拦截。
        if (!status.connected) return false;
        // Kotlin L700-702 —— Wi-Fi 传输放行；cellular 是计费网络 → 拦截。
        return status.connectionType === 'wifi';
      } catch {
        // Kotlin L698 `cm == null → return true` —— 探测不到就放行。
        return true;
      }
    },
  };
}