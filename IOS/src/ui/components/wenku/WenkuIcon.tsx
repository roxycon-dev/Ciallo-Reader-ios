/**
 * Wenku 手绘纸片图标 —— `ui/wenku/WenkuIcon.kt` + `WenkuIconArt.kt` 的 SVG 版。
 *
 * Kotlin → TS 映射
 * ─────────────────
 * `WenkuIconArt.kt`
 *   L22-112    enum class WenkuSymbol（89 项）        → `WenkuSymbol` 联合类型 + `WENKU_SYMBOL_LABELS`
 *   L118-134   WenkuIconGesture（lead/follow/trail）  → 未移植（本层只画静止姿态，见下方"未移植"）
 *   L201-229   WenkuIconPoses.of / lerp（13 个变体）  → `wenkuIconPosesOf`
 *   L248-504   WenkuArtBuilder（变换栈 + card/mark/ring/path/line/poly/rect/
 *              circle/ellipse/arc/star）               → 构建期烘焙成 `WENKU_ICON_ART` 的字面量
 *   L513-1456  foldDrawing 的 76 个族符号 geometry     → `WENKU_ICON_ART`（78 项，含 5 项变体展开）
 *   L116-120   baseStrokeWidth                        → `wenkuIconStrokeWidth`
 *   L126-198   drawWenkuPose / drawWenkuStrokes       → `WenkuIcon` 的 <svg> + stroke/fill
 * `WenkuIconMapping.kt`
 *   L32-119    wenkuSymbolForIconName                 → `wenkuSymbolForIconName`
 *   L127-163   WenkuButtonGlyph                       → `WenkuButtonGlyph`
 *
 * 逐描边数据由 `WenkuIconArt.kt` 的图元逐行烘焙而来（构建期脚本，产物即本文件的字面量表），
 * 不是手绘近似：`card` = 折角纸片（L359-382）、`mark` = 45° 菱形（L384-389）、
 * `ring` = 8.4 半径缺口圆环 + 角点（L391-394）、`arc` = 4 段三次贝塞尔（L477-494）。
 *
 * 未移植（属绘制时钟，不进数据层）
 *   - L446-601 `WenkuIconAnimated` 的三时钟（change 380ms / contact 140·240ms / gesture 640ms）、
 *     `WenkuIconEntranceBatch` 的自上而下入场级联、常驻图标 2600ms 重播。
 *     本层的 `active` 只切换姿态（`wenkuIconPosesOf`），不做 morph 动画；
 *     按压位移 `easeOutCubic(contact)*.16` 由 CSS `:active` 的 0.94 缩放在交互层给。
 *   - L342-411 `WenkuIconResponse` 的 Listener（不抢手势竞技场）——React 侧用普通 onPointerDown，
 *     由调用方的 `pullOutClickable` 等价物决定是否消费。
 */

import type { CSSProperties, ReactElement } from 'react';

/** `WenkuSymbol`（Kotlin enum，89 项）。 */
export type WenkuSymbol =
  | 'Discover'
  | 'Shelf'
  | 'Book'
  | 'Folder'
  | 'FolderOpen'
  | 'Profile'
  | 'Back'
  | 'Forward'
  | 'Up'
  | 'Down'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'External'
  | 'Close'
  | 'More'
  | 'Contents'
  | 'Bookmark'
  | 'Bookmarked'
  | 'Location'
  | 'LocationFilled'
  | 'Typography'
  | 'Sliders'
  | 'Image'
  | 'Brightness'
  | 'Moon'
  | 'Layers'
  | 'Quotes'
  | 'Language'
  | 'Portrait'
  | 'Headphones'
  | 'Play'
  | 'Pause'
  | 'Stop'
  | 'Previous'
  | 'Next'
  | 'Waveform'
  | 'Voice'
  | 'Volume'
  | 'Speed'
  | 'Timer'
  | 'Search'
  | 'Filter'
  | 'Layout'
  | 'Grid'
  | 'DotsGrid'
  | 'Add'
  | 'AddCircle'
  | 'RemoveCircle'
  | 'Check'
  | 'CheckCircle'
  | 'Selected'
  | 'Circle'
  | 'Edit'
  | 'Delete'
  | 'Copy'
  | 'Share'
  | 'Link'
  | 'Refresh'
  | 'Sync'
  | 'Download'
  | 'CloudDownload'
  | 'Upload'
  | 'ImportFile'
  | 'Document'
  | 'FolderAdd'
  | 'Wand'
  | 'Settings'
  | 'Info'
  | 'Warning'
  | 'Wifi'
  | 'WifiOff'
  | 'WifiWarning'
  | 'Cloud'
  | 'Globe'
  | 'Phone'
  | 'Laptop'
  | 'Branch'
  | 'PersonAdd'
  | 'Eye'
  | 'EyeOff'
  | 'CloseCircle'
  | 'Battery'
  | 'Charging'
  | 'Tools'
  | 'Shield'
  | 'Help'
  | 'Touch';

/** Kotlin enum 自带的 `label` / `group`（无障碍文案与调试分组）。 */
export const WENKU_SYMBOL_LABELS: Readonly<
  Record<WenkuSymbol, { readonly label: string; readonly group: string }>
> = {
  Discover: { label: '发现', group: '导航' },
  Shelf: { label: '书架', group: '导航' },
  Book: { label: '阅读', group: '导航' },
  Folder: { label: '本地书库', group: '导航' },
  FolderOpen: { label: '打开文件夹', group: '导航' },
  Profile: { label: '我的', group: '导航' },
  Back: { label: '返回', group: '导航' },
  Forward: { label: '前进', group: '导航' },
  Up: { label: '收起', group: '导航' },
  Down: { label: '展开', group: '导航' },
  ArrowLeft: { label: '上一项', group: '导航' },
  ArrowRight: { label: '下一项', group: '导航' },
  ArrowUp: { label: '向上', group: '导航' },
  ArrowDown: { label: '向下', group: '导航' },
  External: { label: '打开链接', group: '导航' },
  Close: { label: '关闭', group: '导航' },
  More: { label: '更多', group: '导航' },
  Contents: { label: '目录', group: '阅读' },
  Bookmark: { label: '书签', group: '阅读' },
  Bookmarked: { label: '已收藏', group: '阅读' },
  Location: { label: '定位章节', group: '阅读' },
  LocationFilled: { label: '跟随朗读', group: '阅读' },
  Typography: { label: '字体', group: '阅读' },
  Sliders: { label: '阅读设置', group: '阅读' },
  Image: { label: '插图', group: '阅读' },
  Brightness: { label: '亮度', group: '阅读' },
  Moon: { label: '夜间阅读', group: '阅读' },
  Layers: { label: '合并卷', group: '阅读' },
  Quotes: { label: '摘录', group: '阅读' },
  Language: { label: '双语', group: '阅读' },
  Portrait: { label: '强制竖屏', group: '阅读' },
  Headphones: { label: '听书', group: '听书' },
  Play: { label: '播放', group: '听书' },
  Pause: { label: '暂停', group: '听书' },
  Stop: { label: '停止', group: '听书' },
  Previous: { label: '上一段', group: '听书' },
  Next: { label: '下一段', group: '听书' },
  Waveform: { label: '声音', group: '听书' },
  Voice: { label: '音色', group: '听书' },
  Volume: { label: '音量', group: '听书' },
  Speed: { label: '速度', group: '听书' },
  Timer: { label: '历史与定时', group: '听书' },
  Search: { label: '搜索', group: '操作' },
  Filter: { label: '筛选排序', group: '操作' },
  Layout: { label: '视图布局', group: '操作' },
  Grid: { label: '网格视图', group: '操作' },
  DotsGrid: { label: '布局', group: '操作' },
  Add: { label: '添加', group: '操作' },
  AddCircle: { label: '添加项目', group: '操作' },
  RemoveCircle: { label: '移出', group: '操作' },
  Check: { label: '完成', group: '操作' },
  CheckCircle: { label: '勾选', group: '操作' },
  Selected: { label: '已选择', group: '操作' },
  Circle: { label: '未选择', group: '操作' },
  Edit: { label: '编辑', group: '操作' },
  Delete: { label: '删除', group: '操作' },
  Copy: { label: '复制', group: '操作' },
  Share: { label: '分享', group: '操作' },
  Link: { label: '关联原文件', group: '操作' },
  Refresh: { label: '刷新重试', group: '操作' },
  Sync: { label: '同步', group: '文件' },
  Download: { label: '下载', group: '文件' },
  CloudDownload: { label: '离线缓存', group: '文件' },
  Upload: { label: '更新', group: '文件' },
  ImportFile: { label: '导入', group: '文件' },
  Document: { label: '文档', group: '文件' },
  FolderAdd: { label: '添加目录', group: '文件' },
  Wand: { label: '整理修复', group: '文件' },
  Settings: { label: '设置', group: '系统' },
  Info: { label: '关于', group: '系统' },
  Warning: { label: '异常', group: '系统' },
  Wifi: { label: '无线连接', group: '系统' },
  WifiOff: { label: '离线', group: '系统' },
  WifiWarning: { label: '连接异常', group: '系统' },
  Cloud: { label: '云书库', group: '系统' },
  Globe: { label: '官网', group: '系统' },
  Phone: { label: '手机', group: '系统' },
  Laptop: { label: '电脑', group: '系统' },
  Branch: { label: '同步冲突', group: '系统' },
  PersonAdd: { label: '注册账号', group: '系统' },
  Eye: { label: '显示', group: '系统' },
  EyeOff: { label: '隐藏', group: '系统' },
  CloseCircle: { label: '清空', group: '系统' },
  Battery: { label: '电量', group: '系统' },
  Charging: { label: '充电', group: '系统' },
  Tools: { label: '故障排查', group: '系统' },
  Shield: { label: '安全', group: '系统' },
  Help: { label: '帮助', group: '系统' },
  Touch: { label: '触摸', group: '阅读' },
};

