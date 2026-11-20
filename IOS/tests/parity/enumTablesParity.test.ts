/**
 * enumTablesParity.test.ts —— 第二批枚举对拍：**iOS 实际在用的表** vs Kotlin 原文。
 *
 * 与 `kotlinEnums.test.ts` 的分工：
 *   · 那个文件证明「集中表 KOTLIN_ENUMS 与 478 个 Kotlin 文件的枚举完全一致」，
 *     但它对拍的是**镜像表**；
 *   · 本文件对拍的是**真正被界面/逻辑读取的表**（`DOWNLOAD_STATUSES`、`TOUCH_ACTION_LABELS`、
 *     `MOUSE_WHEEL_ZOOM_MODES` …）。少一项、换顺序、文案改了，这里立刻红。
 *
 * 覆盖 18 个枚举，横跨 data / library / download / god / discover / glass / pagecurl /
 * zoom / mascot / privacy / reader / components / i18n。
 *
 * 本轮顺带补掉的真实缺口（不是为了让测试变绿，是门禁抓出来之后补的实现）：
 *   · `bookTypes.DownloadStatus` 缺 `CANCELLED`（Kotlin 是 6 项，原实现 5 项）
 *   · `MouseWheelZoom` 缺 Shift / Alt / Meta 三档（原实现只认 Ctrl）
 *   · `GodPullEdge` / `MascotMood` / `WindowWidthClass` / `DiscoverLayout` /
 *     `DiscoverPartition` / `AppSnackKind` / `PointerBehavior` 只有类型没有值数组
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { kotlinEnum, kotlinEnumLabels, kotlinEnumValues } from '@core/enums/kotlinEnums';
import { DOWNLOAD_STATUSES, DownloadStatus, CONTENT_TYPE_COMIC, CONTENT_TYPE_NOVEL } from '@core/library/bookTypes';
import { ComicDownloadStatus } from '@core/library/libraryComicDownload';
import { GOD_PULL_EDGES } from '@core/god/godPull';
import {
  DISCOVER_DIMENSIONS,
  DISCOVER_LAYOUTS,
  DISCOVER_LAYOUT_LABELS,
  DISCOVER_PARTITIONS,
  DISCOVER_PARTITION_LABELS,
  DISCOVER_PARTITION_SUFFIX,
} from '@core/discover/models';
import { WINDOW_WIDTH_CLASSES } from '@core/glass/adaptiveSpec';
import { POINTER_BEHAVIORS } from '@core/pagecurl/pageCurl';
import { ScrollGesturePropagation } from '@core/zoom/gestures';
import {
  MOUSE_WHEEL_ZOOM_MODES,
  detectMouseWheelZoom,
  mouseWheelZoomCanZoom,
} from '@core/ui/parityMisc';
import { MASCOT_MOODS } from '@core/mascot/mascotSpriteSheet';
import { HAPTIC_TABLE } from '@core/glass/motion';
import { PIN_ENTRY_MODES } from '@core/privacy/privacyWindows';
import { PAGE_TURN_TYPES } from '@core/reader/readerScreenLogic';
import {
  SWIPE_ACTIONS,
  SWIPE_ACTION_LABELS,
  TOUCH_ACTIONS,
  TOUCH_ACTION_LABELS,
} from '@core/reader/touchZones';
import { APP_SNACK_KINDS } from '@ui/components/AppSnackbar';
import { AppLanguage, appLanguageOf } from '@core/i18n/locale';

import { androidReference } from '../helpers/androidReference';

const KT_SRC = 'app/src/main/java';

/** 取 Kotlin 枚举的项名（读原文）。 */
function kotlin(rel: string, name: string): readonly string[] {
  const values = kotlinEnumValues(rel, name);
  expect(values.length, `${rel}::${name} 没解析到，检查文件路径/枚举名`).toBeGreaterThan(0);
  return values;
}

/** 读整段 Kotlin 源码（部分断言要匹配 `listOf(...)` 这类写法）。 */
function kotlinSource(rel: string): string {
  return readFileSync(androidReference(`${KT_SRC}/${rel}`), 'utf8');
}

