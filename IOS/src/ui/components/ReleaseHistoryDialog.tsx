/**
 * ReleaseHistoryDialog.tsx — line-by-line port of Android
 * `com/example/ui/components/ReleaseHistoryDialog.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/components/ReleaseHistoryDialog.kt`, 137 lines / 131 non-blank).
 *
 * Kotlin → TS line map
 * ────────────────────
 *   L1-28    package + Compose imports                 → React imports; Compose/Android imports SKIPPED
 *   L30      `internal data class ReleaseSummary(version, date, summary)` → `ReleaseSummary`
 *   L31-91   `internal val releaseHistory = listOf(…)` — 59 entries → `RELEASE_HISTORY`
 *                                                       (逐条照抄：版本号 / 日期 / 中文摘要)
 *   L94-96   `ReleaseHistoryDialog(onDismiss)` + `WenkuSheetDialog` → props + `AcrylicBottomOverlay`
 *   L97      `LocalOverlayClose.current`                → `onDismiss`（同一关闭语义）
 *   L98-101  Column(heightIn max 520.dp, padding h 20.dp, spacedBy 10.dp, testTag "release-history")
 *                                                       → `.release-history` + `data-testid="release-history"`
 *   L102-109 Row: Column(`更新目录` titleMedium, `SYSTEM / RELEASES` labelSmall, onSurfaceVariant)
 *            + `WenkuIconButton(Icons.Default.Close, "关闭更新目录")` → header row + `关闭更新目录`
 *   L110-113 Row(SpaceBetween): `已安装版本` bodySmall + `BuildConfig.VERSION_NAME` labelMedium
 *                                                       → `.release-history__installed`
 *   L114     `WenkuSectionHeader("01", "RELEASE NOTES", tr("版本记录"))` → `.release-history__section-header`
 *   L115-133 LazyColumn(spacedBy 12.dp): per release → version (or `当前版本`, primary, SemiBold),
 *            date (labelSmall, onSurfaceVariant), summary (bodySmall), HorizontalDivider(outlineVariant)
 *                                                       → `.release-history__list`
 *   L134     `WenkuTextButton(tr("关闭"), { close {} })` → `<AppButton variant="tertiary">关闭</AppButton>`
 *
 * ── Value fidelity ──────────────────────────────────────────────────────────────
 *  * `BuildConfig.VERSION_NAME` → `installedVersion` prop, default `INSTALLED_VERSION` (`1.6.4`,
 *    the versionCode 264 release this port targets). The equality branch that swaps the version
 *    label for `当前版本` and tints it with `colorScheme.primary` is preserved verbatim.
 *  * 全部 59 条版本记录的版本号、日期、摘要逐字照抄（含 `·` 分隔符与 `bug` 大小写）。
 *  * `Spacer`/`spacedBy` 的 10dp、12dp、8dp 全部保留在 CSS 里。
 *
 * ── Adaptations ────────────────────────────────────────────────────────────────
 *  * `WenkuSheetDialog`（底部抽拉 + 遮罩 + 减少动态效果）→ 共享 `AcrylicBottomOverlay`
 *    （`AcrylicDialog.tsx`，同一 24dp 圆角 / 径向遮罩 / 底部入场）。
 *  * `WenkuIconButton` → `AppIconButton`；`WenkuTextButton` → `AppButton`。
 *  * `LocalOverlayClose`（栈式关闭令牌）→ 直接调用 `onDismiss`：本对话框只有一层，语义等价。
 *  * 未移植：`LazyColumn` 的虚拟化（59 行的静态列表在 Web 上无需窗口化，改用 CSS 滚动容器）。
 */

import { type ReactElement } from 'react';
import { AcrylicBottomOverlay } from '@ui/components/AcrylicDialog';
import { AppButton } from '@ui/components/AppButton';
import { tr } from '@core/i18n';
import { AppIconButton } from '@ui/components/CustomButtons';
import { WenkuSectionHeader } from '@ui/components/wenku/WenkuSectionHeader';
import '../../styles/releaseHistory.css';

/** Kotlin L30 `data class ReleaseSummary`. */
export interface ReleaseSummary {
  version: string;
  date: string;
  summary: string;
}

/**
 * `BuildConfig.VERSION_NAME` of the release this port was cut from
 * (1.6.4 / versionCode 264). Overridable through `installedVersion`.
 */
export const INSTALLED_VERSION = '1.6.4';

