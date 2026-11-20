/**
 * novelDownloadPanelParity.test.ts —— 下载任务面板（`library/NovelDownloadPanel.kt`，283 行）。
 *
 * 三条可判定的东西：
 *   ① `downloadBytes` 四档（B / KB / MB，**没有 GB 档**）+ 负数 → 未知大小；
 *   ② `downloadStatusLabel` 六态文案（含 `progress >= 1` 的「校验文件并存入书架…」）；
 *   ③ `downloadRing` 的环几何：25dp / 1.65dp 圆头 / −84° 起 / 348° 扫 / 底环 .18，
 *      不定态是 80° 弧段 1400ms 线性旋转，定态 240ms EaseOutCubic。
 *
 * 本轮修掉的四处漂移：
 *   · `downloadBytes` 多了一档 **GB**、单位小写 `kB`、负数返回 `0 B`；
 *   · 提示文案与删除确认文案是端口自造的，与 Kotlin 原文不同（后者已有 helper 却没用）；
 *   · 漫画章节完成时显示「已完成 · 已存入书架」，Kotlin 是「已完成 · 漫画章节可离线阅读」；
 *   · 进度用 `<progress>` 而不是 Kotlin 的画布细环（`downloadRing` 在 iOS 侧只有个
 *     「给定半径算 dash」的函数，几何常量一个都没落）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { downloadStatusLabel } from '@ui/components/library/DownloadCenter';
import {
  DownloadStatePending,
  downloadingState,
  errorState,
  pausedState,
  successState,
} from '@core/download/downloadState';
import {
  DOWNLOAD_COMIC_COMPLETION_LABEL,
  DOWNLOAD_COMPLETION_LABEL,
  DOWNLOAD_RING,
  NOVEL_DOWNLOAD_PANEL,
  downloadBytes,
  downloadRingArc,
  novelDownloadPanelColumns,
  sortDownloadTasks,
} from '@core/library/uiHelpers';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/library/NovelDownloadPanel.kt'),
  'utf8',
);
const UI = readFileSync('src/ui/components/library/DownloadCenter.tsx', 'utf8');

describe('NovelDownloadPanel.kt：downloadBytes 四档', () => {
  it('负数 → 未知大小；< 1024 → 原样 B；< 1MiB → KB；其余 MB（**没有 GB 档**）', () => {
    expect(KT).toContain('bytes < 0 -> tr("未知大小")');
    expect(KT).toContain('bytes < 1024 -> "$bytes B"');
    expect(KT).toContain('String.format(Locale.ROOT, "%.1f KB", bytes / 1024.0)');
    expect(KT).toContain('String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024))');
    // Kotlin 里没有 GB 分支
    expect(KT).not.toContain('GB');

    expect(downloadBytes(-1)).toBe('未知大小');
    expect(downloadBytes(-1024)).toBe('未知大小');
    expect(downloadBytes(0)).toBe('0 B');
    expect(downloadBytes(1)).toBe('1 B');
    expect(downloadBytes(1023)).toBe('1023 B');
    expect(downloadBytes(1024)).toBe('1.0 KB');
    expect(downloadBytes(1536)).toBe('1.5 KB');
    expect(downloadBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(downloadBytes(1024 * 1024)).toBe('1.0 MB');
    expect(downloadBytes(1500 * 1024)).toBe('1.5 MB');
    // 关键：GB 级仍按 MB 显示（Kotlin 到 MB 为止）
    expect(downloadBytes(1024 * 1024 * 1024)).toBe('1024.0 MB');
    expect(downloadBytes(3 * 1024 * 1024 * 1024)).toBe('3072.0 MB');
  });

  it('单位是大写 KB / MB（此前是小写 kB）', () => {
    const kb = downloadBytes(2048);
    const mb = downloadBytes(2 * 1024 * 1024);
    expect(kb.endsWith(' KB')).toBe(true);
    expect(mb.endsWith(' MB')).toBe(true);
    expect(kb).not.toContain('kB');
  });

  it('小数一律一位（与 `%.1f` 一致）', () => {
    for (const bytes of [1200, 2000, 1024 * 1024 + 1, 5 * 1024 * 1024]) {
      const text = downloadBytes(bytes);
      expect(text).toMatch(/\.\d /);
    }
  });
});

describe('NovelDownloadPanel.kt：六态文案', () => {
  it('Pending / Downloading / Paused / Success / Error / Idle 逐字', () => {
    expect(KT).toContain('DownloadState.Pending -> tr("准备下载 · 获取文件与可用线路")');
    expect(KT).toContain('if (state.progress >= 1f) tr("校验文件并存入书架…")');
    expect(KT).toContain('DownloadState.Paused -> tr("已暂停")');
    expect(KT).toContain('is DownloadState.Success -> tr("已完成 · 已存入书架")');
    expect(KT).toContain('is DownloadState.Error -> tr("下载失败")');
    expect(KT).toContain('DownloadState.Idle -> tr("等待下载")');

    expect(downloadStatusLabel(DownloadStatePending)).toBe('准备下载 · 获取文件与可用线路');
    expect(downloadStatusLabel(downloadingState(0, 0, 0.42))).toBe('下载中 · 42%');
    expect(downloadStatusLabel(downloadingState(10, 100, 1))).toBe('校验文件并存入书架…');
    expect(downloadStatusLabel(downloadingState(0, 0, 0))).toBe('下载中 · 总大小未知');
    expect(downloadStatusLabel(pausedState(1, 2))).toBe('已暂停');
    expect(downloadStatusLabel(successState('/tmp/a.epub'))).toBe('已完成 · 已存入书架');
    expect(downloadStatusLabel(errorState('boom'))).toBe('下载失败');
  });

  it('百分比是截断而非四舍五入（Kotlin `.toInt()`）', () => {
    expect(KT).toContain('${(state.progress * 100).toInt()}%');
    expect(downloadStatusLabel(downloadingState(0, 0, 0.999))).toBe('下载中 · 99%');
    expect(downloadStatusLabel(downloadingState(0, 0, 0.005))).toBe('下载中 · 0%');
  });

  it('「下载中 · 总大小未知」只在 total 与 progress 都为 0 时出现', () => {
    expect(KT).toContain('else if (state.totalBytes > 0 || state.progress > 0)');
    // 有 totalBytes 但 progress 为 0 → 走百分比分支（0%），不是「总大小未知」
    expect(downloadStatusLabel(downloadingState(0, 4096, 0))).toBe('下载中 · 0%');
  });
});

describe('NovelDownloadPanel.kt：进度环几何', () => {
  it('25dp 直径 / 1.65dp 圆头 / −84° 起 / 348° 扫 / 底环 .18', () => {
    expect(KT).toContain('val diameter = 25.dp.toPx()');
    expect(KT).toContain('val stroke = Stroke(1.65.dp.toPx(), cap = StrokeCap.Round)');
    expect(KT).toContain('drawArc(color.copy(alpha = .18f), -84f, 348f, false, topLeft, size, style = stroke)');
    expect(DOWNLOAD_RING.diameterDp).toBe(25);
    expect(DOWNLOAD_RING.strokeWidthDp).toBe(1.65);
    expect(DOWNLOAD_RING.startAngle).toBe(-84);
    expect(DOWNLOAD_RING.trackSweep).toBe(348);
    expect(DOWNLOAD_RING.trackAlpha).toBe(0.18);
    // 348 = 360 − 12，缺口留在正上方
    expect(360 - DOWNLOAD_RING.trackSweep).toBe(12);
  });

  it('定态：sweep = 348 × progress，起点恒 −84°，不旋转', () => {
    expect(KT).toContain('val sweep = if (progress == null) 80f else 348f * fill.value');
    const half = downloadRingArc(0.5);
    expect(half.indeterminate).toBe(false);
    expect(half.sweep).toBeCloseTo(174, 9);
    expect(half.startAngle).toBe(-84);
    expect(half.rotation).toBe(0);
    expect(half.trackStart).toBe(-84);
    expect(half.trackSweep).toBe(348);

    expect(downloadRingArc(0).sweep).toBe(0);
    expect(downloadRingArc(1).sweep).toBe(348);
    // 越界钳制（Kotlin `.coerceIn(0f, 1f)`）
    expect(downloadRingArc(2).sweep).toBe(348);
    expect(downloadRingArc(-1).sweep).toBe(0);
  });

  it('不定态：80° 弧段 + 整圈旋转（1400ms 线性）；减少动态效果时退化成定态 0', () => {
    expect(KT).toContain('val turn = if (progress == null && !reduceMotion)');
    expect(KT).toContain('infiniteRepeatable(tween(1400, easing = LinearEasing))');
    expect(DOWNLOAD_RING.indeterminateSweep).toBe(80);
    expect(DOWNLOAD_RING.spinMs).toBe(1400);

    const spin = downloadRingArc(null, 90);
    expect(spin.indeterminate).toBe(true);
    expect(spin.sweep).toBe(80);
    expect(spin.rotation).toBe(90);
    expect(spin.startAngle).toBe(-84 + 90);

    // 减少动态效果 → 不转，且仍是 80° 弧段（Kotlin 的 `progress == null` 分支）
    const still = downloadRingArc(null, 90, true);
    expect(still.indeterminate).toBe(false);
    expect(still.sweep).toBe(80);
    expect(still.rotation).toBe(0);
    expect(still.startAngle).toBe(-84);
  });

  it('填充动画 240ms（减少动态效果时 0）', () => {
    expect(KT).toContain('animationSpec = tween(if (reduceMotion) 0 else 240, easing = EaseOutCubic)');
    expect(DOWNLOAD_RING.fillMs).toBe(240);
  });
});

describe('NovelDownloadPanel.kt：面板布局与排序', () => {
  it('两列断点 840dp 且 fontScale < 1.3；列间距 12、行间距 10；内边距 24/12/24', () => {
    expect(KT).toContain('val columns = if (maxWidth >= 840.dp && androidx.compose.ui.platform.LocalDensity.current.fontScale < 1.3f) 2 else');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(12.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(10.dp)');
    expect(KT).toContain('contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 24.dp)');
    expect(NOVEL_DOWNLOAD_PANEL.twoColumnMinWidthDp).toBe(840);
    expect(NOVEL_DOWNLOAD_PANEL.twoColumnMaxFontScale).toBe(1.3);
    expect(NOVEL_DOWNLOAD_PANEL.columnGapDp).toBe(12);
    expect(NOVEL_DOWNLOAD_PANEL.rowGapDp).toBe(10);

    expect(novelDownloadPanelColumns(839, 1)).toBe(1);
    expect(novelDownloadPanelColumns(840, 1)).toBe(2);
    expect(novelDownloadPanelColumns(1200, 1.29)).toBe(2);
    // 字号放大到 1.3 以上 → 退回单列（否则书名会被挤成三行）
    expect(novelDownloadPanelColumns(1200, 1.3)).toBe(1);
    expect(novelDownloadPanelColumns(1200, 2)).toBe(1);
  });

  it('排序：未完成在前，同组按 updatedAt 倒序', () => {
    expect(KT).toContain('tasks.sortedWith(compareBy<DownloadTaskEntity> { it.status == DownloadStatus.COMPLETED }');
    expect(KT).toContain('.thenByDescending { it.updatedAt })');
    const input = [
      { id: 'done-old', status: 'COMPLETED', updatedAt: 100 },
      { id: 'run-new', status: 'DOWNLOADING', updatedAt: 300 },
      { id: 'done-new', status: 'COMPLETED', updatedAt: 400 },
      { id: 'run-old', status: 'PAUSED', updatedAt: 200 },
    ];
    expect(sortDownloadTasks(input).map((task) => task.id)).toEqual([
      'run-new',
      'run-old',
      'done-new',
      'done-old',
    ]);
    // 不改动入参
    expect(input[0]?.id).toBe('done-old');
  });

  it('计数 = 预处理 + 小说任务 + 漫画任务', () => {
    expect(KT).toContain('val count = pending.size + tasks.size + comics.size');
    expect(UI).toContain('const count = preparations.length + sorted.length + comics.length;');
  });

  it('模块化页序号 wenkuPagePart：概览 1、预处理从 2 起、漫画接在小说之后', () => {
    expect(KT).toContain('.wenkuPagePart(1)');
    expect(KT).toContain('modifier = Modifier.wenkuPagePart(index + 2)');
    expect(KT).toContain('modifier = Modifier.wenkuPagePart(pending.size + index + 2)');
    expect(KT).toContain('modifier = Modifier.wenkuPagePart(pending.size + tasks.size + index + 2)');
  });
});

describe('NovelDownloadPanel.kt：文案与完成标签', () => {
  it('标题 / 分区名 / 计数 / 提示语逐字', () => {
    expect(KT).toContain('tr("下载任务")');
    expect(KT).toContain('tr("离线任务")');
    expect(KT).toContain('"$count 项"');
    expect(KT).toContain('tr("任务在后台继续，完成后可在书架阅读。")');

    expect(UI).toContain("tr('下载任务')");
    expect(UI).toContain("tr('离线任务')");
    expect(UI).toContain('} 项`');
    expect(UI).toContain("tr('任务在后台继续，完成后可在书架阅读。')");
  });

  it('漫画章节的完成标签是「已完成 · 漫画章节可离线阅读」', () => {
    expect(KT).toContain('completionLabel = tr("已完成 · 漫画章节可离线阅读")');
    expect(KT).toContain('completionLabel: String = "已完成 · 已存入书架"');
    expect(DOWNLOAD_COMPLETION_LABEL).toBe('已完成 · 已存入书架');
    expect(DOWNLOAD_COMIC_COMPLETION_LABEL).toBe('已完成 · 漫画章节可离线阅读');
    // UI 真的把漫画标签传下去了
    expect(UI).toContain('completionLabel={tr(DOWNLOAD_COMIC_COMPLETION_LABEL)}');
    expect(UI).toContain("state.kind === 'Success' && completionLabel !== undefined");
  });

  it('空态两行：标题 + 「从书库或漫画章节开始下载。」', () => {
    expect(KT).toContain('tr("暂无下载任务")');
    expect(KT).toContain('tr("从书库或漫画章节开始下载。")');
    expect(UI).toContain("tr('暂无下载任务')");
    expect(UI).toContain("tr('从书库或漫画章节开始下载。')");
  });

  it('删除确认用共享 helper（此前 UI 自造了一句）', () => {
    expect(KT).toContain('“$title”的下载记录将被移除。未完成的任务会停止，已存入书架的书籍保留。');
    expect(UI).toContain('novelDownloadDeleteNotice(deletion.title)');
    expect(UI).not.toContain('的记录将被删除');
  });

  it('进度环真的被渲染（不再是 <progress>）', () => {
    expect(UI).toContain('function DownloadRing(');
    expect(UI).toContain('<DownloadRing progress={null} />');
    expect(UI).toContain('<DownloadRing progress={1} />');
    expect(UI).not.toContain('<progress');
    // 环用 currentColor，颜色归主题
    expect(UI).toContain('stroke="currentColor"');
    expect(UI).toContain('strokeLinecap="round"');
  });
});
