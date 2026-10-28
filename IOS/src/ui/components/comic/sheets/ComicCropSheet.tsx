/**
 * ComicCropSheet.tsx — 手动裁边编辑器（整屏深色 overlay，不是底部面板）。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt`）：
 *   - 1643–1728 ComicCropSheet
 *   - 1654–1660 `produceState { loader.loadPreview(page, Geometry(), Toning()) }`（小图）
 *   - 1661–1666 `crop` state：已有手动裁边则用之，否则默认 0.06/0.06/0.94/0.94
 *   - 1667–1668 `layoutSize` / `imgRect`（BoxWithImageLayout 回填）
 *   - 1670      `LocalView.current`（裁边框贴边轻触觉）
 *   - 1672–1684 `onCropChangeWithHaptic`：最小 5% 钳制 + 贴边触觉
 *   - 1686–1692 `Box(fillMaxSize, background(0xEE000000), statusBarsPadding, navigationBarsPadding)`
 *   - 1693–1704 顶栏：标题「手动裁边」+「重置」/「取消」/「保存」
 *   - 1705      提示「拖动四角调整裁剪区域（不修改原文件）」
 *   - 1708–1718 `BoxWithImageLayout { CropCanvas(...) }`
 *   - 1719–1725 底部读数 `L ..% · T ..% · R ..% · B ..%`
 *   - 1730–1772 BoxWithImageLayout（0.75 比例盒内按图片比例 fit）
 *   - 1774–1872 CropCanvas（四角 + 四边拖动；遮罩 / 裁剪框 / 三分线 / 手柄绘制）
 *
 * 适配与跳过：
 *   - L1657 `loader.loadPreview(page, Geometry(), Toning())`（**默认**几何/色调，
 *     与设置面板的实时预览不同）→ `loader.loadCropPreview(page)`，返回 URL。
 *   - L1661–1665 `remember(config.manualCrop) { … }`：`manualCrop` 变化时重取
 *     初值 —— 采用 React 官方「把 key 存进 state、渲染期比对」的写法
 *     （`cropBox.key` vs `manualCropKey`），既不 setState-in-effect 也不需要 key。
 *     已有手动裁边则用之，否则默认 0.06/0.06/0.94/0.94。
 *   - L1670 `LocalView` + `HapticsGate.enabled` + `performHapticFeedback(VIRTUAL_KEY)`：
 *     Web 无此 API → 改为 `navigator.vibrate?.(1)`（若存在），受可选 prop 控制；
 *     `HapticsGate.enabled` 由宿主通过 `hapticsEnabled` 传入。
 *   - L1742–1765 `BoxWithConstraints` + `drawW/drawH` 计算 → CSS：
 *     外层 `aspect-ratio: 0.75`，图片 `object-fit: contain`（Kotlin `ContentScale.Fit`），
 *     裁剪层绝对定位在图片绘制矩形上（用 `onLoad` 的 naturalWidth/Height 换算）。
 *   - L1837–1870 `Canvas` 绘制 → 4 块遮罩 div + 边框 div + 2×2 三分线 div +
 *     8 个手柄 div（Compose `drawRect/drawLine/drawCircle` 的 DOM 等价）。
 *     颜色/尺寸常量原样：遮罩 `0x99000000`、裁剪框 `0xFFF0D9C0` 2px、
 *     三分线 `0x66FFFFFF` 1px、手柄白 5px + `AccentColor` 3px。
 *   - L1790–1835 `pointerInput` 手势 → Pointer Events（`setPointerCapture` +
 *     `pointermove` 流），命中判定用 `cropHandleFromPoint`（@core/comic）。
 *     ⚠️ Kotlin 只在**命中手柄后进入拖动循环**时调 `onCropChangeWithHaptic`；
 *     空点（active == -1）什么都不做 —— 所以 pointerdown 上**不**触发钳制/触觉。
 *   - L1786–1787 `rememberUpdatedState`（闭包内读最新 crop）→ 拖动过程中直接读
 *     本次 render 的 `crop` 闭包（拖动是单一手势会话，无需跨 render）。
 *   - L1781 `handleR = 14.dp` → CSS 侧的 1 CSS px 恰好等于 1 dp，故直接用 14
 *     （命中半径 `14 * 1.6` px，见 @core/comic 的 CROP_HANDLE_RADIUS_PX）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCENT_COLOR,
  CROP_HANDLE_RADIUS_PX,
  DEFAULT_CROP,
  applyCropHandleDrag,
  clampCrop,
  cropHandleFromPoint,
  cropInsetsLabel,
  cropTouchesEdge,
  type ComicSheetsConfig,
  type ComicSheetsPageRef,
  type CropHandle,
} from '@core/comic/comicReaderSheets';

export interface ComicCropLoader {
  loadCropPreview(page: ComicSheetsPageRef): Promise<string | null>;
}

export interface ComicCropSheetProps {
  page: ComicSheetsPageRef | null;
  loader: ComicCropLoader;
  config: ComicSheetsConfig;
  onDismiss: () => void;
  onApply: (l: number, t: number, r: number, b: number) => void;
  /**
   * Kotlin L1670 `HapticsGate.enabled`（Web 无 `performHapticFeedback`）→
   * 由宿主注入；缺省 false（不振动），与文件头「受可选 prop 控制」一致。
   */
  hapticsEnabled?: boolean;
}