/** 一条已烘焙描边：`WenkuIconStroke`（L146-152），坐标固定 24×24。 */
export interface WenkuIconStroke {
  readonly d: string;
  readonly fill: boolean;
  /** `WenkuIconStroke.opacity`（0..1），与 `stroke.opacity` 同义。 */
  readonly opacity: number;
  /** 线宽系数，乘 `wenkuIconStrokeWidth`。 */
  readonly width: number;
}

/**
 * 烘焙后的逐符号描边表。键 = 可绘制族符号；13 个变体符号先经 `wenkuIconPosesOf`
 * 折叠（Pause→Play / Back·Up·Down→Forward / ArrowLeft·ArrowUp·ArrowDown·External→ArrowRight /
 * Bookmarked→Bookmark / EyeOff→Eye / CheckCircle·Selected→Circle / LocationFilled→Location）。
 */
export const WENKU_ICON_ART: Readonly<Record<string, readonly WenkuIconStroke[]>> = {
  ArrowRight: [
    { d: 'M3.8 12L19 12', fill: false, opacity: 1, width: 1 },
    { d: 'M13 5.8L19 12L13 18.2', fill: false, opacity: 1, width: 1 },
  ],
  Forward: [
    { d: 'M8.4 5.6L15.4 12L8.4 18.4', fill: false, opacity: 1, width: 1 },
    { d: 'M5.4 11.4L6.65 11.4Q6.65 11.4 6.65 11.4L6.65 12.65Q6.65 12.65 6.65 12.65L5.4 12.65Q5.4 12.65 5.4 12.65L5.4 11.4Q5.4 11.4 5.4 11.4Z', fill: true, opacity: 1, width: 1 },
  ],
  Close: [
    { d: 'M6.6 6.6L17.4 17.4', fill: false, opacity: 1, width: 1 },
    { d: 'M17.4 6.6L6.6 17.4', fill: false, opacity: 1, width: 1 },
  ],
  CloseCircle: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M9 9L15 15', fill: false, opacity: 1, width: 1 },
    { d: 'M15 9L9 15', fill: false, opacity: 1, width: 1 },
  ],
  More: [
    { d: 'M4.3 11L6.1 11Q6.1 11 6.1 11L6.1 12.8Q6.1 12.8 6.1 12.8L4.3 12.8Q4.3 12.8 4.3 12.8L4.3 11Q4.3 11 4.3 11Z', fill: true, opacity: 1, width: 1 },
    { d: 'M11.9 10.627L13.173 11.9Q13.173 11.9 13.173 11.9L11.9 13.173Q11.9 13.173 11.9 13.173L10.627 11.9Q10.627 11.9 10.627 11.9L11.9 10.627Q11.9 10.627 11.9 10.627Z', fill: true, opacity: 1, width: 1 },
    { d: 'M17.7 11L19.5 11Q19.5 11 19.5 11L19.5 12.8Q19.5 12.8 19.5 12.8L17.7 12.8Q17.7 12.8 17.7 12.8L17.7 11Q17.7 11 17.7 11Z', fill: true, opacity: 1, width: 1 },
  ],
  Contents: [
    { d: 'M3.4 5.3L5.2 5.3Q5.2 5.3 5.2 5.3L5.2 7.1Q5.2 7.1 5.2 7.1L3.4 7.1Q3.4 7.1 3.4 7.1L3.4 5.3Q3.4 5.3 3.4 5.3Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8.2 6.2L20.3 6.2', fill: false, opacity: 1, width: 1 },
    { d: 'M3.4 11.8L5.2 11.8Q5.2 11.8 5.2 11.8L5.2 13.6Q5.2 13.6 5.2 13.6L3.4 13.6Q3.4 13.6 3.4 13.6L3.4 11.8Q3.4 11.8 3.4 11.8Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8.2 12.7L17 12.7', fill: false, opacity: 1, width: 1 },
    { d: 'M3.4 18.3L5.2 18.3Q5.2 18.3 5.2 18.3L5.2 20.1Q5.2 20.1 5.2 20.1L3.4 20.1Q3.4 20.1 3.4 20.1L3.4 18.3Q3.4 18.3 3.4 18.3Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8.2 19.2L20.3 19.2', fill: false, opacity: 1, width: 1 },
  ],
  External: [
    { d: 'M6.202 17.798L16.95 7.05', fill: false, opacity: 1, width: 1 },
    { d: 'M8.323 6.909L16.95 7.05L17.091 15.677', fill: false, opacity: 1, width: 1 },
  ],
  Shelf: [
    { d: 'M2.5 19.6L2.5 21L21.5 21', fill: false, opacity: 1, width: 1 },
    { d: 'M3.6 6L6.9 6L8.4 7.5L8.4 19.6L3.6 19.6Z', fill: true, opacity: 0.19, width: 1 },
    { d: 'M3.6 6L6.9 6L8.4 7.5L8.4 19.6L3.6 19.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M6.9 6L6.9 7.5L8.4 7.5', fill: false, opacity: 0.7, width: 1 },
    { d: 'M5.2 9L6.5 9Q6.5 9 6.5 9L6.5 10.3Q6.5 10.3 6.5 10.3L5.2 10.3Q5.2 10.3 5.2 10.3L5.2 9Q5.2 9 5.2 9Z', fill: true, opacity: 1, width: 1 },
    { d: 'M10 3.9L13 3.9L14.5 5.4L14.5 19.6L10 19.6Z', fill: true, opacity: 0.09, width: 1 },
    { d: 'M10 3.9L13 3.9L14.5 5.4L14.5 19.6L10 19.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M13 3.9L13 5.4L14.5 5.4', fill: false, opacity: 0.7, width: 1 },
    { d: 'M11.6 7L12.8 7', fill: false, opacity: 1, width: 1 },
    { d: 'M15.462 6.527L18.241 6.191L19.688 7.327L21.136 19.34L17.066 19.83Z', fill: true, opacity: 0.08, width: 1 },
    { d: 'M15.462 6.527L18.241 6.191L19.688 7.327L21.136 19.34L17.066 19.83Z', fill: false, opacity: 1, width: 1 },
    { d: 'M18.241 6.191L18.397 7.482L19.688 7.327', fill: false, opacity: 0.7, width: 1 },
  ],
  Book: [
    { d: 'M3.1 6Q7.5 4.1 12 7Q16 4.3 20.9 6L20.3 18.6Q16.1 17.8 12 20Q7.9 17.8 3.7 18.6Z', fill: true, opacity: 0.06, width: 1 },
    { d: 'M3.1 6Q7.5 4.1 12 7Q16 4.3 20.9 6L20.3 18.6Q16.1 17.8 12 20Q7.9 17.8 3.7 18.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M3.5 21L8.1 20.3L12 21.5L15.9 20.3L20.5 21', fill: false, opacity: 0.5, width: 1 },
    { d: 'M12 7L12 20', fill: false, opacity: 1, width: 1 },
    { d: 'M12 7Q16.6 2.3 19.6 4.7L19.5 16.9Q15 16.6 12 20', fill: false, opacity: 1, width: 1 },
    { d: 'M5.7 9.5L8.8 10.1', fill: false, opacity: 1, width: 1 },
  ],
  Bookmark: [
    { d: 'M6 3.2L14.8 3.2L18 6.4Q18 12 18 21L12 16.8L6 21Z', fill: true, opacity: 0.09, width: 1 },
    { d: 'M6 3.2L14.8 3.2L18 6.4Q18 12 18 21L12 16.8L6 21Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14.8 3.2L14.8 6.4L18 6.4', fill: false, opacity: 1, width: 1 },
    { d: 'M9 8.7L12 8.7', fill: false, opacity: 1, width: 1 },
  ],
  Headphones: [
    { d: 'M4.2 14L4.2 10.3C4.2 1 19.8 1 19.8 10.3L19.8 14', fill: false, opacity: 1, width: 1 },
    { d: 'M3.2 12L6.5 12L7.8 13.3L7.8 20L3.2 20Z', fill: true, opacity: 0.2, width: 1 },
    { d: 'M3.2 12L6.5 12L7.8 13.3L7.8 20L3.2 20Z', fill: false, opacity: 1, width: 1 },
    { d: 'M6.5 12L6.5 13.3L7.8 13.3', fill: false, opacity: 0.7, width: 1 },
    { d: 'M16.2 12L19.5 12L20.8 13.3L20.8 20L16.2 20Z', fill: true, opacity: 0.2, width: 1 },
    { d: 'M16.2 12L19.5 12L20.8 13.3L20.8 20L16.2 20Z', fill: false, opacity: 1, width: 1 },
    { d: 'M19.5 12L19.5 13.3L20.8 13.3', fill: false, opacity: 0.7, width: 1 },
  ],
  Play: [
    { d: 'M7.2 4.7L7.2 19.3L12.3 16.3L12.3 7.7Z', fill: true, opacity: 1, width: 1 },
    { d: 'M12.3 7.7L12.3 16.3L19.4 12L19.4 12Z', fill: true, opacity: 0.69, width: 1 },
  ],
  Pause: [
    { d: 'M6.5 4.7L6.5 19.3L10.3 18.1L10.3 4.7Z', fill: true, opacity: 1, width: 1 },
    { d: 'M10.3 4.7L10.3 19.3L18.2 18.1L18.2 4.7Z', fill: true, opacity: 0.69, width: 1 },
  ],
  Timer: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M12 6.5L12 12L16.3 14.7', fill: false, opacity: 1, width: 1 },
    { d: 'M11.3 11.3L12.7 11.3Q12.7 11.3 12.7 11.3L12.7 12.7Q12.7 12.7 12.7 12.7L11.3 12.7Q11.3 12.7 11.3 12.7L11.3 11.3Q11.3 11.3 11.3 11.3Z', fill: true, opacity: 1, width: 1 },
  ],
  Typography: [
    { d: 'M3.4 7.5L4 4.8L16.2 4.8L16.8 7.5', fill: false, opacity: 1, width: 1 },
    { d: 'M10.1 5L10.1 19.8', fill: false, opacity: 1, width: 1.35 },
    { d: 'M6.6 20L14.1 20', fill: false, opacity: 1, width: 1 },
    { d: 'M17.6 12L21 12', fill: false, opacity: 1, width: 1 },
    { d: 'M17.6 16L20.2 16', fill: false, opacity: 1, width: 1 },
    { d: 'M17.6 19.2L18.9 19.2Q18.9 19.2 18.9 19.2L18.9 20.5Q18.9 20.5 18.9 20.5L17.6 20.5Q17.6 20.5 17.6 20.5L17.6 19.2Q17.6 19.2 17.6 19.2Z', fill: true, opacity: 1, width: 1 },
  ],
  Sliders: [
    { d: 'M5.5 3L5.5 5.9', fill: false, opacity: 1, width: 1 },
    { d: 'M5.5 10.1L5.5 21', fill: false, opacity: 1, width: 1 },
    { d: 'M3.4 6.4L6.4 6.4L7.6 7.6L7.6 9.6L3.4 9.6Z', fill: true, opacity: 0.22, width: 1 },
    { d: 'M3.4 6.4L6.4 6.4L7.6 7.6L7.6 9.6L3.4 9.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12 3L12 12.9', fill: false, opacity: 1, width: 1 },
    { d: 'M12 17.1L12 21', fill: false, opacity: 1, width: 1 },
    { d: 'M9.9 13.4L12.9 13.4L14.1 14.6L14.1 16.6L9.9 16.6Z', fill: true, opacity: 0.22, width: 1 },
    { d: 'M9.9 13.4L12.9 13.4L14.1 14.6L14.1 16.6L9.9 16.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M18.5 3L18.5 4.9', fill: false, opacity: 1, width: 1 },
    { d: 'M18.5 9.1L18.5 21', fill: false, opacity: 1, width: 1 },
    { d: 'M16.4 5.4L19.4 5.4L20.6 6.6L20.6 8.6L16.4 8.6Z', fill: true, opacity: 0.22, width: 1 },
    { d: 'M16.4 5.4L19.4 5.4L20.6 6.6L20.6 8.6L16.4 8.6Z', fill: false, opacity: 1, width: 1 },
  ],
  Image: [
    { d: 'M3.3 4L16.6 4L20.7 8.1L20.7 20.2L3.3 20.2Z', fill: true, opacity: 0.08, width: 1 },
    { d: 'M3.3 4L16.6 4L20.7 8.1L20.7 20.2L3.3 20.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M16.6 4L16.6 8.1L20.7 8.1', fill: false, opacity: 0.7, width: 1 },
    { d: 'M9.35 8.9C9.35 9.646 8.746 10.25 8 10.25C7.254 10.25 6.65 9.646 6.65 8.9C6.65 8.154 7.254 7.55 8 7.55C8.746 7.55 9.35 8.154 9.35 8.9Z', fill: true, opacity: 1, width: 1 },
    { d: 'M3.6 17L8.2 12.2L11.9 15.5L15.8 11.6L20.4 17', fill: false, opacity: 1, width: 1 },
  ],
  Brightness: [
    { d: 'M15.8 12C15.8 14.099 14.099 15.8 12 15.8C9.901 15.8 8.2 14.099 8.2 12C8.2 9.901 9.901 8.2 12 8.2C14.099 8.2 15.8 9.901 15.8 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12 8.2C6.9 8.2 6.9 15.8 12 15.8Z', fill: true, opacity: 0.22, width: 1 },
    { d: 'M18.7 12L21.2 12', fill: false, opacity: 1, width: 1 },
    { d: 'M16.738 16.738L18.505 18.505', fill: false, opacity: 1, width: 1 },
    { d: 'M12 18.7L12 21.2', fill: false, opacity: 1, width: 1 },
    { d: 'M7.262 16.738L5.495 18.505', fill: false, opacity: 1, width: 1 },
    { d: 'M5.3 12L2.8 12', fill: false, opacity: 1, width: 1 },
    { d: 'M7.262 7.262L5.495 5.495', fill: false, opacity: 1, width: 1 },
    { d: 'M12 5.3L12 2.8', fill: false, opacity: 1, width: 1 },
    { d: 'M16.738 7.262L18.505 5.495', fill: false, opacity: 1, width: 1 },
  ],
  Moon: [
    { d: 'M17.8 15.2C10.1 17.2 7 10.2 9.5 3.6C3.5 5.4 2.6 13 6.4 17.5C10.4 21.8 17 21.1 20 15Q18.8 15.8 17.8 15.2Z', fill: true, opacity: 0.13, width: 1 },
    { d: 'M17.8 15.2C10.1 17.2 7 10.2 9.5 3.6C3.5 5.4 2.6 13 6.4 17.5C10.4 21.8 17 21.1 20 15Q18.8 15.8 17.8 15.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M17.5 4.5Q17.77 6.03 19.3 6.3Q17.77 6.57 17.5 8.1Q17.23 6.57 15.7 6.3Q17.23 6.03 17.5 4.5Z', fill: false, opacity: 1, width: 1 },
  ],
  Layers: [
    { d: 'M3.5 16.4L12 21L20.5 16.4', fill: false, opacity: 1, width: 1 },
    { d: 'M3.5 12.2L12 16.8L20.5 12.2', fill: false, opacity: 1, width: 1 },
    { d: 'M3.5 7.8L12 3.2L20.5 7.8L12 12.4Z', fill: true, opacity: 0.13, width: 1 },
    { d: 'M3.5 7.8L12 3.2L20.5 7.8L12 12.4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12 3.2L12 6.4', fill: false, opacity: 1, width: 1 },
  ],
  Quotes: [
    { d: 'M3.8 5.6L8.7 5.6L10.6 7.5L10.6 12.9L3.8 12.9Z', fill: true, opacity: 0.26, width: 1 },
    { d: 'M3.8 5.6L8.7 5.6L10.6 7.5L10.6 12.9L3.8 12.9Z', fill: false, opacity: 1, width: 1 },
    { d: 'M8.7 5.6L8.7 7.5L10.6 7.5', fill: false, opacity: 0.7, width: 1 },
    { d: 'M10.6 12.9Q9.8 18.8 5.6 19.7', fill: false, opacity: 1, width: 1 },
    { d: 'M12.8 5.6L17.7 5.6L19.6 7.5L19.6 12.9L12.8 12.9Z', fill: true, opacity: 0.26, width: 1 },
    { d: 'M12.8 5.6L17.7 5.6L19.6 7.5L19.6 12.9L12.8 12.9Z', fill: false, opacity: 1, width: 1 },
    { d: 'M17.7 5.6L17.7 7.5L19.6 7.5', fill: false, opacity: 0.7, width: 1 },
    { d: 'M19.6 12.9Q18.8 18.8 14.6 19.7', fill: false, opacity: 1, width: 1 },
  ],
  Language: [
    { d: 'M2.9 6.2L13.2 6.2', fill: false, opacity: 1, width: 1 },
    { d: 'M8.1 3.2L8.1 6.2', fill: false, opacity: 1, width: 1 },
    { d: 'M11.4 6.3Q10 13.5 3.3 16.3', fill: false, opacity: 1, width: 1 },
    { d: 'M5 9.5Q7.6 13.3 11.2 14.5', fill: false, opacity: 1, width: 1 },
    { d: 'M12.6 20L17.1 9.2L21.5 20', fill: false, opacity: 1, width: 1 },
    { d: 'M14.1 16.6L20 16.6', fill: false, opacity: 1, width: 1 },
    { d: 'M17.15 3.531L18.069 4.45Q18.069 4.45 18.069 4.45L17.15 5.369Q17.15 5.369 17.15 5.369L16.231 4.45Q16.231 4.45 16.231 4.45L17.15 3.531Q17.15 3.531 17.15 3.531Z', fill: true, opacity: 1, width: 1 },
  ],
  Portrait: [
    { d: 'M6.7 2.7L14.8 2.7L17.3 5.2L17.3 21.3L6.7 21.3Z', fill: true, opacity: 0.09, width: 1 },
    { d: 'M6.7 2.7L14.8 2.7L17.3 5.2L17.3 21.3L6.7 21.3Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14.8 2.7L14.8 5.2L17.3 5.2', fill: false, opacity: 0.7, width: 1 },
    { d: 'M10.4 18.5L13.6 18.5', fill: false, opacity: 1, width: 1 },
    { d: 'M9.4 9.7L13.5 9.7L14.6 10.8L14.6 14.5L9.4 14.5Z', fill: true, opacity: 0.18, width: 1 },
    { d: 'M9.4 9.7L13.5 9.7L14.6 10.8L14.6 14.5L9.4 14.5Z', fill: false, opacity: 1, width: 1 },
    { d: 'M13.5 9.7L13.5 10.8L14.6 10.8', fill: false, opacity: 0.7, width: 1 },
    { d: 'M10.4 9.7L10.4 7.9C10.4 5.5 13.6 5.5 13.6 7.9L13.6 9.7', fill: false, opacity: 1, width: 1 },
  ],
  Touch: [
    { d: 'M16.7 14.9L19.3 14.5L19.3 15.6Q19.3 18.4 17.6 20.1L17.6 21L15.8 21Q17.4 17.5 16.7 14.9Z', fill: true, opacity: 0.1, width: 1 },
    { d: 'M8.2 13.2L8.2 5.9C8.2 3.7 11.6 3.7 11.6 5.9L11.6 10.4C12.7 9.2 14.3 9.6 14.3 11.1C15.1 10 16.7 10.4 16.7 11.8C17.8 10.9 19.3 11.7 19.3 13.2L19.3 15.6Q19.3 18.4 17.6 20.1L17.6 21L10 21L10 20.4Q8.8 19.7 7.7 18.1L4.4 13.9C3.4 12.6 4.9 11 6.1 12L8.2 14.1Z', fill: false, opacity: 1, width: 1 },
    { d: 'M11.6 10.4L11.6 13.1', fill: false, opacity: 1, width: 1 },
    { d: 'M14.3 11.1L14.3 13.6', fill: false, opacity: 1, width: 1 },
    { d: 'M16.7 11.8L16.7 14', fill: false, opacity: 1, width: 1 },
    { d: 'M10.2 1.6L10.2 2.5', fill: false, opacity: 1, width: 1 },
    { d: 'M5.6 3L6.5 3.8', fill: false, opacity: 1, width: 1 },
    { d: 'M14.8 3L13.9 3.8', fill: false, opacity: 1, width: 1 },
  ],
  Search: [
    { d: 'M15.475 6.366C16.427 7.619 16.893 9.175 16.785 10.746C16.677 12.316 16.003 13.794 14.888 14.905C13.772 16.016 12.292 16.684 10.721 16.786C9.151 16.888 7.596 16.417 6.347 15.46C5.097 14.502 4.238 13.124 3.928 11.581C3.617 10.038 3.878 8.435 4.66 7.069C5.442 5.703 6.694 4.668 8.182 4.155C9.67 3.642 11.294 3.686 12.752 4.28', fill: false, opacity: 1, width: 1 },
    { d: 'M14.45 3.831L15.369 4.75Q15.369 4.75 15.369 4.75L14.45 5.669Q14.45 5.669 14.45 5.669L13.531 4.75Q13.531 4.75 13.531 4.75L14.45 3.831Q14.45 3.831 14.45 3.831Z', fill: true, opacity: 1, width: 1 },
    { d: 'M14.8 16L16 14.8L21 19.8L19.8 21Z', fill: true, opacity: 1, width: 1 },
  ],
  Filter: [
    { d: 'M3.5 5.5L5.5 5.5', fill: false, opacity: 1, width: 0.82 },
    { d: 'M10.5 5.5L20.5 5.5', fill: false, opacity: 1, width: 0.82 },
    { d: 'M6.7 3.5L9.3 3.5Q9.3 3.5 9.3 3.5L9.3 7.5Q9.3 7.5 9.3 7.5L6.7 7.5Q6.7 7.5 6.7 7.5L6.7 3.5Q6.7 3.5 6.7 3.5Z', fill: true, opacity: 1, width: 1 },
    { d: 'M3.5 12L13.5 12', fill: false, opacity: 1, width: 0.82 },
    { d: 'M18.5 12L20.5 12', fill: false, opacity: 1, width: 0.82 },
    { d: 'M14.7 10L17.3 10Q17.3 10 17.3 10L17.3 14Q17.3 14 17.3 14L14.7 14Q14.7 14 14.7 14L14.7 10Q14.7 10 14.7 10Z', fill: true, opacity: 1, width: 1 },
    { d: 'M3.5 18.5L7.5 18.5', fill: false, opacity: 1, width: 0.82 },
    { d: 'M12.5 18.5L20.5 18.5', fill: false, opacity: 1, width: 0.82 },
    { d: 'M8.7 16.5L11.3 16.5Q11.3 16.5 11.3 16.5L11.3 20.5Q11.3 20.5 11.3 20.5L8.7 20.5Q8.7 20.5 8.7 20.5L8.7 16.5Q8.7 16.5 8.7 16.5Z', fill: true, opacity: 1, width: 1 },
  ],
  Grid: [
    { d: 'M4 4L10 4Q10 4 10 4L10 10Q10 10 10 10L4 10Q4 10 4 10L4 4Q4 4 4 4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M4 4L10 4Q10 4 10 4L10 10Q10 10 10 10L4 10Q4 10 4 10L4 4Q4 4 4 4Z', fill: true, opacity: 0.14, width: 1 },
    { d: 'M14 4L20 4Q20 4 20 4L20 10Q20 10 20 10L14 10Q14 10 14 10L14 4Q14 4 14 4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M4 14L10 14Q10 14 10 14L10 20Q10 20 10 20L4 20Q4 20 4 20L4 14Q4 14 4 14Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14 14L20 14Q20 14 20 14L20 20Q20 20 20 20L14 20Q14 20 14 20L14 14Q14 14 14 14Z', fill: false, opacity: 1, width: 1 },
  ],
  DotsGrid: [
    { d: 'M4.2 4.2L5.9 4.2Q5.9 4.2 5.9 4.2L5.9 5.9Q5.9 5.9 5.9 5.9L4.2 5.9Q4.2 5.9 4.2 5.9L4.2 4.2Q4.2 4.2 4.2 4.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M11.2 4.2L12.9 4.2Q12.9 4.2 12.9 4.2L12.9 5.9Q12.9 5.9 12.9 5.9L11.2 5.9Q11.2 5.9 11.2 5.9L11.2 4.2Q11.2 4.2 11.2 4.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M18.2 4.2L19.9 4.2Q19.9 4.2 19.9 4.2L19.9 5.9Q19.9 5.9 19.9 5.9L18.2 5.9Q18.2 5.9 18.2 5.9L18.2 4.2Q18.2 4.2 18.2 4.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M4.2 11.2L5.9 11.2Q5.9 11.2 5.9 11.2L5.9 12.9Q5.9 12.9 5.9 12.9L4.2 12.9Q4.2 12.9 4.2 12.9L4.2 11.2Q4.2 11.2 4.2 11.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M12.05 10.848L13.252 12.05Q13.252 12.05 13.252 12.05L12.05 13.252Q12.05 13.252 12.05 13.252L10.848 12.05Q10.848 12.05 10.848 12.05L12.05 10.848Q12.05 10.848 12.05 10.848Z', fill: true, opacity: 1, width: 1 },
    { d: 'M18.2 11.2L19.9 11.2Q19.9 11.2 19.9 11.2L19.9 12.9Q19.9 12.9 19.9 12.9L18.2 12.9Q18.2 12.9 18.2 12.9L18.2 11.2Q18.2 11.2 18.2 11.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M4.2 18.2L5.9 18.2Q5.9 18.2 5.9 18.2L5.9 19.9Q5.9 19.9 5.9 19.9L4.2 19.9Q4.2 19.9 4.2 19.9L4.2 18.2Q4.2 18.2 4.2 18.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M11.2 18.2L12.9 18.2Q12.9 18.2 12.9 18.2L12.9 19.9Q12.9 19.9 12.9 19.9L11.2 19.9Q11.2 19.9 11.2 19.9L11.2 18.2Q11.2 18.2 11.2 18.2Z', fill: true, opacity: 1, width: 1 },
    { d: 'M18.2 18.2L19.9 18.2Q19.9 18.2 19.9 18.2L19.9 19.9Q19.9 19.9 19.9 19.9L18.2 19.9Q18.2 19.9 18.2 19.9L18.2 18.2Q18.2 18.2 18.2 18.2Z', fill: true, opacity: 1, width: 1 },
  ],
  Add: [
    { d: 'M5.6 12L18.4 12', fill: false, opacity: 1, width: 1 },
    { d: 'M12 5.6L12 18.4', fill: false, opacity: 1, width: 1.13 },
  ],
  AddCircle: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8.3 12L15.7 12', fill: false, opacity: 1, width: 1 },
    { d: 'M12 8.3L12 15.7', fill: false, opacity: 1, width: 1.13 },
  ],
  RemoveCircle: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8.3 12L15.7 12', fill: false, opacity: 1, width: 1 },
  ],
  Check: [
    { d: 'M4.4 12.5L9.4 17.4L20.2 6.3', fill: false, opacity: 1, width: 1 },
    { d: 'M19.5 5.551L20.349 6.4Q20.349 6.4 20.349 6.4L19.5 7.249Q19.5 7.249 19.5 7.249L18.651 6.4Q18.651 6.4 18.651 6.4L19.5 5.551Q19.5 5.551 19.5 5.551Z', fill: true, opacity: 1, width: 1 },
  ],
  Circle: [
    { d: 'M20.4 12C20.4 16.639 16.639 20.4 12 20.4C7.361 20.4 3.6 16.639 3.6 12C3.6 7.361 7.361 3.6 12 3.6C16.639 3.6 20.4 7.361 20.4 12Z', fill: true, opacity: 0, width: 1 },
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
  ],
  Selected: [
    { d: 'M20.4 12C20.4 16.639 16.639 20.4 12 20.4C7.361 20.4 3.6 16.639 3.6 12C3.6 7.361 7.361 3.6 12 3.6C16.639 3.6 20.4 7.361 20.4 12Z', fill: true, opacity: 0.21, width: 1 },
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M7.5 12.1L10.7 15.5L16.7 8.5', fill: false, opacity: 1, width: 1 },
  ],
  CheckCircle: [
    { d: 'M20.4 12C20.4 16.639 16.639 20.4 12 20.4C7.361 20.4 3.6 16.639 3.6 12C3.6 7.361 7.361 3.6 12 3.6C16.639 3.6 20.4 7.361 20.4 12Z', fill: true, opacity: 0, width: 1 },
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M7.5 12.1L10.7 15.5L16.7 8.5', fill: false, opacity: 1, width: 1 },
  ],
  Edit: [
    { d: 'M3.6 20.3L6.1 12.2L16 3.2L20.7 7.9L11.7 17.8Z', fill: false, opacity: 1, width: 1 },
    { d: 'M3.6 20.3L6.1 12.2L11.7 17.8Z', fill: true, opacity: 0.17, width: 1 },
    { d: 'M6.8 16.8L9.4 14.2', fill: false, opacity: 1, width: 1 },
    { d: 'M9.45 13.272L10.228 14.05Q10.228 14.05 10.228 14.05L9.45 14.828Q9.45 14.828 9.45 14.828L8.672 14.05Q8.672 14.05 8.672 14.05L9.45 13.272Q9.45 13.272 9.45 13.272Z', fill: true, opacity: 1, width: 1 },
    { d: 'M13.2 5.8L18 10.6', fill: false, opacity: 1, width: 1 },
  ],
  Delete: [
    { d: 'M5.5 9L6.2 20L15.6 20L17.7 17.8L18.5 9', fill: false, opacity: 1, width: 1 },
    { d: 'M14.6 10.7L14.2 17.4L16.4 17.4Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M9.3 11.2L9.7 17.1', fill: false, opacity: 1, width: 1 },
    { d: 'M3.7 6.7L20.3 6.7', fill: false, opacity: 1, width: 1 },
    { d: 'M9 6.7L9 4.1L15 4.1L15 6.7', fill: false, opacity: 1, width: 1 },
  ],
  Copy: [
    { d: 'M3.5 3.2L12.8 3.2L15.5 5.9L15.5 17.2L3.5 17.2Z', fill: true, opacity: 0.07, width: 1 },
    { d: 'M3.5 3.2L12.8 3.2L15.5 5.9L15.5 17.2L3.5 17.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12.8 3.2L12.8 5.9L15.5 5.9', fill: false, opacity: 0.7, width: 1 },
    { d: 'M8.2 7.1L17.5 7.1L20.2 9.8L20.2 21.1L8.2 21.1Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M8.2 7.1L17.5 7.1L20.2 9.8L20.2 21.1L8.2 21.1Z', fill: false, opacity: 1, width: 1 },
    { d: 'M17.5 7.1L17.5 9.8L20.2 9.8', fill: false, opacity: 0.7, width: 1 },
  ],
  Share: [
    { d: 'M4.2 11.7L4.2 18.6L6.1 20.5L19.8 20.5L19.8 11.7', fill: false, opacity: 1, width: 1 },
    { d: 'M12 15.2L12 3.7', fill: false, opacity: 1, width: 1 },
    { d: 'M7.7 8L12 3.7L16.3 8', fill: false, opacity: 1, width: 1 },
  ],
  Link: [
    { d: 'M10 7.9L12.8 5.1C18.2 -0.2 24 5.6 18.7 11L16.3 13.5', fill: false, opacity: 1, width: 1 },
    { d: 'M14 16.1L11.2 18.9C5.8 24.2 0 18.4 5.3 13L7.7 10.5', fill: false, opacity: 1, width: 1 },
    { d: 'M8.6 15.4L15.4 8.6', fill: false, opacity: 1, width: 1 },
  ],
  Refresh: [
    { d: 'M18.438 7.596C19.468 9.103 19.938 10.923 19.765 12.74C19.591 14.558 18.786 16.257 17.489 17.542C16.192 18.826 14.486 19.615 12.667 19.771C10.848 19.927 9.032 19.441 7.535 18.395C6.038 17.35 4.955 15.813 4.475 14.052C3.994 12.291 4.147 10.417 4.906 8.756C5.666 7.096 6.983 5.755 8.629 4.966C10.276 4.177 12.147 3.991 13.916 4.439', fill: false, opacity: 1, width: 1 },
    { d: 'M19.1 3.5L19.1 8.3L14.3 8.3', fill: false, opacity: 1, width: 1 },
  ],
  Sync: [
    { d: 'M4.2 9C6 1 18 1 19.8 9', fill: false, opacity: 1, width: 1 },
    { d: 'M19.8 4.2L19.8 9L15 9', fill: false, opacity: 1, width: 1 },
    { d: 'M19.8 15C18 23 6 23 4.2 15', fill: false, opacity: 1, width: 1 },
    { d: 'M4.2 19.8L4.2 15L9 15', fill: false, opacity: 1, width: 1 },
  ],
  Download: [
    { d: 'M3.5 16.8L3.5 18.9L5.5 20.7L20.5 20.7L20.5 16.8', fill: false, opacity: 1, width: 1 },
    { d: 'M12 3.2L12 14.5', fill: false, opacity: 1, width: 1 },
    { d: 'M7.5 10L12 14.5L16.5 10', fill: false, opacity: 1, width: 1 },
  ],
  CloudDownload: [
    { d: 'M6.4 17.3C-0.5 17.3 0.7 8.2 6.7 8.5C6.5 1.5 17.3 1.5 17.8 8.4C23.4 8.2 24 17.3 18 17.3', fill: false, opacity: 1, width: 1 },
    { d: 'M12 10.6L12 19.7', fill: false, opacity: 1, width: 1 },
    { d: 'M8.8 16.5L12 19.7L15.2 16.5', fill: false, opacity: 1, width: 1 },
  ],
  Upload: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8 11.8L12 7.8L16 11.8', fill: false, opacity: 1, width: 1 },
    { d: 'M12 7.8L12 17.2', fill: false, opacity: 1, width: 1 },
  ],
  Folder: [
    { d: 'M6 4.6L15.8 4.6L18.6 7.4L18.6 17.9L6 17.9Z', fill: true, opacity: 0.12, width: 1 },
    { d: 'M6 4.6L15.8 4.6L18.6 7.4L18.6 17.9L6 17.9Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15.8 4.6L15.8 7.4L18.6 7.4', fill: false, opacity: 0.7, width: 1 },
    { d: 'M3 8.4L8 8.4L10.4 10L21.5 10L19.7 20.2L4.4 20.2Z', fill: true, opacity: 0.11, width: 1 },
    { d: 'M3 8.4L8 8.4L10.4 10L21.5 10L19.7 20.2L4.4 20.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M6.2 16.7L7.7 16.7Q7.7 16.7 7.7 16.7L7.7 18.2Q7.7 18.2 7.7 18.2L6.2 18.2Q6.2 18.2 6.2 18.2L6.2 16.7Q6.2 16.7 6.2 16.7Z', fill: true, opacity: 1, width: 1 },
    { d: 'M9.2 17.4L12.5 17.4', fill: false, opacity: 1, width: 1 },
  ],
  FolderOpen: [
    { d: 'M6 4.6L15.8 4.6L18.6 7.4L18.6 17.9L6 17.9Z', fill: true, opacity: 0.12, width: 1 },
    { d: 'M6 4.6L15.8 4.6L18.6 7.4L18.6 17.9L6 17.9Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15.8 4.6L15.8 7.4L18.6 7.4', fill: false, opacity: 0.7, width: 1 },
    { d: 'M3 9.66L8 9.66L10.4 11.26L21.5 11.26L19.7 20.2L4.4 20.2Z', fill: true, opacity: 0.11, width: 1 },
    { d: 'M3 9.66L8 9.66L10.4 11.26L21.5 11.26L19.7 20.2L4.4 20.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M6.2 16.7L7.7 16.7Q7.7 16.7 7.7 16.7L7.7 18.2Q7.7 18.2 7.7 18.2L6.2 18.2Q6.2 18.2 6.2 18.2L6.2 16.7Q6.2 16.7 6.2 16.7Z', fill: true, opacity: 1, width: 1 },
    { d: 'M9.2 17.4L12.5 17.4', fill: false, opacity: 1, width: 1 },
  ],
  FolderAdd: [
    { d: 'M6 4.6L15.8 4.6L18.6 7.4L18.6 17.9L6 17.9Z', fill: true, opacity: 0.12, width: 1 },
    { d: 'M6 4.6L15.8 4.6L18.6 7.4L18.6 17.9L6 17.9Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15.8 4.6L15.8 7.4L18.6 7.4', fill: false, opacity: 0.7, width: 1 },
    { d: 'M3 8.4L8 8.4L10.4 10L21.5 10L19.7 20.2L4.4 20.2Z', fill: true, opacity: 0.11, width: 1 },
    { d: 'M3 8.4L8 8.4L10.4 10L21.5 10L19.7 20.2L4.4 20.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M10 15.4L15 15.4', fill: false, opacity: 1, width: 1 },
    { d: 'M12.5 12.9L12.5 17.9', fill: false, opacity: 1, width: 1 },
  ],
  Document: [
    { d: 'M5 3L15 3L19 7L19 21L5 21Z', fill: true, opacity: 0.11, width: 1 },
    { d: 'M5 3L15 3L19 7L19 21L5 21Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15 3L15 7L19 7', fill: false, opacity: 0.7, width: 1 },
    { d: 'M8.2 11.2L15.8 11.2', fill: false, opacity: 1, width: 1 },
    { d: 'M8.2 14.7L15.8 14.7', fill: false, opacity: 1, width: 1 },
    { d: 'M8.2 18.2L12.5 18.2', fill: false, opacity: 1, width: 1 },
  ],
  Wand: [
    { d: 'M3.8 19.5L13.4 9.9L15.5 12L5.9 21.6Z', fill: true, opacity: 0.17, width: 1 },
    { d: 'M3.8 19.5L13.4 9.9L15.5 12L5.9 21.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M17.4 3.3Q17.775 5.425 19.9 5.8Q17.775 6.175 17.4 8.3Q17.025 6.175 14.9 5.8Q17.025 5.425 17.4 3.3Z', fill: false, opacity: 1, width: 1 },
    { d: 'M5.5 5.3Q5.725 6.575 7 6.8Q5.725 7.025 5.5 8.3Q5.275 7.025 4 6.8Q5.275 6.575 5.5 5.3Z', fill: false, opacity: 1, width: 1 },
    { d: 'M19.9 15.051L20.749 15.9Q20.749 15.9 20.749 15.9L19.9 16.749Q19.9 16.749 19.9 16.749L19.051 15.9Q19.051 15.9 19.051 15.9L19.9 15.051Q19.9 15.051 19.9 15.051Z', fill: true, opacity: 1, width: 1 },
  ],
  Settings: [
    { d: 'M12 4.9L13.545 3.235L15.044 3.637L16.45 4.292L17.721 5.182L17.439 7.436L18.149 8.45L20.363 8.956L20.765 10.455L20.9 12L20.765 13.545L18.672 14.428L18.149 15.55L18.818 17.721L17.721 18.818L16.45 19.708L15.044 20.363L13.233 18.992L12 19.1L10.455 20.765L8.956 20.363L7.55 19.708L6.279 18.818L6.561 16.564L5.851 15.55L3.637 15.044L3.235 13.545L3.1 12L3.235 10.455L5.328 9.572L5.851 8.45L5.182 6.279L6.279 5.182L7.55 4.292L8.956 3.637L10.767 5.008Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15.3 12C15.3 13.823 13.823 15.3 12 15.3C10.177 15.3 8.7 13.823 8.7 12C8.7 10.177 10.177 8.7 12 8.7C13.823 8.7 15.3 10.177 15.3 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M9.7 9.7L12 8.7L12 15.3L9.7 14.3Z', fill: true, opacity: 0.25, width: 1 },
  ],
  Info: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M11.3 6.9L12.7 6.9Q12.7 6.9 12.7 6.9L12.7 8.3Q12.7 8.3 12.7 8.3L11.3 8.3Q11.3 8.3 11.3 8.3L11.3 6.9Q11.3 6.9 11.3 6.9Z', fill: true, opacity: 1, width: 1 },
    { d: 'M10.8 11L12.2 11L12.2 17L14 17', fill: false, opacity: 1, width: 1 },
  ],
  Help: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M9.1 8.2C9.1 4.6 16 4.6 15.1 9.3C14.8 10.8 12 11.1 12 13.8', fill: false, opacity: 1, width: 1 },
    { d: 'M11.3 17L12.7 17Q12.7 17 12.7 17L12.7 18.4Q12.7 18.4 12.7 18.4L11.3 18.4Q11.3 18.4 11.3 18.4L11.3 17Q11.3 17 11.3 17Z', fill: true, opacity: 1, width: 1 },
  ],
  Warning: [
    { d: 'M12 3.2L21.9 20.5L4.2 20.5L2.2 18.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12 8.4L12 13.4', fill: false, opacity: 1, width: 1.15 },
    { d: 'M11.2 16.6L12.8 16.6Q12.8 16.6 12.8 16.6L12.8 18.2Q12.8 18.2 12.8 18.2L11.2 18.2Q11.2 18.2 11.2 18.2L11.2 16.6Q11.2 16.6 11.2 16.6Z', fill: true, opacity: 1, width: 1 },
  ],
  Wifi: [
    { d: 'M3.1 8Q12 1.6 20.9 8', fill: false, opacity: 1, width: 1 },
    { d: 'M6.1 11.8Q12 7.5 17.9 11.8', fill: false, opacity: 1, width: 1 },
    { d: 'M9.1 15.6Q12 13.4 14.9 15.6', fill: false, opacity: 1, width: 1 },
    { d: 'M12 18.148L13.202 19.35Q13.202 19.35 13.202 19.35L12 20.552Q12 20.552 12 20.552L10.798 19.35Q10.798 19.35 10.798 19.35L12 18.148Q12 18.148 12 18.148Z', fill: true, opacity: 1, width: 1 },
  ],
  WifiOff: [
    { d: 'M3.1 8Q12 1.6 20.9 8', fill: false, opacity: 1, width: 1 },
    { d: 'M6.1 11.8Q12 7.5 17.9 11.8', fill: false, opacity: 1, width: 1 },
    { d: 'M9.1 15.6Q12 13.4 14.9 15.6', fill: false, opacity: 1, width: 1 },
    { d: 'M12 18.148L13.202 19.35Q13.202 19.35 13.202 19.35L12 20.552Q12 20.552 12 20.552L10.798 19.35Q10.798 19.35 10.798 19.35L12 18.148Q12 18.148 12 18.148Z', fill: true, opacity: 1, width: 1 },
    { d: 'M3.2 3.5L20.8 21.1', fill: false, opacity: 1, width: 1 },
  ],
  Cloud: [
    { d: 'M6.4 18.6C-0.3 18.6 0.5 8 6.8 8.6C7 1.7 18.2 1.7 18.2 9.4C24 10.6 22.6 18.6 18 18.6Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14.4 18.6L17 15.9L17 18.6Z', fill: true, opacity: 0.23, width: 1 },
  ],
  Globe: [
    { d: 'M19.451 8.121C20.39 9.925 20.643 12.009 20.162 13.986C19.681 15.962 18.499 17.697 16.836 18.868C15.173 20.039 13.141 20.567 11.119 20.354C9.096 20.14 7.219 19.2 5.837 17.708C4.455 16.215 3.661 14.272 3.603 12.238C3.546 10.205 4.228 8.22 5.523 6.652C6.818 5.083 8.638 4.038 10.646 3.71C12.653 3.382 14.712 3.794 16.439 4.868', fill: false, opacity: 1, width: 1 },
    { d: 'M17.65 4.189L18.711 5.25Q18.711 5.25 18.711 5.25L17.65 6.311Q17.65 6.311 17.65 6.311L16.589 5.25Q16.589 5.25 16.589 5.25L17.65 4.189Q17.65 4.189 17.65 4.189Z', fill: true, opacity: 1, width: 1 },
    { d: 'M15.9 12C15.9 16.639 14.154 20.4 12 20.4C9.846 20.4 8.1 16.639 8.1 12C8.1 7.361 9.846 3.6 12 3.6C14.154 3.6 15.9 7.361 15.9 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M3.6 12L20.4 12', fill: false, opacity: 1, width: 1 },
    { d: 'M5.6 6.6Q12 10.3 18.4 6.6', fill: false, opacity: 1, width: 1 },
    { d: 'M5.6 17.4Q12 13.7 18.4 17.4', fill: false, opacity: 1, width: 1 },
  ],
  Phone: [
    { d: 'M6.6 2.8L14.9 2.8L17.4 5.3L17.4 21.2L6.6 21.2Z', fill: true, opacity: 0.07, width: 1 },
    { d: 'M6.6 2.8L14.9 2.8L17.4 5.3L17.4 21.2L6.6 21.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14.9 2.8L14.9 5.3L17.4 5.3', fill: false, opacity: 0.7, width: 1 },
    { d: 'M10 5.5L13.7 5.5', fill: false, opacity: 1, width: 1 },
    { d: 'M10.4 18.5L13.6 18.5', fill: false, opacity: 1, width: 1 },
  ],
  Laptop: [
    { d: 'M4.5 4.2L16.9 4.2L19.5 6.8L19.5 16.4L4.5 16.4Z', fill: true, opacity: 0.08, width: 1 },
    { d: 'M4.5 4.2L16.9 4.2L19.5 6.8L19.5 16.4L4.5 16.4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M16.9 4.2L16.9 6.8L19.5 6.8', fill: false, opacity: 0.7, width: 1 },
    { d: 'M4.5 16.4L2.3 20.2L21.7 20.2L19.5 16.4', fill: false, opacity: 1, width: 1 },
    { d: 'M10 18.2L14 18.2', fill: false, opacity: 1, width: 1 },
  ],
  Branch: [
    { d: 'M7 6.5L7 17.5', fill: false, opacity: 1, width: 1 },
    { d: 'M7 14C7 10 17 13 17 6.5', fill: false, opacity: 1, width: 1 },
    { d: 'M5.2 2.8L7.8 2.8L8.8 3.8L8.8 6.4L5.2 6.4Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M5.2 2.8L7.8 2.8L8.8 3.8L8.8 6.4L5.2 6.4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M7.8 2.8L7.8 3.8L8.8 3.8', fill: false, opacity: 0.7, width: 1 },
    { d: 'M15.2 2.8L17.8 2.8L18.8 3.8L18.8 6.4L15.2 6.4Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M15.2 2.8L17.8 2.8L18.8 3.8L18.8 6.4L15.2 6.4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M17.8 2.8L17.8 3.8L18.8 3.8', fill: false, opacity: 0.7, width: 1 },
    { d: 'M5.2 17.6L7.8 17.6L8.8 18.6L8.8 21.2L5.2 21.2Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M5.2 17.6L7.8 17.6L8.8 18.6L8.8 21.2L5.2 21.2Z', fill: false, opacity: 1, width: 1 },
    { d: 'M7.8 17.6L7.8 18.6L8.8 18.6', fill: false, opacity: 0.7, width: 1 },
  ],
  PersonAdd: [
    { d: 'M12.3 7C12.3 8.712 10.912 10.1 9.2 10.1C7.488 10.1 6.1 8.712 6.1 7C6.1 5.288 7.488 3.9 9.2 3.9C10.912 3.9 12.3 5.288 12.3 7Z', fill: false, opacity: 1, width: 1 },
    { d: 'M3.3 20L3.3 18C3.3 12 15.1 12 15.1 18L15.1 20', fill: false, opacity: 1, width: 1 },
    { d: 'M19 7.2L19 12.8', fill: false, opacity: 1, width: 1 },
    { d: 'M16.2 10L21.8 10', fill: false, opacity: 1, width: 1 },
  ],
  Eye: [
    { d: 'M2.7 12C7 4 17 4 21.3 12C17 20 7 20 2.7 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14.9 12C14.9 13.602 13.602 14.9 12 14.9C10.398 14.9 9.1 13.602 9.1 12C9.1 10.398 10.398 9.1 12 9.1C13.602 9.1 14.9 10.398 14.9 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12.9 12C12.9 12.497 12.497 12.9 12 12.9C11.503 12.9 11.1 12.497 11.1 12C11.1 11.503 11.503 11.1 12 11.1C12.497 11.1 12.9 11.503 12.9 12Z', fill: true, opacity: 1, width: 1 },
  ],
  EyeOff: [
    { d: 'M2.7 12C7 4 17 4 21.3 12C17 20 7 20 2.7 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M14.9 12C14.9 13.602 13.602 14.9 12 14.9C10.398 14.9 9.1 13.602 9.1 12C9.1 10.398 10.398 9.1 12 9.1C13.602 9.1 14.9 10.398 14.9 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M12.9 12C12.9 12.497 12.497 12.9 12 12.9C11.503 12.9 11.1 12.497 11.1 12C11.1 11.503 11.503 11.1 12 11.1C12.497 11.1 12.9 11.503 12.9 12Z', fill: true, opacity: 1, width: 1 },
    { d: 'M4 4L20 20', fill: false, opacity: 1, width: 1 },
  ],
  Battery: [
    { d: 'M2.8 7L17.6 7L19.3 8.7L19.3 17L2.8 17Z', fill: false, opacity: 1, width: 1 },
    { d: 'M17.6 7L17.6 8.7L19.3 8.7', fill: false, opacity: 0.7, width: 1 },
    { d: 'M21.8 10L21.8 14', fill: false, opacity: 1, width: 1 },
    { d: 'M5.4 9.4L16.7 9.4Q16.9 9.4 16.9 9.6L16.9 14.4Q16.9 14.6 16.7 14.6L5.4 14.6Q5.2 14.6 5.2 14.4L5.2 9.6Q5.2 9.4 5.4 9.4Z', fill: true, opacity: 1, width: 1 },
  ],
  Charging: [
    { d: 'M13.1 2.7L5.3 12.8L11.2 12.8L10.6 21.3L18.7 10.2L12.8 10.2Z', fill: true, opacity: 1, width: 1 },
  ],
  Tools: [
    { d: 'M13 5.1C14.1 2.5 16.8 2 19 3L15.5 6.5L17.5 8.5L21 5C23.1 10 18.7 13.1 15.3 11.8L7.1 20C4.2 22.9 1.1 19.8 4 16.9L12.3 8.6Q11.5 7 13 5.1', fill: false, opacity: 1, width: 1 },
  ],
  Shield: [
    { d: 'M12 2.9L19.7 5.5L18.7 14Q17.5 18.6 12 21.2Q6.5 18.6 5.3 14L4.3 5.5Z', fill: false, opacity: 1, width: 1 },
    { d: 'M8 11.7L10.8 14.4L16 9.2', fill: false, opacity: 1, width: 1 },
  ],
  Stop: [
    { d: 'M5.3 5.3L15.7 5.3L18.7 8.3L18.7 18.7L5.3 18.7Z', fill: true, opacity: 1, width: 1 },
  ],
  Previous: [
    { d: 'M19.2 18.4L19.2 5.6L9.4 12Z', fill: true, opacity: 0.17, width: 1 },
    { d: 'M19.2 18.4L19.2 5.6L9.4 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M4.5 19L4.5 5', fill: false, opacity: 1, width: 1 },
  ],
  Next: [
    { d: 'M4.8 5.6L4.8 18.4L14.6 12Z', fill: true, opacity: 0.17, width: 1 },
    { d: 'M4.8 5.6L4.8 18.4L14.6 12Z', fill: false, opacity: 1, width: 1 },
    { d: 'M19.5 5L19.5 19', fill: false, opacity: 1, width: 1 },
  ],
  Volume: [
    { d: 'M3.2 9.3L7 9.3L12 4.8L12 19.2L7 14.7L3.2 14.7Z', fill: true, opacity: 0.13, width: 1 },
    { d: 'M3.2 9.3L7 9.3L12 4.8L12 19.2L7 14.7L3.2 14.7Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15.4 8.6Q20.2 12 15.4 15.4', fill: false, opacity: 1, width: 1 },
    { d: 'M18.2 5.6Q24.4 12 18.2 18.4', fill: false, opacity: 1, width: 1 },
  ],
  Speed: [
    { d: 'M4.516 17.014C3.642 15.299 3.383 13.336 3.784 11.454C4.184 9.571 5.218 7.883 6.714 6.672C8.209 5.461 10.075 4.8 12 4.8C13.925 4.8 15.791 5.461 17.286 6.672C18.782 7.883 19.816 9.571 20.216 11.454C20.617 13.336 20.358 15.299 19.484 17.014', fill: false, opacity: 1, width: 1 },
    { d: 'M10.9 13L15.7 6.9L13 14.4Z', fill: true, opacity: 1, width: 1 },
    { d: 'M11.1 12.3L12.9 12.3Q12.9 12.3 12.9 12.3L12.9 14.1Q12.9 14.1 12.9 14.1L11.1 14.1Q11.1 14.1 11.1 14.1L11.1 12.3Q11.1 12.3 11.1 12.3Z', fill: true, opacity: 1, width: 1 },
    { d: 'M8 20.6L16 20.6', fill: false, opacity: 1, width: 1 },
    { d: 'M6 7.9L7.1 9', fill: false, opacity: 1, width: 1 },
    { d: 'M12 4.8L12 6.1', fill: false, opacity: 1, width: 1 },
    { d: 'M18 7.9L16.9 9', fill: false, opacity: 1, width: 1 },
  ],
  Discover: [
    { d: 'M3.6 3.1L16.8 3.1L20.4 6.7L20.4 20.9L3.6 20.9Z', fill: true, opacity: 0.09, width: 1 },
    { d: 'M3.6 3.1L16.8 3.1L20.4 6.7L20.4 20.9L3.6 20.9Z', fill: false, opacity: 1, width: 1 },
    { d: 'M16.8 3.1L16.8 6.7L20.4 6.7', fill: false, opacity: 0.7, width: 1 },
    { d: 'M15.9 7.8L13.6 13.6L7.5 16.7L10.5 10.5Z', fill: false, opacity: 1, width: 1 },
    { d: 'M15.9 7.8L13.6 13.6L10.5 10.5Z', fill: true, opacity: 0.65, width: 1 },
    { d: 'M6.6 17.8L7.75 17.8Q7.75 17.8 7.75 17.8L7.75 18.95Q7.75 18.95 7.75 18.95L6.6 18.95Q6.6 18.95 6.6 18.95L6.6 17.8Q6.6 17.8 6.6 17.8Z', fill: true, opacity: 1, width: 1 },
  ],
  Location: [
    { d: 'M3.4 9.8L20.4 3.6L14.2 20.6L10.6 13.4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M10.6 13.4L20.4 3.6L14.2 20.6Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M10.6 13.4L20.4 3.6', fill: false, opacity: 1, width: 1 },
  ],
  LocationFilled: [
    { d: 'M3.4 9.8L20.4 3.6L14.2 20.6L10.6 13.4Z', fill: false, opacity: 1, width: 1 },
    { d: 'M10.6 13.4L20.4 3.6L14.2 20.6Z', fill: true, opacity: 0.35, width: 1 },
    { d: 'M10.6 13.4L20.4 3.6', fill: false, opacity: 1, width: 1 },
  ],
  Waveform: [
    { d: 'M4 8.8L4 15.2', fill: false, opacity: 1, width: 1 },
    { d: 'M8 6.2L8 17.8', fill: false, opacity: 1, width: 1 },
    { d: 'M12 3.5L12 20.5', fill: false, opacity: 1, width: 1.3 },
    { d: 'M16 6.2L16 17.8', fill: false, opacity: 1, width: 1 },
    { d: 'M20 8.8L20 15.2', fill: false, opacity: 1, width: 1 },
  ],
  Voice: [
    { d: 'M9 3.1L13 3.1L15 5.1L15 14.1L9 14.1Z', fill: true, opacity: 0.15, width: 1 },
    { d: 'M9 3.1L13 3.1L15 5.1L15 14.1L9 14.1Z', fill: false, opacity: 1, width: 1 },
    { d: 'M13 3.1L13 5.1L15 5.1', fill: false, opacity: 0.7, width: 1 },
    { d: 'M5.7 10.5L5.7 12C5.7 20 18.3 20 18.3 12L18.3 10.5', fill: false, opacity: 1, width: 1 },
    { d: 'M12 18L12 21.2', fill: false, opacity: 1, width: 1 },
    { d: 'M9 21.2L15 21.2', fill: false, opacity: 1, width: 1 },
    { d: 'M11.2 6.2L12.8 6.2', fill: false, opacity: 1, width: 1 },
  ],
};

