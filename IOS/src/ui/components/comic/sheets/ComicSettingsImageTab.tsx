/**
 * ComicSettingsImageTab.tsx — 设置面板 Tab 2「图像（裁边/拆分/旋转/增强/滤镜）」。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt`）：
 *   - 769–916  ImageTab
 *   - 783–821  「裁边」
 *   - 823–835  「大图拆分」
 *   - 837–864  「旋转」
 *   - 866–881  「画质增强」
 *   - 883–915  「滤镜」
 *   - 918–930  ActionChip（→ `comicSheetParts.tsx`）
 *   - 932–974  FilterPreview
 *
 * 适配与跳过：
 *   - L936–956 `produceState` + `ComicImagePipeline.Geometry/Toning` + Bitmap：
 *     预览改为 `loader.loadPreview(page, config)` 返回 URL，用 `<img>` 渲染，
 *     `onError` 回落追光点（Adaptation #6）。几何/色调参数由 loader 侧从 config 派生。
 *   - L937 `previewKey = "${page.id}|${config.imagePipelineFingerprint()}"` → `useEffect`
 *     依赖 `[page?.id, config]`（fingerprint 的字段已全部在 config 里，等价失效键）。
 *   - L970 `contentScale = ContentScale.Crop` → `object-fit: cover`。
 *   - L963–964 `width(64.dp).aspectRatio(0.7f)` → CSS `width:64px; aspect-ratio:0.7`。
 *   - L816–820 `manualCrop != null` 时显示「清除手动裁边」→ 同条件渲染 TextButton。
 *   - L843–862 旋转本页 / 临时合页 → `pageRotationFor` / `toggleMergeAnchor`（@core/comic）。
 *   - L907–914 `重置全部滤镜` → `FILTER_RESET_PATCH`（@core/comic）。
 */
import { useEffect, useState } from 'react';
import {
  CROP_MODE_SEGMENT,
  BOOK_ROTATION_SEGMENT,
  ENHANCE_SEGMENT,
  FILTER_RESET_PATCH,
  cropModeByIndex,
  cropModeIndex,
  enhanceModeByIndex,
  enhanceOption,
  enhanceSegmentIndexOf,
  formatDegrees,
  formatGamma,
  formatInt,
  formatSplitPosition,
  imagePipelineFingerprint,
  mergeAnchorLabel,
  nextPageRotation,
  normalizeBookRotation,
  pageRotationFor,
  toggleMergeAnchor,
  type ComicSheetsBookState,
  type ComicSheetsConfig,
  type ComicSheetsPageRef,
} from '@core/comic/comicReaderSheets';
import type { ComicPreviewLoader } from './ComicSettingsSheet';
import {
  ActionChip,
  ChasingDots,
  PanelSectionCard,
  SegmentRow,
  SliderRow,
  SwitchRow,
} from './comicSheetParts';
import { ComicIcon } from './ComicIcon';

export interface ImageTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
  onOpenCrop: () => void;
  pages: readonly ComicSheetsPageRef[];
  loader: ComicPreviewLoader;
  currentRawPage: number;
  bookState: ComicSheetsBookState;
  onBookStateChange: (next: ComicSheetsBookState) => void;
}

/* ── FilterPreview（Kotlin 932–974） ── */

