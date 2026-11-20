/**
 * 设计令牌与若干单声明 UI 常量 —— `ui/design/DesignTokens.kt` +
 * `ui/shelf/ShelfSelectionHost.kt:148` + `ui/favorite/FavoriteCover.kt:26-47` +
 * `ui/privacy/PrivacyWindows.kt:226-263` + `ui/source/SourceManagementScreen.kt` +
 * `ui/mascot/BookCompleteAnimation.kt` + `data/Book.kt:49` 的移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   DesignTokens.kt L144+ `object ReadingPalette`（阅读器配色）→ `READING_PALETTE`
 *   ShelfSelectionHost.kt L148 `SHELF_ACTION_EXIT_MS = 180`      → 同名
 *   Book.kt L49 `DownloadedComicCount`                           → `DOWNLOADED_COMIC_COUNT`
 *   FavoriteCover.kt L26-33 `favoriteCoverData(local, remote, skipLocal)` → 同名
 *   FavoriteCover.kt L35-47 `favoriteCoverRequest(data, sourceId, attempt)`：
 *            `ixdzs8` / `wenku8_library` 各自的 Referer      → `favoriteCoverRequest`
 *   PrivacyWindows.kt L226-232 `pinResult(action)`：取消继续抛，其它异常 → false
 *                                                                  → 同名
 *   PrivacyWindows.kt L263+ `PinKey(digit, enabled, onClick)`        → `PIN_KEY`
 *   PrivacyWindows.kt L234-260 `PinDots` 的抖动序列 `[-10, 10, -6, 6, -3, 0]`（每段 42ms）
 *                                                                  → `PIN_ERROR_SHAKE`
 *   SourceManagementScreen.kt `SourceNameStyle` / `SourceIdStyle`   → 同名常量
 *   SourceManagementScreen.kt `SourceCredentialFields`（`ZLibraryLoginDialog.kt`）
 *                                                                  → `SOURCE_CREDENTIAL_FIELDS`
 *   BookCompleteAnimation.kt `RoxyCelebrationImage`                 → 资源键常量
 *   GodSettingsSection.kt `GodSettingSwitchRow` / `GodStyleCard`     → 组件契约
 */

/** `ReadingPalette`：阅读器的纸色 / 墨色 / 高亮（`DesignTokens.kt` L144+）。 */
export const READING_PALETTE = {
  /** 纸色（浅 / 深）。 */
  paperLight: 0xf4f3ef,
  paperDark: 0x191919,
  /** 墨色。 */
  inkLight: 0x161613,
  inkDark: 0xf2f2f2,
  /** 次级文字。 */
  inkSecondaryLight: 0x646b62,
  inkSecondaryDark: 0xb7b7b7,
  /** 选中/高亮。 */
  highlightLight: 0x059669,
  highlightDark: 0x34d399,
} as const;

/** Kotlin 原名出口。 */
export const ReadingPalette = READING_PALETTE;

/** `ShelfSelectionHost.kt` L148 `SHELF_ACTION_EXIT_MS = 180`。 */
export const SHELF_ACTION_EXIT_MS = 180;

/** `ShelfSelectionHost.kt` L147 `EDGE_ARM_NS = 200_000_000L`（200ms，只是路过不算）。 */
export const EDGE_ARM_MS = 200;

/** `Book.kt` L49 `DownloadedComicCount`：本地漫画的已下载章节计数列。 */
export const DOWNLOADED_COMIC_COUNT = 'downloadedComicCount';

/**
 * `FavoriteCover.kt` L26-33 `favoriteCoverData(local, remote, skipLocal = false)`：
 * 被删掉的本地缩略图不能盖住仍然可用的在线封面。
 */
export function favoriteCoverData(
  local: string | null | undefined,
  remote: string | null | undefined,
  skipLocal = false,
  isReadableFile: (path: string) => boolean = () => false,
): string | null {
  if (!skipLocal && local !== null && local !== undefined && local.trim() !== '') {
    if (local.startsWith('content://')) return local;
    const path = local.startsWith('file://') ? local.slice(7) : local;
    if (isReadableFile(path)) return local;
  }
  return remote !== null && remote !== undefined && remote.trim() !== '' ? remote : null;
}

/**
 * `FavoriteCover.kt` L35-47 `favoriteCoverRequest(context, data, source, attempt)`：
 * 两个站点的 Referer 是硬编码的（与 Kotlin 逐字），其余交给封面加载器的默认头。
 */
export function favoriteCoverRequest(input: {
  readonly data: string;
  readonly sourceId: string | null;
  readonly attempt: number;
}): {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly attempt: number;
} {
  const remote = input.data.startsWith('https://') || input.data.startsWith('http://');
  const headers: Record<string, string> = {};
  if (remote) {
    if (input.sourceId === 'ixdzs8') headers['Referer'] = 'https://ixdzs8.com/';
    else if (input.sourceId === 'wenku8_library') headers['Referer'] = 'https://wenku8.ywy.moe/';
  }
  return { url: input.data, headers, attempt: input.attempt };
}