/** 归一化姿态：`WenkuIconPose`（L136-144）。 */
export interface WenkuIconPose {
  readonly symbol: WenkuSymbol;
  readonly variant: number;
  readonly active: number;
}

/** `WenkuIconPoses.of`（L202-222）：变体折叠成族符号 + 变体角。 */
export function wenkuIconPosesOf(symbol: WenkuSymbol, active = false): WenkuIconPose {
  const halfPi = Math.PI / 2;
  switch (symbol) {
    case 'Pause':
      return { symbol: 'Play', variant: 1, active: active ? 1 : 0 };
    case 'Back':
      return { symbol: 'Forward', variant: Math.PI, active: active ? 1 : 0 };
    case 'Up':
      return { symbol: 'Forward', variant: -halfPi, active: active ? 1 : 0 };
    case 'Down':
      return { symbol: 'Forward', variant: halfPi, active: active ? 1 : 0 };
    case 'ArrowLeft':
      return { symbol: 'ArrowRight', variant: Math.PI, active: active ? 1 : 0 };
    case 'ArrowUp':
      return { symbol: 'ArrowRight', variant: -halfPi, active: active ? 1 : 0 };
    case 'ArrowDown':
      return { symbol: 'ArrowRight', variant: halfPi, active: active ? 1 : 0 };
    case 'External':
      return { symbol: 'ArrowRight', variant: -Math.PI / 4, active: active ? 1 : 0 };
    case 'Bookmarked':
      return { symbol: 'Bookmark', variant: 1, active: active ? 1 : 0 };
    case 'EyeOff':
      return { symbol: 'Eye', variant: 1, active: active ? 1 : 0 };
    case 'CheckCircle':
      return { symbol: 'Circle', variant: 1, active: active ? 1 : 0 };
    case 'Selected':
      return { symbol: 'Circle', variant: 2, active: active ? 1 : 0 };
    case 'LocationFilled':
      return { symbol: 'Location', variant: 1, active: active ? 1 : 0 };
    default:
      return { symbol, variant: 0, active: active ? 1 : 0 };
  }
}