function FilterPreview(props: {
  page: ComicSheetsPageRef | undefined;
  loader: ComicPreviewLoader;
  config: ComicSheetsConfig;
}) {
  const { page, loader, config } = props;
  // Kotlin 936：`val previewKey = "${page.id}|${config.imagePipelineFingerprint()}"`
  const previewKey = `${page?.id ?? ''}|${imagePipelineFingerprint(config)}`;
  const [result, setResult] = useState<{ key: string; url: string | null }>({
    key: previewKey,
    url: null,
  });
  const [brokenKey, setBrokenKey] = useState<string | null>(null);

  // Kotlin 937–956 `produceState<Bitmap?>(null, previewKey) { … }`
  // 「重置为加载中」不在 effect 里同步 setState（避开 React 19 级联渲染），
  // 而是由 key 不匹配在渲染期推导——语义与 `produceState(null, previewKey)` 相同。
  //
  // 依赖说明：Kotlin 只以 `previewKey`（= `page.id|fingerprint`）为 key，
  // 而 `loadPreview` 需要整个 `config`。这里把 `config` 一并列为依赖：
  // `imagePipelineFingerprint` 覆盖了预览位图的全部字段，所以对**有损**字段
  // （亮度/裁边/旋转/…）两者完全等价；唯一多出来的副作用是 `splitReverse`
  // 这类不影响位图的开关被拨动时会多取一次预览图（结果相同，不会显示错图）。
  // 不使用 eslint 消音（REVIEW_PROTOCOL 硬规则 5）。
  useEffect(() => {
    if (page === undefined) return;
    let cancelled = false;
    void loader.loadPreview(page, config).then((url) => {
      if (cancelled) return;
      setResult({ key: previewKey, url });
    });
    return () => {
      cancelled = true;
    };
  }, [page, loader, previewKey, config]);

  const url = result.key === previewKey ? result.url : null;
  const broken = brokenKey === previewKey || url === null;

  return (
    <div className="cmcs-filterpreview">
      <div className="cmcs-filterpreview__frame">
        {url !== null && !broken ? (
          <img
            className="cmcs-filterpreview__img"
            src={url}
            alt=""
            onError={() => setBrokenKey(previewKey)}
          />
        ) : (
          <ChasingDots size={18} color="var(--cmcs-mint)" />
        )}
      </div>
    </div>
  );
}