/** Kotlin L31-91 — verbatim, newest first. */
export const RELEASE_HISTORY: readonly ReleaseSummary[] = [
  { version: '1.6.4', date: '11-13', summary: '修复一些已知bug' },
  { version: '1.6.3', date: '11-12', summary: '英文界面补齐 · 分类与统计文案 · 仓库清理' },
  { version: '1.6.2', date: '11-12', summary: '3D 书架单时间轴 · 黑封面修复 · 可覆盖安装的正式签名' },
  { version: '1.6.1', date: '11-10', summary: '平板排版 · 旋转重排 · 启动检查更新 · 镜像下载' },
  { version: '1.6.0', date: '11-10', summary: 'Wenku8 UI · 平板布局 · 漫画预加载数量 · Roxy 动画' },
  { version: '1.5.16', date: '11-07', summary: 'EPUB 连续插图修复 · 保留插图原始尺寸' },
  { version: '1.5.15', date: '11-06', summary: "Alice's Library · 自动备份" },
  { version: '1.5.5', date: '10-26', summary: '恢复原正式版包名与固定签名 · 覆盖升级修正' },
  { version: '1.5.4', date: '10-26', summary: '动效分档 · 启动异常保护与诊断导出' },
  { version: '1.5.2', date: '10-26', summary: '动效计算与缓冲复用 · 折叠分页保持 · 成人源固定启用' },
  { version: '1.5.1', date: '10-23', summary: '平板性能优化 · 滚动与章节复用 · 缓存预算' },
  { version: '1.5.0', date: '10-21', summary: '移除内置阅读指南 · 书架多选不再触发抽纸' },
  { version: '1.4.18', date: '10-21', summary: '小说多源推荐更新榜单 · 原站分类精准适配 · 卡片参数排版修复' },
  { version: '1.4.17', date: '10-21', summary: '小说与漫画独立发现 · 完整页面统一抽纸 · 阅读设置退出优化' },
  { version: '1.4.16', date: '10-21', summary: '按钮直达完整界面 · 弹层交接统一 · 抽纸平稳落定' },
  { version: '1.4.15', date: '10-21', summary: '轻量柔性抽纸 · 修复底栏跳动 · 移除弹层角落白光' },
  { version: '1.4.14', date: '10-21', summary: '快速滚动与连续点击稳定性修复 · 抽纸简化为统一轻量过渡' },
  { version: '1.4.13', date: '10-21', summary: '毛玻璃抽纸稳定性与性能打磨 · 滑动条触控修复' },
  { version: '1.4.12', date: '10-21', summary: '抽纸加速 · 弹层生命周期修复' },
  { version: '1.4.11', date: '10-20', summary: '原尺寸触控分区与滑动校准 · 统一纸面动效与液体玻璃滑条 · 书源修复' },
  { version: '1.4.10', date: '10-19', summary: '新增书阁小说源 · 完整目录、在线文字与 EPUB 下载' },
  { version: '1.4.9', date: '10-19', summary: '小说插图引用与下载修复 · 失效节点恢复' },
  { version: '1.4.7', date: '10-18', summary: '新增免登录漫画源 · 源站动态分类与筛选' },
  { version: '1.4.6', date: '10-18', summary: '互传合并书籍去重 · 原文件缺失与漫画路径识别' },
  { version: '1.4.5', date: '10-18', summary: '附近连接建组与角色修复 · 独立直连握手' },
  { version: '1.4.4', date: '10-18', summary: '互传毛玻璃界面统一 · 连接与 TLS 握手修复' },
  { version: '1.4.3', date: '10-18', summary: '设备互传与便携备份 · 卡片流转动效 · 精简文案' },
  { version: '1.4.2', date: '10-17', summary: '顶部留白压缩 · 发现榜单与状态分类联动' },
  { version: '1.4.1', date: '10-15', summary: '禁漫连接与线路恢复 · 移除热议 · 更新目录补齐' },
  { version: '1.4.0', date: '10-15', summary: '发现聚合与状态筛选 · Hitomi 与爱漫画修复' },
  { version: '1.3.11', date: '10-15', summary: '发现筛选与列表重构 · 分类窗口 · 栏目缓存' },
  { version: '1.3.10', date: '10-14', summary: '发现收藏与刷新 · 原站排序 · 元数据补全' },
  { version: '1.3.9', date: '10-14', summary: '发现设置与分类 · 共用顶栏 · 渐进加载' },
  { version: '1.3.8', date: '10-14', summary: '发现板块 · 爱漫画与 MYCOMIC 阅读链路' },
  { version: '1.3.7', date: '10-13', summary: '发布签名 · 书源响应与线路容错' },
  { version: '1.3.6', date: '10-12', summary: '完整增强 · GPU 加速' },
  { version: '1.3.5', date: '10-12', summary: '极速增强 · 后续预生成' },
  { version: '1.3.4', date: '10-12', summary: '漫画增强提速' },
  { version: '1.3.3', date: '10-12', summary: '增强加速 · 设置卡片统一' },
  { version: '1.3.2', date: '10-12', summary: '漫画增强 · 精确续读 · 极简渲染' },
  { version: '1.3.1', date: '10-11', summary: '动效与玻璃 · 导航修复' },
  { version: '1.3.0', date: '10-09', summary: '增强翻页无空白' },
  { version: '1.2.9', date: '10-09', summary: '增强细线与小字' },
  { version: '1.2.8', date: '10-09', summary: '画质增强重构' },
  { version: '1.2.7', date: '10-07', summary: '翻页与导航修复' },
  { version: '1.2.6', date: '10-07', summary: '分享与原归档' },
  { version: '1.2.5', date: '10-07', summary: '阅读体验与翻译' },
  { version: '1.2.4', date: '10-06', summary: '章节顺序修复' },
  { version: '1.2.3', date: '10-05', summary: '神回封面 · 应用更新' },
  { version: '1.2.2', date: '10-05', summary: '多语言搜索' },
  { version: '1.2.1', date: '10-05', summary: '书源与界面修复' },
  { version: '1.2.0', date: '10-03', summary: '小说与漫画阅读升级' },
  { version: '1.1.5', date: '10-02', summary: '聚合搜索 · 连续搜索' },
  { version: '1.1.0', date: '09-24', summary: '书源与键盘交互' },
  { version: '1.0.7', date: '09-21', summary: '界面适配 · 安装包瘦身' },
  { version: '1.0.6', date: '09-08', summary: '串珠翻页 · 漫画加载' },
  { version: '1.0.5', date: '09-05', summary: '漫画阅读 · 整页翻译' },
  { version: '1.0.1', date: '08-29', summary: '在线小说 · 聚合搜索' },
  { version: '1.0.0', date: '08-28', summary: '首次发布' },
];

