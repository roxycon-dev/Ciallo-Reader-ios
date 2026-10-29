import { useEffect, useRef } from 'react';
import { AdaptiveSpec } from '../../../core/glass/adaptiveSpec';
import { showToast } from '../Toast';
import { AppIconButton } from '../CustomButtons';
import { FaqExpandableItem } from './FaqExpandableItem';
import { FlowStepItem, HelpSectionHeader, TextDetailCard } from './HelpSection';
import { JSON_TEMPLATE } from './JsonSourceGuideCard';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/help/LibraryHelpBottomSheet.kt` (327 non-blank lines) — FULL PORT
 *   lines 37-354 `@Composable LibraryHelpBottomSheet(onDismissRequest, onOpenSourceManager, modifier)`
 *   lines 45-57  `ModalBottomSheet(fillMaxHeight(0.9f), padding(h12 v8), 24.dp shape)`
 *                → a fixed overlay sheet with the same metrics
 *   lines 59-101 the 64dp title bar (HelpCenter icon + 「书库使用手册」 + close)
 *   lines 115-127 the welcome card
 *   lines 130-152 「1. 快速上手」 four FlowStepItems (strings verbatim)
 *   lines 155-184 「2…5」 TextDetailCards (strings verbatim)
 *   lines 187-209 「6. 常见问题」 four FaqExpandableItems (strings verbatim)
 *   lines 213-295 「快捷操作」 打开书源管理 / 查看JSON模板 (clipboard)
 *   lines 297-328 清除下载临时文件 (30-minute .tmp sweep)
 *   lines 332-349 the version footer (strings verbatim)
 *
 * ADAPTATION — `ModalBottomSheet` → a fixed-position bottom sheet.
 * `onDismissRequest` + the Android back gesture map to (a) the close button,
 * (b) `Escape`, (c) an explicit `onDismissRequest` call from the host.
 *
 * `AppToast.makeText(context, msg, Toast.LENGTH_SHORT).show()` → `showToast(msg)`.
 * The `.tmp` sweep runs through an injected `deleteStaleDownloadTemps()` so this
 * file stays free of Capacitor Filesystem imports (the host owns that bridge);
 * the 30-minute cutoff and the `.tmp` filter are preserved verbatim.
 */
export const COPY_TEMPLATE_MESSAGE = '已复制 JSON 示例模板到剪贴板';

export interface LibraryHelpBottomSheetProps {
  onDismissRequest: () => void;
  onOpenSourceManager: () => void;
  className?: string;
  /**
   * Deletes stale `downloads/*.tmp` files older than 30 minutes.
   * Returns the number deleted; the caller owns the platform IO.
   */
  deleteStaleDownloadTemps?: () => Promise<number>;
  /** Brand mint + secondary, used by the shortcut cards. */
  primary?: string;
  secondary?: string;
}