describe('下载 / 书库 枚举', () => {
  it('DownloadStatus：6 项，含 CANCELLED', () => {
    const want = kotlin('com/example/download/DownloadTaskEntity.kt', 'DownloadStatus');
    expect(want).toEqual(['PENDING', 'DOWNLOADING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']);
    expect([...DOWNLOAD_STATUSES]).toEqual(want);
    // const 对象的键顺序也要一致（UI 遍历时直接取值）
    expect(Object.values(DownloadStatus)).toEqual(want);
  });

  it('ComicDownloadStatus：4 项', () => {
    const want = kotlin('com/example/library/ComicDownloadManager.kt', 'ComicDownloadStatus');
    expect(want).toEqual(['DOWNLOADING', 'PAUSED', 'FAILED', 'SUCCESS']);
    expect(Object.values(ComicDownloadStatus)).toEqual(want);
  });

  it('ContentType：NOVEL / COMIC 两个字面量与 Kotlin 常量一致', () => {
    const want = kotlin('com/example/data/Book.kt', 'ContentType');
    expect(want).toEqual(['NOVEL', 'COMIC']);
    expect(CONTENT_TYPE_NOVEL).toBe(want[0]);
    expect(CONTENT_TYPE_COMIC).toBe(want[1]);
    // iOS 的库内小写类型是这两个大写字面量的投影
    const src = kotlinSource('com/example/data/Book.kt');
    expect(src).toContain('enum class ContentType');
  });
});