export function ImageTab(props: ImageTabProps) {
  const { config, update, pages, loader, currentRawPage, bookState, onBookStateChange } = props;
  const pageRef = pages[currentRawPage];
  // Kotlin 872 `ComicEnhanceMode.entries[config.enhanceMode.ordinal]`
  const enh = enhanceOption(config.enhanceMode);

  return (
    <>
      {/* L783–821 裁边 */}
      <PanelSectionCard title="裁边" icon="Crop">
        <SegmentRow
          title="自动裁边"
          options={CROP_MODE_SEGMENT}
          selected={cropModeIndex(config.cropMode)}
          onSelect={(i) => update((c) => ({ ...c, cropMode: cropModeByIndex(i) }))}
        />
        <div className="cmcs-padtop6">
          <button type="button" className="cmcs-navrow" onClick={props.onOpenCrop}>
            <span className="cmcs-navrow__label">
              {config.manualCrop != null ? '手动裁边 · 已设置' : '手动裁边'}
            </span>
            <span className="cmcs-navrow__chev" aria-hidden="true">
              <ComicIcon name="ChevronRight" size={16} />
            </span>
          </button>
        </div>
        {config.manualCrop != null ? (
          <button
            type="button"
            className="cmcs-textbtn"
            onClick={() => update((c) => ({ ...c, manualCrop: null }))}
          >
            清除手动裁边
          </button>
        ) : null}
      </PanelSectionCard>

      {/* L823–835 大图拆分 */}
      <PanelSectionCard title="大图拆分" icon="VerticalSplit">
        <SwitchRow
          title="宽页自动拆分"
          subtitle="跨页扫描图拆为左右两页"
          checked={config.splitWide}
          onChange={(v) => update((c) => ({ ...c, splitWide: v }))}
        />
        <SwitchRow
          title="拆分左右反转"
          checked={config.splitReverse}
          onChange={(v) => update((c) => ({ ...c, splitReverse: v }))}
        />
        <SliderRow
          title="拆分位置"
          value={config.splitPosition}
          range={[0.3, 0.7]}
          format={formatSplitPosition}
          onChange={(v) => update((c) => ({ ...c, splitPosition: v }))}
        />
      </PanelSectionCard>

      {/* L837–864 旋转 */}
      <PanelSectionCard title="旋转" icon="RotateRight">
        <SegmentRow
          title="整本旋转"
          options={BOOK_ROTATION_SEGMENT}
          selected={normalizeBookRotation(config.bookRotation)}
          onSelect={(deg) => update((c) => ({ ...c, bookRotation: deg }))}
        />
        <div className="cmcs-actionrow">
          <RotatePageChip
            pageId={pageRef === undefined ? null : pageRef.id}
            bookState={bookState}
            onBookStateChange={onBookStateChange}
          />
          <ActionChip
            text={mergeAnchorLabel(bookState.mergeAnchors, currentRawPage)}
            onClick={() =>
              onBookStateChange({
                ...bookState,
                mergeAnchors: toggleMergeAnchor(bookState.mergeAnchors, currentRawPage),
              })
            }
          />
        </div>
      </PanelSectionCard>

      {/* L866–881 画质增强 */}
      <PanelSectionCard title="画质增强" icon="AutoAwesome">
        <SegmentRow
          title="增强引擎"
          options={ENHANCE_SEGMENT}
          selected={enhanceSegmentIndexOf(config.enhanceMode)}
          onSelect={(i) => update((c) => ({ ...c, enhanceMode: enhanceModeByIndex(i) }))}
        />
        {enh.mode !== 'OFF' ? (
          <>
            <span className="cmcs-desc">{enh.desc}</span>
            <SliderRow
              title="增强强度"
              value={config.enhanceStrength}
              range={[0, 100]}
              format={formatInt}
              onChange={(v) => update((c) => ({ ...c, enhanceStrength: Math.trunc(v) }))}
            />
          </>
        ) : null}
      </PanelSectionCard>

      {/* L883–915 滤镜 */}
      <PanelSectionCard title="滤镜" icon="Tune">
        <FilterPreview page={pageRef} loader={loader} config={config} />
        <SliderRow
          title="亮度"
          value={config.filterBrightness}
          range={[-100, 100]}
          format={formatInt}
          onChange={(v) => update((c) => ({ ...c, filterBrightness: Math.trunc(v) }))}
        />
        <SliderRow
          title="对比度"
          value={config.filterContrast}
          range={[-100, 100]}
          format={formatInt}
          onChange={(v) => update((c) => ({ ...c, filterContrast: Math.trunc(v) }))}
        />
        <SliderRow
          title="饱和度"
          value={config.filterSaturation}
          range={[-100, 100]}
          format={formatInt}
          onChange={(v) => update((c) => ({ ...c, filterSaturation: Math.trunc(v) }))}
        />
        <SliderRow
          title="色调"
          value={config.filterHue}
          range={[-180, 180]}
          format={formatDegrees}
          onChange={(v) => update((c) => ({ ...c, filterHue: Math.trunc(v) }))}
        />
        <SliderRow
          title="Gamma"
          value={config.filterGamma}
          range={[0.5, 2.2]}
          format={formatGamma}
          onChange={(v) => update((c) => ({ ...c, filterGamma: v }))}
        />
        <SliderRow
          title="锐化"
          value={config.filterSharpen}
          range={[0, 100]}
          format={formatInt}
          onChange={(v) => update((c) => ({ ...c, filterSharpen: Math.trunc(v) }))}
        />
        <SliderRow
          title="阴影"
          value={config.filterShadow}
          range={[-100, 100]}
          format={formatInt}
          onChange={(v) => update((c) => ({ ...c, filterShadow: Math.trunc(v) }))}
        />
        <SwitchRow
          title="黑白模式"
          checked={config.filterBW}
          onChange={(v) => update((c) => ({ ...c, filterBW: v }))}
        />
        <button
          type="button"
          className="cmcs-textbtn"
          onClick={() => update((c) => ({ ...c, ...FILTER_RESET_PATCH }))}
        >
          重置全部滤镜
        </button>
      </PanelSectionCard>
    </>
  );
}

/* ── 「旋转本页 +90°」（Kotlin 845–852，单独成组件避免条件内联） ── */

function RotatePageChip(props: {
  pageId: string | null;
  bookState: ComicSheetsBookState;
  onBookStateChange: (next: ComicSheetsBookState) => void;
}) {
  const current = pageRotationFor(props.bookState.pageRotations, props.pageId);
  return (
    <ActionChip
      text="旋转本页 +90°"
      onClick={() => {
        // Kotlin 846：`if (pageRef != null)` 才写回
        if (props.pageId === null) return;
        props.onBookStateChange({
          ...props.bookState,
          pageRotations: {
            ...props.bookState.pageRotations,
            [props.pageId]: nextPageRotation(current ?? 0),
          },
        });
      }}
    />
  );
}
