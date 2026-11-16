/**
 * ComicIcon.tsx — 面板内 Material 图标的极简线描替身。
 *
 * Kotlin 来源：整个 `ComicReaderSheets.kt` / `ComicPanelDesign.kt` 使用
 * `androidx.compose.material.icons` 的 ImageVector（Tint 由调用处指定）。
 * Web 端无该图标字体，故按图标名提供同尺寸（24×24 viewBox）的 SVG 线描字形，
 * 颜色由 CSS `currentColor` 决定，对应 Kotlin 的 `tint`。
 *
 * 逐行跳过说明：
 *   - Kotlin `Icons.Filled.*` / `Icons.AutoMirrored.Filled.*` / `Icons.Outlined.*`
 *     的矢量路径数据（位于 Google Material Icons 资产，非本仓库源码）：无法逐字节
 *     搬运，改为同名近似线描字形；图标**名称**、尺寸、tint 语义保持原样。
 *   - `Icons.AutoMirrored.Filled.MenuBook` / `ArrowBack` 的 RTL 自动镜像：
 *     替身统一按 LTR 绘制（中文阅读器场景下 RTL 影响不可见）。
 */
import type { CSSProperties } from 'react';

/** Material 图标名 → SVG 子元素。缺失图标回退为一个中性圆点（保持 24×24 占位）。 */
const GLYPHS: Readonly<Record<string, string>> = {
  // 面板 Tab / 分区标题
  MenuBook: '<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10v15H4.5A1.5 1.5 0 0 0 3 20.5zM11 4h5.5A1.5 1.5 0 0 1 18 5.5v15a1.5 1.5 0 0 0-1.5-1.5H11z"/>',
  Visibility:
    '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  Image:
    '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l4.5-5 3.5 4 3-3L20 17"/>',
  Translate: '<path d="M4 6h9M8.5 6v1.6c0 3-1.9 5.6-4.5 6.6"/><path d="M6 10.5c1.3 2.2 3.4 3.6 6 4.2"/><path d="M13 20l3.6-8 3.6 8M14.4 17h4.6"/>',
  Palette:
    '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.8-1.8 0-1.5-1.3-1.9-1.3-3 0-.9.7-1.6 1.7-1.6h1.6a4.7 4.7 0 0 0 4.7-4.7c0-3.3-3.7-5.9-8.5-5.9z"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.6" r="1.1"/><circle cx="15.8" cy="9.4" r="1.1"/>',
  Schedule: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3 1.8"/>',
  PanTool: '<path d="M9 11V5.6a1.4 1.4 0 0 1 2.8 0V11m0-.6V4.8a1.4 1.4 0 0 1 2.8 0v5.6m0-.4V6.4a1.4 1.4 0 0 1 2.8 0V14c0 3.6-2.2 6.4-5.6 6.4-2.5 0-4-1-5.3-2.9L5 14.2c-.5-.9 1-2 1.8-1.2L9 15z"/>',

  // 分区
  AutoStories:
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M13 4h5.5A1.5 1.5 0 0 1 20 5.5v15a1.5 1.5 0 0 0-1.5-1.5H13z"/>',
  SwapHoriz: '<path d="M4 8.5h13M14 5l3.5 3.5L14 12"/><path d="M20 15.5H7M10 12l-3.5 3.5L10 19"/>',
  Animation: '<path d="M4 12a8 8 0 0 1 16 0"/><path d="M4 12l3-2.4M4 12l3 2.4"/><path d="M20 12l-3-2.4M20 12l-3 2.4"/><path d="M12 4v3"/>',
  SwipeVertical:
    '<path d="M12 3.5v17"/><path d="M8.6 7.4L12 4l3.4 3.4"/><path d="M8.6 16.6L12 20l3.4-3.4"/>',
  AspectRatio: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M8 15v-4H4"/>',
  Height: '<path d="M8 4h8M8 20h8"/><path d="M12 4v16"/><path d="M9.5 7L12 4l2.5 3M9.5 17L12 20l2.5-3"/>',
  Bookmark: '<path d="M6.5 4.5h11v15L12 15.8l-5.5 3.7z"/>',
  ZoomIn:
    '<circle cx="10.8" cy="10.8" r="6.2"/><path d="M15.4 15.4L20 20"/><path d="M8.4 10.8h4.8M10.8 8.4v4.8"/>',
  Crop: '<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>',
  VerticalSplit:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/>',
  RotateRight:
    '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.4"/>',
  AutoAwesome: '<path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M18 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
  Tune: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2.2"/><circle cx="10" cy="16" r="2.2"/>',
  FormatSize: '<path d="M3.5 18V8h4M3.5 12.5h4.5"/><path d="M14 18v-6.5h3M14 14.5h3.8"/><path d="M20 18v-4h1.5"/>',
  CleaningServices:
    '<path d="M9 4.5h6l-.8 4.5H9.8z"/><path d="M6.5 9h11v6.5a5.5 5.5 0 0 1-11 0z"/><path d="M6.5 12.5h11M12 9v12"/>',
  CloudDownload: '<path d="M7.5 18.5h9.8a3.7 3.7 0 0 0 .5-7.4A5.5 5.5 0 0 0 7.3 9.6 4.5 4.5 0 0 0 7.5 18.5z"/><path d="M12 10.5v5.5M9.6 13.6L12 16l2.4-2.4"/>',
  Cloud: '<path d="M7.5 18.5h9.8a3.7 3.7 0 0 0 .5-7.4A5.5 5.5 0 0 0 7.3 9.6 4.5 4.5 0 0 0 7.5 18.5z"/>',
  Download: '<path d="M12 4v10.5M8 11l4 4 4-4"/><path d="M4.5 19.5h15"/>',
  Delete: '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5l1 13h9l1-13"/><path d="M10 10v6M14 10v6"/>',
  Tune2: '<path d="M4 12h16"/>',
  MusicNote: '<circle cx="7.5" cy="17.5" r="2.8"/><circle cx="17" cy="15" r="2.8"/><path d="M10.3 17.5V6.5l9.5-2.2V15"/>',
  ArrowBack: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  Public:
    '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.2 2.3 3.4 5.1 3.4 8.2S14.2 17.9 12 20.2c-2.2-2.3-3.4-5.1-3.4-8.2S9.8 6.1 12 3.8z"/>',
  Bolt: '<path d="M13.2 3.5L5.8 13.2h4.4l-.6 7.3 7.6-9.9h-4.5z"/>',
  Check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  ChevronRight: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  ChevronDown: '<path d="M5.5 9.5L12 16l6.5-6.5"/>',
  Close: '<path d="M6 6l12 12M18 6L6 18"/>',
  ContentCopy:
    '<rect x="8.5" y="8.5" width="11" height="11" rx="1.8"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  DriveFileRenameOutline:
    '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  LocalFireDepartment:
    '<path d="M12 21c3.6 0 6-2.3 6-5.6 0-4-4-5.4-3.4-9.4C11.8 8 10 9.6 10 12c0 1.2.5 2 .5 2S9 13.6 8.6 12C7.4 13.4 6 15 6 15.4 6 18.7 8.4 21 12 21z"/>',
  LocalFlorist:
    '<circle cx="12" cy="11" r="2.2"/><path d="M12 8.8c0-2.6 1.6-4.6 4-4.8.3 2.5-1.4 4.6-4 4.8z"/><path d="M12 13.2c0 2.6-1.6 4.6-4 4.8-.3-2.5 1.4-4.6 4-4.8z"/><path d="M12 18v3M9 21h6"/>',
  NightsStay:
    '<path d="M18.6 14.4A7.4 7.4 0 0 1 9.6 5.4a7.6 7.6 0 1 0 9 9z"/><path d="M16.5 4.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/>',
  WaterDrop: '<path d="M12 3.5s6 6.4 6 10.2a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
  Waves: '<path d="M3 8.5c1.8-1.4 3.6-1.4 5.4 0s3.6 1.4 5.4 0 3.6-1.4 5.4 0"/><path d="M3 13c1.8-1.4 3.6-1.4 5.4 0s3.6 1.4 5.4 0 3.6-1.4 5.4 0"/><path d="M3 17.5c1.8-1.4 3.6-1.4 5.4 0s3.6 1.4 5.4 0 3.6-1.4 5.4 0"/>',
  AcUnit: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M12 6.5l-2-2M12 6.5l2-2M12 17.5l-2 2M12 17.5l2 2"/>',
  Block: '<circle cx="12" cy="12" r="8.2"/><path d="M6.2 6.2l11.6 11.6"/>',
  Star: '<path d="M12 4l2.4 5.1 5.6.7-4.1 3.9 1.1 5.5L12 16.6l-5 2.6 1.1-5.5L4 9.8l5.6-.7z"/>',
  StarBorder:
    '<path d="M12 4l2.4 5.1 5.6.7-4.1 3.9 1.1 5.5L12 16.6l-5 2.6 1.1-5.5L4 9.8l5.6-.7z"/>',
  PushPin:
    '<path d="M9 3.5h6l-.8 5.2 3 3.2H6.8l3-3.2z"/><path d="M12 11.9V20.5"/>',
  Add: '<path d="M12 5v14M5 12h14"/>',
  TouchApp:
    '<circle cx="9" cy="14" r="1.3"/><path d="M12 8.5V11l2.6.9"/><path d="M12 4.2a8 8 0 0 1 7.6 10.6"/><path d="M8 20.2A7.9 7.9 0 0 1 4.6 12"/>',
  Block2: '<circle cx="12" cy="12" r="8"/>',
};

export function ComicIcon(props: { name: string; size?: number; style?: CSSProperties }) {
  const body = GLYPHS[props.name] ?? '<circle cx="12" cy="12" r="3"/>';
  return (
    <svg
      className="cmcs-icon"
      width={props.size ?? 17}
      height={props.size ?? 17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={props.style}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