export interface ReleaseHistoryDialogProps {
  /** Kotlin `onDismiss: () -> Unit` — also the `LocalOverlayClose` action for both close buttons. */
  onDismiss: () => void;
  /** `BuildConfig.VERSION_NAME` — the release that is installed right now. */
  installedVersion?: string;
  /** Kotlin `releaseHistory` — overridable for tests; defaults to the 59 shipped entries. */
  releases?: readonly ReleaseSummary[];
  /** Kotlin `MaterialTheme.colorScheme.primary`. */
  primary?: string;
  /** Kotlin `MaterialTheme.colorScheme.secondary`. */
  secondary?: string;
}

/** Kotlin `ReleaseHistoryDialog` (L94-137). */
export function ReleaseHistoryDialog(props: ReleaseHistoryDialogProps): ReactElement {
  const installedVersion = props.installedVersion ?? INSTALLED_VERSION;
  const releases = props.releases ?? RELEASE_HISTORY;
  const primary = props.primary ?? '#059669';

  return (
    <AcrylicBottomOverlay onDismissRequest={props.onDismiss} primary={primary} {...(props.secondary === undefined ? {} : { secondary: props.secondary })}>
      <div className="release-history" data-testid="release-history">
        {/* Kotlin L102-109 */}
        <div className="release-history__header">
          <div className="release-history__titles">
            <p className="release-history__title">{tr('更新目录')}</p>
            <p className="release-history__code">SYSTEM / RELEASES</p>
          </div>
          <AppIconButton onClick={props.onDismiss} className="release-history__close">
            <span className="release-history__sr-only">{tr('关闭更新目录')}</span>
            <CloseIcon />
          </AppIconButton>
        </div>

        {/* Kotlin L110-113 */}
        <div className="release-history__installed">
          <span className="release-history__installed-label">{tr('已安装版本')}</span>
          <span className="release-history__installed-version">{installedVersion}</span>
        </div>

        {/* Kotlin L114 `WenkuSectionHeader("01", "RELEASE NOTES", tr("版本记录"))` */}
        <WenkuSectionHeader index="01" latin="RELEASE NOTES" title={tr('版本记录')} />

        {/* Kotlin L115-133 */}
        <div className="release-history__list" role="list">
          {releases.map((release) => {
            const current = release.version === installedVersion;
            return (
              <div className="release-history__item" role="listitem" key={release.version}>
                <div className="release-history__item-head">
                  <span
                    className={
                      current
                        ? 'release-history__version release-history__version--current'
                        : 'release-history__version'
                    }
                    style={current ? { color: primary } : undefined}
                  >
                    {current ? tr('当前版本') : release.version}
                  </span>
                  <span className="release-history__date">{release.date}</span>
                </div>
                <p className="release-history__summary">{tr(release.summary)}</p>
                <span className="release-history__divider" aria-hidden="true" />
              </div>
            );
          })}
        </div>

        {/* Kotlin L134 */}
        <AppButton variant="tertiary" fullWidth onClick={props.onDismiss}>
          {tr('关闭')}
        </AppButton>
      </div>
    </AcrylicBottomOverlay>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

export default ReleaseHistoryDialog;