/** 该符号是否有烘焙几何（13 个变体符号自身没有，必须先经 `wenkuIconPosesOf` 折叠）。 */
export function wenkuIconHasArt(symbol: WenkuSymbol): boolean {
  return (WENKU_ICON_ART[wenkuIconPosesOf(symbol).symbol]?.length ?? 0) > 0;
}

/**
 * `WenkuIconMapping.kt` L32-119：Material `ImageVector.name` → `WenkuSymbol`。
 * Material 的 name 在不同 family 下是 `Filled.X` / `Outlined.X` / `AutoMirrored.Filled.X`，
 * 只比较最后一段。
 */
export function wenkuSymbolForIconName(name: string): WenkuSymbol | null {
  const leaf = name.split('.').pop()?.split('/').pop() ?? name;
  switch (leaf) {
    // 导航
    case 'ArrowBack':
    case 'ArrowBackIos':
    case 'KeyboardArrowLeft':
    case 'ChevronLeft':
    case 'NavigateBefore':
      return 'Back';
    case 'ArrowForward':
    case 'ArrowForwardIos':
    case 'KeyboardArrowRight':
    case 'ChevronRight':
    case 'NavigateNext':
      return 'Forward';
    case 'ArrowUpward':
      return 'ArrowUp';
    case 'KeyboardArrowUp':
    case 'ExpandLess':
      return 'Up';
    case 'ArrowDownward':
      return 'ArrowDown';
    case 'KeyboardArrowDown':
    case 'ExpandMore':
      return 'Down';
    case 'Close':
    case 'Cancel':
    case 'Clear':
      return 'Close';
    case 'Menu':
    case 'List':
    case 'Subject':
    case 'FormatListBulleted':
    case 'Toc':
      return 'Contents';
    case 'MoreVert':
    case 'MoreHoriz':
    case 'More':
      return 'More';
    case 'OpenInNew':
    case 'Launch':
    case 'ExternalLink':
      return 'External';

    // 阅读
    case 'Bookmark':
    case 'BookmarkBorder':
    case 'BookmarkOutline':
    case 'BookmarkAdded':
      return 'Bookmark';
    case 'Headphones':
    case 'Headset':
      return 'Headphones';
    case 'VolumeUp':
    case 'VolumeOff':
    case 'VolumeMute':
    case 'VolumeDown':
      return 'Volume';
    case 'PlayArrow':
    case 'PlayCircle':
      return 'Play';
    case 'Pause':
    case 'PauseCircle':
      return 'Pause';
    case 'Stop':
    case 'StopCircle':
      return 'Stop';
    case 'SkipPrevious':
    case 'FastRewind':
      return 'Previous';
    case 'SkipNext':
    case 'FastForward':
      return 'Next';
    case 'Timer':
    case 'Alarm':
    case 'Schedule':
    case 'AccessTime':
    case 'History':
      return 'Timer';
    case 'Speed':
      return 'Speed';
    case 'TextFields':
    case 'TextFormat':
    case 'FontDownload':
      return 'Typography';
    case 'Tune':
    case 'Sliders':
      return 'Sliders';
    case 'Image':
    case 'Photo':
    case 'InsertPhoto':
      return 'Image';
    case 'Brightness':
    case 'BrightnessHigh':
    case 'LightMode':
    case 'WbSunny':
      return 'Brightness';
    case 'DarkMode':
    case 'Nightlight':
    case 'Bedtime':
      return 'Moon';
    case 'Layers':
      return 'Layers';
    case 'FormatQuote':
    case 'FormatQuoteOutlined':
      return 'Quotes';
    case 'Translate':
    case 'Language':
      return 'Language';
    case 'Portrait':
    case 'CropPortrait':
      return 'Portrait';

    // 操作
    case 'Search':
      return 'Search';
    case 'FilterAlt':
    case 'FilterList':
    case 'Sort':
    case 'Filter':
      return 'Filter';
    case 'GridView':
    case 'ViewModule':
    case 'Dashboard':
      return 'Grid';
    case 'Apps':
    case 'Widgets':
      return 'DotsGrid';
    case 'Add':
      return 'Add';
    case 'AddCircle':
    case 'AddCircleOutline':
      return 'AddCircle';
    case 'Remove':
    case 'RemoveCircle':
    case 'RemoveCircleOutline':
    case 'Delete':
      return 'Delete';
    case 'Check':
    case 'Done':
      return 'Check';
    case 'CheckCircle':
    case 'TaskAlt':
      return 'CheckCircle';
    case 'Edit':
    case 'Create':
    case 'DriveFileRenameOutline':
      return 'Edit';
    case 'ContentCopy':
    case 'Copy':
      return 'Copy';
    case 'Share':
      return 'Share';
    case 'Link':
      return 'Link';
    case 'Refresh':
      return 'Refresh';
    case 'Sync':
    case 'SyncAlt':
      return 'Sync';

    // 文件
    case 'Download':
    case 'FileDownload':
    case 'CloudDownload':
      return 'Download';
    case 'Upload':
    case 'FileUpload':
    case 'CloudUpload':
      return 'Upload';
    case 'Folder':
    case 'FolderOutlined':
    case 'Storage':
      return 'Folder';
    case 'FolderOpen':
      return 'FolderOpen';
    case 'CreateNewFolder':
    case 'FolderAdd':
      return 'FolderAdd';
    case 'Description':
    case 'Article':
    case 'InsertDriveFile':
    case 'Document':
      return 'Document';
    case 'AutoFixHigh':
    case 'AutoFixNormal':
    case 'Wand':
      return 'Wand';

    // 系统
    case 'Settings':
      return 'Settings';
    case 'Info':
    case 'InfoOutline':
      return 'Info';
    case 'Warning':
    case 'ErrorOutline':
    case 'ReportProblem':
      return 'Warning';
    case 'Wifi':
      return 'Wifi';
    case 'WifiOff':
      return 'WifiOff';
    case 'Cloud':
      return 'Cloud';
    case 'Public':
    case 'Globe':
      return 'Globe';
    case 'Phone':
    case 'Smartphone':
      return 'Phone';
    case 'Computer':
    case 'Laptop':
      return 'Laptop';
    case 'AccountTree':
    case 'CallSplit':
      return 'Branch';
    case 'PersonAdd':
      return 'PersonAdd';
    case 'Visibility':
      return 'Eye';
    case 'VisibilityOff':
      return 'EyeOff';
    case 'CloseCircle':
      return 'CloseCircle';
    case 'BatteryFull':
    case 'BatteryStd':
      return 'Battery';
    case 'Build':
    case 'Construction':
    case 'Handyman':
      return 'Tools';
    case 'Shield':
    case 'Security':
    case 'Lock':
      return 'Shield';
    case 'Help':
    case 'HelpOutline':
    case 'QuestionMark':
      return 'Help';
    case 'TouchApp':
    case 'PanTool':
      return 'Touch';
    case 'Person':
    case 'AccountCircle':
      return 'Profile';
    case 'Book':
    case 'MenuBook':
    case 'AutoStories':
      return 'Book';
    default:
      return null;
  }
}