/** `FavoriteCover.kt` L78-80：`attempt < 2` 时按 `500ms * (attempt + 1)` 重试。 */
export function favoriteCoverRetryDelayMs(attempt: number): number | null {
  if (attempt >= 2) return null;
  return 500 * (attempt + 1);
}

/**
 * `PrivacyWindows.kt` L226-232 `pinResult(action)`：
 * 取消必须继续抛（`CancellationException`），其它异常一律吞成 `false`。
 */
export async function pinResult(action: () => Promise<boolean>): Promise<boolean> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return false;
  }
}

/** `PrivacyWindows.kt` L242 `listOf(-10f, 10f, -6f, 6f, -3f, 0f)`，每段 `tween(42)`。 */
export const PIN_ERROR_SHAKE = {
  offsets: [-10, 10, -6, 6, -3, 0] as const,
  stepMs: 42,
} as const;

/** `PrivacyWindows.kt` L251-258 `repeat(6)`：6 个圆点，直径 10dp、间距 14dp。 */
export const PIN_DOTS = { count: 6, sizeDp: 10, gapDp: 14 } as const;

/** `PrivacyWindows.kt` L263+ `PinKey(digit, enabled, onClick)` 的语义键。 */
export const PIN_KEY = {
  /** 数字、退格、空位三态。 */
  digits: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const,
  backspaceLabel: '删除',
} as const;

/** `SourceManagementScreen.kt` 的两个字型（源名 15sp/600、源 id 12sp/400）。 */
export const SourceNameStyle = { fontSizeSp: 15, fontWeight: 600 } as const;
export const SourceIdStyle = { fontSizeSp: 12, fontWeight: 400 } as const;

/** `ZLibraryLoginDialog.kt` `SourceCredentialFields`：邮箱 + 密码两栏。 */
export const SOURCE_CREDENTIAL_FIELDS = {
  fields: [
    { key: 'email', label: '邮箱', type: 'email', autoComplete: 'username' },
    { key: 'password', label: '密码', type: 'password', autoComplete: 'current-password' },
  ] as const,
} as const;

/** `BookCompleteAnimation.kt` `RoxyCelebrationImage`：读完一本时的庆祝图。 */
export const RoxyCelebrationImage = {
  asset: 'mascot_celebrate.webp',
  label: '读完啦',
} as const;

/**
 * `GodSettingsSection.kt` L141-145 `GodSettingSwitchRow(title, desc, checked, onCheckedChange)`。
 *
 * 修正：此处原先把字段写成 `description` / `onChange`，与 Kotlin 的 `desc` /
 * `onCheckedChange` 不一致（真正的实现见 `@ui/components/god/GodSettingsSection`，
 * 几何常量见 `@core/god/godSettingsSection`）。
 */
export interface GodSettingSwitchRow {
  readonly title: string;
  readonly desc: string;
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
}

/**
 * `GodSettingsSection.kt` L173-179 `GodStyleCard(style, selected, gold, modifier, onClick)`。
 *
 * 修正：原先是 `title/value/onOpen` —— 三个字段名与 Kotlin 全不一致，产物里
 * 也不存在这个「下拉式」卡片。真实契约是「风格 + 选中态 + 金色渐变 + 点击」。
 */
export interface GodStyleCard {
  readonly style: 'podium' | 'vinyl' | 'polaroid';
  readonly selected: boolean;
  readonly gold: readonly [string, string, string];
  readonly onClick: () => void;
}

/** `ReadingSettingsPanel.kt` L41 `ReadingSettingsPanel` 的入参（组件壳在 UI 层）。 */
export interface ReadingSettingsPanel {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily: string;
  readonly theme: 'light' | 'dark' | 'eye';
  readonly onFontSize: (next: number) => void;
  readonly onLineHeight: (next: number) => void;
  readonly onFontFamily: (next: string) => void;
  readonly onTheme: (next: 'light' | 'dark' | 'eye') => void;
}

/** `AdaptiveSpec.kt` L196 `AdaptiveWorkspace`：宽屏工作区的断点。 */
export const ADAPTIVE_WORKSPACE = {
  compactMaxWidthDp: 600,
  mediumMaxWidthDp: 840,
  expandedMinWidthDp: 840,
} as const;

/** Kotlin 原名出口。 */
export const AdaptiveWorkspace = ADAPTIVE_WORKSPACE;

/** `GlassManagementTopBar.kt` `GlassManagementTopBar`：玻璃管理页的顶栏契约。 */
export interface GlassManagementTopBar {
  readonly title: string;
  readonly onBack: () => void;
  readonly trailing?: unknown;
}

/** `SplashScreen.kt` L46 `TAG`：logcat 标签（Web 侧是 console 前缀）。 */
export const SplashScreenTAG = 'SplashScreen';

/** `TransferScreen.kt` `matchesPrompt`：配对码比较（去空格、忽略大小写）。 */
export function matchesPrompt(input: string, expected: string): boolean {
  const norm = (v: string): string => v.replace(/\s+/g, '').toLowerCase();
  return norm(input) === norm(expected) && norm(expected) !== '';
}

/** `TransferScreen.kt` L699 `permissionRequests`：发送/接收所需的权限声明。 */
export const TRANSFER_PERMISSION_REQUESTS = ['nearby-wifi-devices', 'local-network'] as const;