describe('神回 / 发现 枚举', () => {
  it('GodPullEdge：4 个方向', () => {
    const want = kotlin('com/example/god/GodPull.kt', 'GodPullEdge');
    expect(want).toEqual(['LEFT', 'RIGHT', 'TOP', 'BOTTOM']);
    expect([...GOD_PULL_EDGES]).toEqual(want);
  });

  it('DiscoverDimension：4 个维度 + 文案 + 每个维度的 range 列表', () => {
    const want = kotlin('com/example/discover/DiscoverModels.kt', 'DiscoverDimension');
    expect(want).toEqual(['UPDATES', 'DISCUSSION', 'RANKING', 'CLICKS']);
    expect(Object.keys(DISCOVER_DIMENSIONS)).toEqual(want);
    const labels = kotlinEnumLabels('com/example/discover/DiscoverModels.kt', 'DiscoverDimension');
    for (const name of want) {
      const entry = DISCOVER_DIMENSIONS[name as keyof typeof DISCOVER_DIMENSIONS];
      expect(entry.label, `${name} 的 label`).toBe(labels[name]);
    }
    // Kotlin 的 ranges 是构造器第二参的 listOf(...) —— 逐维度抽出后比对
    const src = kotlinSource('com/example/discover/DiscoverModels.kt');
    for (const name of want) {
      const line = new RegExp(`${name}\\("[^"]*",\\s*listOf\\(([^)]*)\\)\\)`).exec(src);
      expect(line, `${name} 的 ranges 没匹配到`).not.toBeNull();
      const ranges = (line?.[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter((s) => s !== '');
      const entry = DISCOVER_DIMENSIONS[name as keyof typeof DISCOVER_DIMENSIONS];
      expect([...entry.ranges], `${name} 的 ranges`).toEqual(ranges);
    }
  });

  it('DiscoverLayout：3 种布局 + 文案', () => {
    const want = kotlin('com/example/discover/DiscoverModels.kt', 'DiscoverLayout');
    expect(want).toEqual(['LIST', 'GRID', 'LARGE']);
    expect([...DISCOVER_LAYOUTS]).toEqual(want);
    const labels = kotlinEnumLabels('com/example/discover/DiscoverModels.kt', 'DiscoverLayout');
    for (const name of want) {
      expect(DISCOVER_LAYOUT_LABELS[name as keyof typeof DISCOVER_LAYOUT_LABELS], `${name} 的 label`).toBe(labels[name]);
    }
  });

  it('DiscoverPartition：2 个分区 + 文案 + preferenceSuffix', () => {
    const want = kotlin('com/example/discover/DiscoverPartition.kt', 'DiscoverPartition');
    expect(want).toEqual(['COMIC', 'NOVEL']);
    expect([...DISCOVER_PARTITIONS]).toEqual(want);
    const labels = kotlinEnumLabels('com/example/discover/DiscoverPartition.kt', 'DiscoverPartition');
    for (const name of want) {
      expect(DISCOVER_PARTITION_LABELS[name as keyof typeof DISCOVER_PARTITION_LABELS]).toBe(labels[name]);
    }
    // Kotlin：`COMIC("漫画", ""), NOVEL("小说", "_novel")`
    expect(DISCOVER_PARTITION_SUFFIX.COMIC).toBe('');
    expect(DISCOVER_PARTITION_SUFFIX.NOVEL).toBe('_novel');
    expect(kotlinSource('com/example/discover/DiscoverPartition.kt')).toContain('NOVEL("小说", "_novel")');
  });
});

describe('自适应 / 卷页 / 缩放 枚举', () => {
  it('WindowWidthClass：3 个断点', () => {
    const want = kotlin('com/example/ui/adaptive/AdaptiveSpec.kt', 'WindowWidthClass');
    expect(want).toEqual(['COMPACT', 'MEDIUM', 'EXPANDED']);
    expect([...WINDOW_WIDTH_CLASSES]).toEqual(want);
  });

  it('PointerBehavior：Default / PageEdge', () => {
    const want = kotlin('eu/wewox/pagecurl/config/PageCurlConfig.kt', 'PointerBehavior');
    expect(want).toEqual(['Default', 'PageEdge']);
    expect([...POINTER_BEHAVIORS]).toEqual(want);
  });

  it('ScrollGesturePropagation：ContentEdge / NotZoomed', () => {
    const want = kotlin('net/engawapg/lib/zoomable/ScrollGesturePrpagation.kt', 'ScrollGesturePropagation');
    expect(want).toEqual(['ContentEdge', 'NotZoomed']);
    expect(Object.values(ScrollGesturePropagation)).toEqual(want);
  });

  it('MouseWheelZoom：6 档，且每档只在对应修饰键下放行', () => {
    const want = kotlin('net/engawapg/lib/zoomable/MouseWheelZoom.kt', 'MouseWheelZoom');
    expect(want).toEqual([
      'Disabled',
      'Enabled',
      'EnabledWithCtrlKey',
      'EnabledWithShiftKey',
      'EnabledWithAltKey',
      'EnabledWithMetaKey',
    ]);
    expect([...MOUSE_WHEEL_ZOOM_MODES]).toEqual(want);

    const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    const all = { ctrlKey: true, shiftKey: true, altKey: true, metaKey: true };
    expect(mouseWheelZoomCanZoom('Disabled', all)).toBe(false);
    expect(mouseWheelZoomCanZoom('Enabled', none)).toBe(true);
    for (const mode of ['EnabledWithCtrlKey', 'EnabledWithShiftKey', 'EnabledWithAltKey', 'EnabledWithMetaKey'] as const) {
      expect(mouseWheelZoomCanZoom(mode, none), `${mode} 在无修饰键时`).toBe(false);
      expect(mouseWheelZoomCanZoom(mode, all), `${mode} 在全部修饰键按下时`).toBe(true);
      // 只按「自己那一把」键也要放行
      const own = {
        ctrlKey: mode === 'EnabledWithCtrlKey',
        shiftKey: mode === 'EnabledWithShiftKey',
        altKey: mode === 'EnabledWithAltKey',
        metaKey: mode === 'EnabledWithMetaKey',
      };
      expect(mouseWheelZoomCanZoom(mode, own), `${mode} 在只按自己的修饰键时`).toBe(true);
    }
    // deltaY = 0 不触发；Disabled 档即使在 ctrl 下也不触发
    expect(detectMouseWheelZoom({ deltaY: 0, ctrlKey: true, mode: 'Enabled' })).toBe(false);
    expect(detectMouseWheelZoom({ deltaY: 120, ctrlKey: true, mode: 'EnabledWithCtrlKey' })).toBe(true);
    expect(detectMouseWheelZoom({ deltaY: 120, ctrlKey: false, mode: 'EnabledWithCtrlKey' })).toBe(false);
    expect(detectMouseWheelZoom({ deltaY: 120, ctrlKey: true, mode: 'Disabled' })).toBe(false);
    expect(detectMouseWheelZoom({ deltaY: 120, ctrlKey: false, shiftKey: true, mode: 'EnabledWithShiftKey' })).toBe(true);
  });
});

describe('吉祥物 / 触感 / 隐私 / 翻页 / 触控 / 提示条 / 语言', () => {
  it('MascotMood：5 种情绪', () => {
    const want = kotlin('com/example/ui/mascot/MascotSpriteSheet.kt', 'MascotMood');
    expect(want).toEqual(['IDLE', 'READING', 'RUN', 'HAPPY', 'SAD']);
    expect([...MASCOT_MOODS]).toEqual(want);
  });

  it('HapticKind：5 档，且 HAPTIC_TABLE 的键与顺序一致', () => {
    const want = kotlin('com/example/ui/feedback/Motion.kt', 'HapticKind');
    expect(want).toEqual(['SELECTION', 'LIGHT', 'MEDIUM', 'HEAVY', 'SUCCESS']);
    expect(Object.keys(HAPTIC_TABLE)).toEqual(want);
  });

  it('PinEntryMode：5 个 PIN 阶段', () => {
    const want = kotlin('com/example/ui/privacy/PrivacyWindows.kt', 'PinEntryMode');
    expect(want).toEqual(['SETUP', 'CONFIRM', 'VERIFY', 'CHANGE_OLD', 'CHANGE_NEW']);
    expect([...PIN_ENTRY_MODES]).toEqual(want);
  });

  it('PageTurnType：5 种翻页的 id / 标题 / 描述', () => {
    const want = kotlin('com/example/ui/pageturn/PageTurnContainer.kt', 'PageTurnType');
    expect(want).toEqual(['SIMULATE', 'COVER', 'SLIDE', 'FADE', 'SCROLL']);
    expect(PAGE_TURN_TYPES.map((t) => t.title).length).toBe(5);
    const labels = kotlinEnumLabels('com/example/ui/pageturn/PageTurnContainer.kt', 'PageTurnType');
    PAGE_TURN_TYPES.forEach((entry, index) => {
      const name = want[index] ?? '';
      expect(entry.title, `${name} 的标题`).toBe(labels[name]);
    });
    // 描述是构造器第二参（kotlinEnumLabels 只取第一个字符串），单独按原文抽
    const src = kotlinSource('com/example/ui/pageturn/PageTurnContainer.kt');
    for (let i = 0; i < want.length; i += 1) {
      const name = want[i] ?? '';
      const m = new RegExp(`${name}\\((\\d+),\\s*"([^"]*)",\\s*"([^"]*)"\\)`).exec(src);
      expect(m, `${name} 的构造参数没匹配到`).not.toBeNull();
      expect(PAGE_TURN_TYPES[i]?.id, `${name} 的 id`).toBe(Number(m?.[1]));
      expect(PAGE_TURN_TYPES[i]?.title, `${name} 的标题`).toBe(m?.[2]);
      expect(PAGE_TURN_TYPES[i]?.description, `${name} 的描述`).toBe(m?.[3]);
    }
  });

  it('TouchAction / SwipeAction：项名顺序与标签', () => {
    const touch = kotlin('com/example/ui/reader/TouchZones.kt', 'TouchAction');
    expect(touch).toEqual(['NONE', 'PREVIOUS', 'NEXT', 'CONTROLS', 'SETTINGS', 'CONTENTS', 'LISTEN', 'EXIT']);
    expect([...TOUCH_ACTIONS]).toEqual(touch);
    const touchLabels = kotlinEnumLabels('com/example/ui/reader/TouchZones.kt', 'TouchAction');
    for (const name of touch) {
      expect(TOUCH_ACTION_LABELS[name as keyof typeof TOUCH_ACTION_LABELS], `TouchAction.${name}`).toBe(touchLabels[name]);
    }

    const swipe = kotlin('com/example/ui/reader/TouchZones.kt', 'SwipeAction');
    expect(swipe).toEqual(['NONE', 'PAGE', 'CONTROLS', 'SETTINGS']);
    expect([...SWIPE_ACTIONS]).toEqual(swipe);
    const swipeLabels = kotlinEnumLabels('com/example/ui/reader/TouchZones.kt', 'SwipeAction');
    for (const name of swipe) {
      expect(SWIPE_ACTION_LABELS[name as keyof typeof SWIPE_ACTION_LABELS], `SwipeAction.${name}`).toBe(swipeLabels[name]);
    }
  });

  it('AppSnackKind：ERROR / TOAST', () => {
    const want = kotlin('com/example/ui/components/AppSnackbar.kt', 'AppSnackKind');
    expect(want).toEqual(['ERROR', 'TOAST']);
    expect([...APP_SNACK_KINDS]).toEqual(want);
  });

  it('AppLanguage：zh / en 两个 tag，未知 tag 一律回落 ZH', () => {
    const entry = kotlinEnum('com/example/i18n/Strings.kt', 'AppLanguage');
    expect(entry).not.toBeNull();
    const src = kotlinSource('com/example/i18n/Strings.kt');
    // Kotlin：`ZH("zh"), EN("en")`
    expect(src).toContain('ZH("zh")');
    expect(src).toContain('EN("en")');
    expect([AppLanguage.ZH, AppLanguage.EN]).toEqual(['zh', 'en']);
    expect(appLanguageOf('en')).toBe('en');
    expect(appLanguageOf('en-US')).toBe('en');
    expect(appLanguageOf('zh-CN')).toBe('zh');
    expect(appLanguageOf(null)).toBe('zh');
    expect(appLanguageOf('fr')).toBe('zh');
  });
});