/** 裁边提示（HapticFeedbackConstants.VIRTUAL_KEY 的 Web 等价时长） */
const CROP_EDGE_VIBRATE_MS = 1;

/** Kotlin 1662–1665：`config.manualCrop?.let { floatArrayOf(it[0],…) } ?: floatArrayOf(0.06,0.06,0.94,0.94)` */
function initialCrop(manualCrop: readonly number[] | null): readonly number[] {
  if (manualCrop !== null && manualCrop.length === 4) {
    return [
      manualCrop[0] ?? 0,
      manualCrop[1] ?? 0,
      manualCrop[2] ?? 1,
      manualCrop[3] ?? 1,
    ];
  }
  return [...DEFAULT_CROP];
}

/* ── 图片 + 裁剪画布（Kotlin 1708–1718 / 1730–1772 / 1774–1872） ── */

function CropStage(props: {
  src: string | null;
  crop: readonly number[];
  onCropChange: (raw: readonly number[]) => void;
  hapticsEnabled: boolean;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // Kotlin 1742–1751：按图片内在比例在 0.75 比例盒内 fit（drawW/drawH）
  const measure = useCallback(() => {
    const el = frameRef.current;
    if (el === null) return;
    setBox({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useEffect(() => {
    measure();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const draw =
    box !== null && ratio !== null && ratio > 0
      ? box.w / box.h > ratio
        ? { w: box.h * ratio, h: box.h }
        : { w: box.w, h: box.w / ratio }
      : null;

  const dragRef = useRef<{ handle: CropHandle; pointerId: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draw === null || box === null) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    // 命中判定基于「上一次调整后」的最新框位置
    const handle = cropHandleFromPoint(
      props.crop,
      rect.width,
      rect.height,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    if (handle === -1) return;
    dragRef.current = { handle, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || draw === null || box === null) return;
    if (e.pointerId !== drag.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    // 派生基准 = 最新 crop（连续交替拖动四边互不回退）
    props.onCropChange(applyCropHandleDrag(props.crop, drag.handle, px, py));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag !== null && e.currentTarget.hasPointerCapture(drag.pointerId)) {
      e.currentTarget.releasePointerCapture(drag.pointerId);
    }
  };

  if (props.src === null) {
    // Kotlin 1767–1770：未出图时显示追光点
    return (
      <div className="cmcs-cropstage cmcs-cropstage--loading">
        <span className="cmcs-chasing" aria-hidden="true">
          {Array.from({ length: 6 }, (_unused, i) => (
            <span
              key={i}
              className="cmcs-chasing__dot"
              style={{
                width: 36 * 0.25,
                height: 36 * 0.25,
                background: 'var(--cmcs-mint)',
                animationDelay: `${i * 100}ms`,
              }}
            />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className="cmcs-cropstage">
      <div className="cmcs-cropstage__box" ref={frameRef}>
        <img
          className="cmcs-cropstage__img"
          src={props.src}
          alt=""
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        {draw !== null ? (
          <CropOverlay
            width={draw.w}
            height={draw.h}
            crop={props.crop}
            hapticsEnabled={props.hapticsEnabled}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── CropCanvas 的 DOM 等价（Kotlin 1836–1871） ── */

function CropOverlay(props: {
  width: number;
  height: number;
  crop: readonly number[];
  hapticsEnabled: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const c = props.crop;
  const x0 = (c[0] ?? 0) * props.width;
  const y0 = (c[1] ?? 0) * props.height;
  const x1 = (c[2] ?? 1) * props.width;
  const y1 = (c[3] ?? 1) * props.height;

  const handles: ReadonlyArray<readonly [number, number]> = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
    [(x0 + x1) / 2, y0],
    [(x0 + x1) / 2, y1],
    [x0, (y0 + y1) / 2],
    [x1, (y0 + y1) / 2],
  ];

  return (
    <div
      className="cmcs-cropcanvas"
      style={{ width: props.width, height: props.height }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      role="application"
      aria-label="裁剪区域"
    >
      {/* 外部半透明遮罩（4 块，Kotlin 1844–1847） */}
      <div className="cmcs-cropdim" style={{ left: 0, top: 0, width: props.width, height: y0 }} />
      <div
        className="cmcs-cropdim"
        style={{ left: 0, top: y1, width: props.width, height: Math.max(0, props.height - y1) }}
      />
      <div className="cmcs-cropdim" style={{ left: 0, top: y0, width: x0, height: Math.max(0, y1 - y0) }} />
      <div
        className="cmcs-cropdim"
        style={{ left: x1, top: y0, width: Math.max(0, props.width - x1), height: Math.max(0, y1 - y0) }}
      />
      {/* 裁剪框（Kotlin 1849–1853） */}
      <div
        className="cmcs-cropframe"
        style={{ left: x0, top: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }}
      />
      {/* 三分线（Kotlin 1855–1860，1..2） */}
      {[1, 2].map((i) => {
        const gx = x0 + ((x1 - x0) * i) / 3;
        const gy = y0 + ((y1 - y0) * i) / 3;
        return (
          <div key={i} className="cmcs-cropgrid">
            <div className="cmcs-cropgrid__v" style={{ left: gx, top: y0, height: Math.max(0, y1 - y0) }} />
            <div className="cmcs-cropgrid__h" style={{ top: gy, left: x0, width: Math.max(0, x1 - x0) }} />
          </div>
        );
      })}
      {/* 手柄（Kotlin 1862–1868） */}
      {handles.map((p, i) => (
        <span
          key={i}
          className="cmcs-crophandle"
          style={{ left: p[0], top: p[1] }}
          data-touch={props.hapticsEnabled && cropTouchesEdge(props.crop) ? 'edge' : undefined}
        >
          <span className="cmcs-crophandle__outer" />
          <span className="cmcs-crophandle__inner" style={{ background: ACCENT_COLOR }} />
        </span>
      ))}
    </div>
  );
}

export function ComicCropSheet(props: ComicCropSheetProps) {
  // Kotlin L1653 `val page = page`：本组件的失效键与预览来源
  const page = props.page;
  const pageKey = page?.id ?? '';
  // Kotlin 1654–1660 `produceState<Bitmap?>(null, page.id)`：以 page.id 为失效键，
  // 「重置为加载中」由 key 不匹配在渲染期推导（不在 effect 里同步 setState）。
  const [result, setResult] = useState<{ key: string; url: string | null }>({
    key: pageKey,
    url: null,
  });

  // Kotlin 1661–1665
  //   `var crop by remember(config.manualCrop) { manualCrop?.let{…} ?: floatArrayOf(0.06,…) }`
  // 「key 变了就重新取初值」。React 官方等价写法：把 key 一起存进 state，
  // 渲染期比对 key，不一致就用新初值覆盖（不在 effect 里 setState）。
  const manualCrop = props.config.manualCrop;
  const manualCropKey = manualCrop === null ? 'none' : manualCrop.join(',');
  const [cropBox, setCropBox] = useState<{ key: string; crop: readonly number[] }>(() => ({
    key: manualCropKey,
    crop: initialCrop(manualCrop),
  }));
  const crop = cropBox.key === manualCropKey ? cropBox.crop : initialCrop(manualCrop);
  // Kotlin 1661 `mutableStateOf(...)` / L1683 `crop = raw.copyOf()` 的唯一写入口
  const setCrop = useCallback(
    (next: readonly number[]) => setCropBox({ key: manualCropKey, crop: next }),
    [manualCropKey],
  );

  // 触觉开关（Kotlin `HapticsGate.enabled`）：可选 prop，未传即关闭。
  const hapticsEnabled = props.hapticsEnabled ?? false;

  useEffect(() => {
    if (page === null) return;
    let cancelled = false;
    void props.loader.loadCropPreview(page).then((url) => {
      if (cancelled) return;
      setResult({ key: page.id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [page, props.loader]);

  const src = result.key === pageKey ? result.url : null;

  // Kotlin 1672–1684：最小 5% 钳制 + 贴边触觉（Web：navigator.vibrate）
  const onCropChange = useCallback(
    (raw: readonly number[]) => {
      const next = clampCrop(raw);
      if (cropTouchesEdge(next) && hapticsEnabled) {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(CROP_EDGE_VIBRATE_MS);
        }
      }
      setCrop(next);
    },
    [hapticsEnabled, setCrop],
  );

  // Kotlin 1653 `if (page == null) return`
  if (page === null) return null;

  return (
    <div className="cmcs-cropsheet" role="dialog" aria-modal="true" aria-label="手动裁边">
      <div className="cmcs-cropsheet__head">
        <span className="cmcs-cropsheet__title">手动裁边</span>
        <div className="cmcs-cropsheet__spacer" />
        <button
          type="button"
          className="cmcs-cropsheet__btn"
          onClick={() => setCrop([...DEFAULT_CROP])}
        >
          重置
        </button>
        <button type="button" className="cmcs-cropsheet__btn" onClick={props.onDismiss}>
          取消
        </button>
        <button
          type="button"
          className="cmcs-cropsheet__btn cmcs-cropsheet__btn--primary"
          onClick={() => props.onApply(crop[0] ?? 0, crop[1] ?? 0, crop[2] ?? 1, crop[3] ?? 1)}
        >
          保存
        </button>
      </div>
      <span className="cmcs-cropsheet__hint">拖动四角调整裁剪区域（不修改原文件）</span>

      <div className="cmcs-cropsheet__gap12" />
      <CropStage src={src} crop={crop} onCropChange={onCropChange} hapticsEnabled={hapticsEnabled} />
      <div className="cmcs-cropsheet__gap8" />
      <span className="cmcs-cropsheet__readout">{cropInsetsLabel(crop)}</span>
    </div>
  );
}

/** 句柄半径（导出便于测试对齐 Kotlin 1781 `handleR = 14.dp`） */
export const CMCS_CROP_HANDLE_RADIUS = CROP_HANDLE_RADIUS_PX;