export function LibraryHelpBottomSheet(props: LibraryHelpBottomSheetProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onDismissRequest();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const copyTemplate = (): void => {
    const write = (): void => {
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        void navigator.clipboard.writeText(JSON_TEMPLATE);
      }
    };
    write();
    showToast(COPY_TEMPLATE_MESSAGE);
  };

  const clearTemps = (): void => {
    if (props.deleteStaleDownloadTemps === undefined) return;
    void props.deleteStaleDownloadTemps().then((count) => {
      showToast(
        count > 0 ? `已清除 ${count} 个下载临时文件` : '没有可清理的下载临时文件',
      );
    });
  };

  return (
    <div className="library-help-sheet" role="dialog" aria-modal="true" aria-label="书库使用手册">
      <div
        className="library-help-sheet__scrim"
        onClick={props.onDismissRequest}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={['library-help-sheet__panel', props.className ?? ''].filter(Boolean).join(' ')}
        data-testid="library_help_bottom_sheet"
      >
        <div className="library-help-sheet__inner" style={{ maxWidth: AdaptiveSpec.sheetMaxWidth }}>
          {/* 顶部标题栏 */}
          <div className="library-help-sheet__titlebar">
            <div className="library-help-sheet__titlebar-row">
              <div className="library-help-sheet__titlebar-left">
                <span style={{ color: primary }} aria-label="帮助中心">
                  <HelpCenterIcon />
                </span>
                <span style={{ width: 8 }} />
                <h1 className="library-help-sheet__title">书库使用手册</h1>
              </div>
              <AppIconButton
                onClick={props.onDismissRequest}
                data-testid="close_help_bottom_sheet_button"
              >
                <span aria-label="关闭帮助" style={{ color: '#61666D' }}>
                  <CloseIcon />
                </span>
              </AppIconButton>
            </div>
          </div>

          <hr className="library-help-sheet__divider" />

          <div className="library-help-sheet__scroll">
            {/* 欢迎提示 */}
            <div
              className="library-help-welcome"
              style={{ background: rgba(primary, 0.1), color: primary }}
            >
              书库使用手册已更新：快速掌握搜索、下载与书源管理。
            </div>

            {/* 1. 快速上手 */}
            <HelpSectionHeader title="1. 快速上手" />
            <FlowStepItem
              stepNumber="1"
              title="选择书源"
              desc="顶部书源选择器可切换小说源或漫画源；选择“聚合漫画（全部）”可并行搜索已启用的漫画源。Venera 源可在书源管理中更新。"
            />
            <FlowStepItem
              stepNumber="2"
              title="搜索图书"
              desc="输入书名或作者后点击搜索 / 回车；可按小说或漫画查看分类结果。点击搜索框会显示搜索历史，点历史词可直接再次搜索，也可一键清空。"
            />
            <FlowStepItem
              stepNumber="3"
              title="下载与阅读"
              desc="结果卡片点击“下载/阅读”：小说自动后台下载到书架，漫画先进章节页，选择章节在线阅读或下载。"
            />
            <FlowStepItem
              stepNumber="4"
              title="打开书架"
              desc="下载完成的书籍会出现在书架，点击即可打开阅读器，支持离线阅读。"
            />

            {/* 2. 搜索与搜索历史 */}
            <HelpSectionHeader title="2. 搜索与搜索历史" />
            <TextDetailCard text="点击搜索框且输入为空时，会显示最近 10 条搜索历史；点历史词直接搜索，点“清空”删除全部历史。漫画聚合搜索会优先显示先返回的结果，再补齐其他源和标题变体；个别源失败不会阻塞其他源。" />

            {/* 3. 下载与进度 */}
            <HelpSectionHeader title="3. 下载与进度" />
            <TextDetailCard text="书库右上角下载按钮可打开下载面板查看任务进度、速度与剩余大小；支持小说整本下载和漫画章节下载，完成后可离线阅读。漫画下载支持暂停后续传；Z-Library 下载前可能需要登录，按提示进入登录窗口即可。" />

            {/* 4. 书源管理 */}
            <HelpSectionHeader title="4. 书源管理" />
            <TextDetailCard text="管理书源：可启用或停用来源、导入自定义 JSON 书源、更新 Venera 漫画源，也可删除失效源。成人漫画源已固定开启，无需连续点击解锁或打开专用开关；等待 Venera 源列表更新后，返回书库并在漫画书源选择器中选择对应来源。自定义源兼容 Legado 规则与 JSON API。" />

            {/* 5. 漫画阅读 */}
            <HelpSectionHeader title="5. 漫画阅读" />
            <TextDetailCard text="在线阅读优先加载当前页并渐进显示后续图片，支持单页、滚动和仿真翻页等模式。章节可添加书签；作品详情可查看标签、神回入口及神回排行榜。站外链接章节一般只能在线阅读，推荐优先选择站内章节下载。" />

            {/* 6. 常见问题 */}
            <HelpSectionHeader title="6. 常见问题" />
            <FaqExpandableItem
              question="为什么搜索没有结果？"
              answer="确认当前书源已启用且网络正常；可尝试切换“聚合漫画（全部）”或更换关键词。个别源因站点维护 / 网络波动失败时，不影响其他源继续搜索。"
            />
            <FaqExpandableItem
              question="下载后书架没有书？"
              answer="下载完成后系统需要解析 / 打包，稍等片刻再进入书架刷新。漫画需要先在章节页下载章节，才会出现在书架。"
            />
            <FaqExpandableItem
              question="成人漫画源不显示？"
              answer="成人漫画源已固定开启，无需点击解锁或使用开关。请在书源管理中更新 Venera 源列表，更新完成后回到书库，在漫画书源选择器中选择需要的来源。"
            />
            <FaqExpandableItem
              question="自定义 JSON 源搜不到？"
              answer="先确认 listSelector / detailUrl 与站点当前 HTML 匹配，推荐先用 @css: 规则，并用浏览器开发者工具核对元素类名；需要登录或 JS 渲染的站点暂不支持。"
            />

            <div style={{ height: 8 }} />

            {/* 快捷操作 */}
            <p className="library-help-sheet__quick-title">快捷操作</p>

            <div className="library-help-sheet__quick-row">
              <button
                type="button"
                className="library-help-shortcut"
                data-testid="shortcut_open_source_manager"
                style={{ background: rgba(primary, 0.08), color: primary }}
                onClick={() => {
                  props.onDismissRequest();
                  props.onOpenSourceManager();
                }}
              >
                打开书源管理
              </button>
              <button
                type="button"
                className="library-help-shortcut"
                data-testid="shortcut_copy_template"
                style={{ background: rgba(secondary, 0.08), color: secondary }}
                onClick={copyTemplate}
              >
                查看JSON模板
              </button>
            </div>

            {props.deleteStaleDownloadTemps !== undefined ? (
              <button
                type="button"
                className="library-help-shortcut library-help-shortcut--full"
                data-testid="shortcut_clear_cache"
                style={{ background: 'rgba(220, 38, 38, 0.15)', color: '#DC2626' }}
                onClick={clearTemps}
              >
                清除下载临时文件
              </button>
            ) : null}

            <div style={{ height: 16 }} />

            {/* 版本信息 */}
            <div className="library-help-sheet__footer">
              <p className="library-help-sheet__footer-title">Ciallo Reader · 书库引擎</p>
              <p className="library-help-sheet__footer-sub">Legado Rule Compatible · Venera JS 兼容</p>
              <div style={{ height: 24 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function rgba(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function HelpCenterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}