/** 线宽：`contrast ? 2.05 : (sizeDp < 18 ? 1.9 : 1.72)`（L116-120）。 */
export function wenkuIconStrokeWidth(sizeDp: number, contrast = false): number {
  if (contrast) return 2.05;
  return sizeDp < 18 ? 1.9 : 1.72;
}

export interface WenkuIconProps {
  readonly symbol: WenkuSymbol;
  /** 光学尺寸（dp → CSS px），默认 `21`（Kotlin `size: Dp = 21.dp`）。 */
  readonly size?: number;
  /** 描边色；默认 `currentColor`（等价 `LocalContentColor`，可被 CSS 变量驱动）。 */
  readonly tint?: string;
  /** 选中量：只切换姿态几何（不播 morph 时钟）。 */
  readonly active?: boolean;
  /** 高对比：线宽 2.05（`a11y.highContrast`）。 */
  readonly contrast?: boolean;
  /** RTL 下水平镜像 `Back` / `Forward`（Kotlin L303-304）。 */
  readonly rtl?: boolean;
  /** 语义标题：给了就变成有名字的图形，否则当装饰（`aria-hidden`）。 */
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 24×24 网格上的手绘矢量图标。与 Kotlin 的差别只有一处：静止姿态直接出图，
 * 不做 640ms 手势时钟 / 380ms morph / 入场级联（见文件头"未移植"）。
 */
export function WenkuIcon(props: WenkuIconProps): ReactElement {
  const { symbol, size = 21, tint = 'currentColor', active = false, contrast = false } = props;
  const rtl = props.rtl === true;
  const pose = wenkuIconPosesOf(symbol, active);
  const strokes = WENKU_ICON_ART[pose.symbol] ?? [];
  const width = wenkuIconStrokeWidth(size, contrast);
  const mirrored = rtl && (symbol === 'Back' || symbol === 'Forward');
  const title = props.title;
  const style: CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    color: tint,
    display: 'block',
    flex: '0 0 auto',
    ...(mirrored ? { transform: 'scaleX(-1)' } : null),
    ...props.style,
  };
  const className = props.className === undefined ? 'wenku-icon' : `wenku-icon ${props.className}`;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      style={style}
      data-wenku-symbol={symbol}
      data-wenku-family={pose.symbol}
      data-testid={props.testId}
      {...(title === undefined
        ? { 'aria-hidden': true as const, focusable: 'false' as const }
        : { role: 'img', 'aria-label': title, focusable: 'false' as const })}
    >
      {title === undefined ? null : <title>{title}</title>}
      {strokes.map((stroke, index) =>
        stroke.fill ? (
          <path
            key={index}
            d={stroke.d}
            fill="currentColor"
            fillOpacity={stroke.opacity}
            stroke="none"
          />
        ) : (
          <path
            key={index}
            d={stroke.d}
            fill="none"
            stroke="currentColor"
            strokeOpacity={stroke.opacity}
            strokeWidth={width * stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

/**
 * `WenkuButtonGlyph`（WenkuIconMapping.kt L127-163）：命中映射就走手绘图标，
 * 未命中返回 null 由调用方回退到 Material 图标。
 */
export function WenkuButtonGlyph(props: {
  readonly iconName: string;
  readonly size?: number;
  readonly tint?: string;
  readonly active?: boolean;
  readonly title?: string;
  readonly className?: string;
}): ReactElement | null {
  const symbol = wenkuSymbolForIconName(props.iconName);
  if (symbol === null) return null;
  const glyph: WenkuIconProps = {
    symbol,
    size: props.size ?? 21,
    tint: props.tint ?? 'currentColor',
    active: props.active === true,
    ...(props.title !== undefined ? { title: props.title } : null),
    ...(props.className !== undefined ? { className: props.className } : null),
  };
  return <WenkuIcon {...glyph} />;
}
