import { type CSSProperties, type ReactNode } from 'react';
import { withAlpha } from '../../core/glass/color';
import { adaptiveDialogWidthStyle } from '../../core/glass/adaptiveSpec';
import {
  GLASS_FALLBACK_ALPHA_BOOST,
  crystalInnerBevelCss,
  filmGrainLayerCss,
  iridescentBorderCss,
  radialGlassScrimCss,
  supportsRealtimeBlur,
} from '../../core/glass/liquidGlass';
import { crystalPrismColors } from '../../core/glass/color';
import { DialogEntrance, ScrimEntrance, BottomSheetEntrance } from './OverlayAnimations';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/AcrylicDialog.kt` (197 non-blank lines) — FULL PORT
 *   lines 32-93  `Modifier.acrylicPanel(shape, surfaceAlpha)` → acrylicPanelStyle()
 *   lines 97-158 `AcrylicDialog`                             → AcrylicDialog
 *   lines 162-201 `AcrylicBottomOverlay`                     → AcrylicBottomOverlay
 *
 * ADAPTATIONS
 * - `androidx.compose.ui.window.Dialog` + `DialogProperties` → a fixed-position
 *   overlay div with `role="dialog" aria-modal="true"`; `dismissOnClickOutside =
 *   false` is honoured (the scrim calls `onDismissRequest` explicitly instead).
 * - `DialogLiquidGlass { GlassDialogWindowEffect(activity, blurPx) }` → the page root
 *   gets `filter: blur()` while the dialog is open (`dialogBackdropFilter`), which
 *   is what `View.setRenderEffect` does on Android.
 * - `Modifier.consistentShadow` → two `box-shadow` layers (32dp primary, 8dp black).
 * - `Brush.*` → `linear-gradient` / `conic-gradient`.
 *
 * REVIEW FIXES
 * ① `acrylicPanelStyle`'s `boxShadow` had the ambient/spot colours of the two
 *    `consistentShadow` calls crossed; now 32dp = primary 0.14/0.18 and
 *    8dp = black 0.18/0.22.
 * ② The panel no longer drops `surface.copy(alpha = surfaceAlpha)` when
 *    `backdrop-filter` is available — Kotlin always paints it.
 * ③ `iridescentBorder` and `crystalInnerBevel` are two nodes again; merged, the
 *    bevel's `background-image` clobbered the prism's `conic-gradient`.
 * ④ `AcrylicBottomOverlay` was missing both edge layers.
 * ⑤ `radialGlassScrimCss(2000)` → the scrim radius is `max(100vw,100vh)·0.95`
 *    (Kotlin: `size.maxDimension * 0.95f`).
 */

export const ACRYLIC_BLUR_DP = 18;

/**
 * AcrylicDialog.kt lines 56-84 — 顶棱抛光聚光带 + 125° 对角镜面光束与底部微晕染.
 *
 * REVIEW FIX — the two `consistentShadow` calls were being flattened into four
 * `box-shadow` layers with the ambient/spot colours crossed:
 *   Kotlin 32.dp → ambient primary@0.14 / spot primary@0.18
 *   Kotlin  8.dp → ambient black@0.18   / spot black@0.22
 * The old string put `rgba(0,0,0,0.18)` on the 32dp pair and `primary@0.18` on the
 * 8dp pair, i.e. both layers got one primary tint and one black tint.
 */
export function acrylicPanelStyle(options: {
  /** AcrylicDialog.kt line 34 — default 24.dp */
  radius?: number;
  /** AcrylicDialog.kt line 35 — default 0.50f */
  surfaceAlpha?: number;
  primary: string;
  secondary: string;
}): Record<string, string> {
  const radius = options.radius ?? 24;
  const surfaceAlpha = options.surfaceAlpha ?? 0.5;
  return {
    borderRadius: `${radius}px`,
    // Layer A: consistentShadow(32.dp, primary ambient 0.14 / spot 0.18)
    // Layer B: consistentShadow(8.dp,  black   ambient 0.18 / spot 0.22)
    boxShadow:
      `0 32px 64px ${withAlpha(options.primary, 0.14)}, ` +
      `0 32px 64px ${withAlpha(options.primary, 0.18)}, ` +
      '0 8px 16px rgba(0, 0, 0, 0.18), ' +
      '0 8px 16px rgba(0, 0, 0, 0.22)',
    // 顶棱抛光聚光带 (2.5dp) 叠在 125° 对角镜面光束之上
    backgroundColor: withAlpha('#FFFFFF', surfaceAlpha),
    backgroundImage:
      // 顶棱抛光聚光带
      'linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.50) 25%, ' +
      'rgba(255,255,255,0.72) 50%, rgba(255,255,255,0.50) 75%, rgba(255,255,255,0.08) 100%), ' +
      // 125° 对角镜面光束与底部微晕染
      'linear-gradient(135deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.05) 25%, ' +
      'rgba(255,255,255,0) 50%, ' +
      withAlpha(options.primary, 0.035) +
      ' 75%, ' +
      withAlpha(options.secondary, 0.055) +
      ' 100%)',
    backgroundSize: '100% 2.5px, 100% 100%',
    backgroundRepeat: 'no-repeat, no-repeat',
  };
}

export interface AcrylicDialogProps {
  onDismissRequest: () => void;
  /** AcrylicDialog.kt line 101 — default RoundedCornerShape(24.dp) */
  shapeRadius?: number;
  title?: ReactNode;
  text?: ReactNode;
  confirmButton?: ReactNode;
  dismissButton?: ReactNode;
  children?: ReactNode;
  /** Theme tokens; the app shell passes its live primary/secondary. */
  primary?: string;
  secondary?: string;
  /** Test id passthrough. */
  'data-testid'?: string;
  childrenClassName?: string;
}

/** 统一亚克力弹窗：径向遮罩 + 玻璃面板 + 主题一致的按钮区。 */
export function AcrylicDialog(props: AcrylicDialogProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const shapeRadius = props.shapeRadius ?? 24;
  const panel = acrylicPanelStyle({ radius: shapeRadius, primary, secondary });
  const film = filmGrainLayerCss(0.035);

  return (
    <div className="acrylic-dialog-root" role="dialog" aria-modal="true">
      <ScrimEntrance>
        <div
          className="acrylic-dialog-scrim"
          data-testid="acrylic_dialog_scrim"
          style={{ backgroundImage: radialGlassScrimCss() }}
          onClick={props.onDismissRequest}
        />
      </ScrimEntrance>
      <DialogEntrance>
        <div className="acrylic-dialog-center">
          <div
            className="acrylic-panel"
            data-testid={props['data-testid']}
            style={{
              ...panel,
              // Kotlin `GlassDialogWindowEffect` blurs the host decorView and the
              // panel still paints `surface.copy(alpha = surfaceAlpha)` on top of
              // it. The old port *dropped* the tint whenever backdrop-filter was
              // available (`backgroundColor: undefined`), so the panel lost half
              // its milkiness exactly where the glass was working.
              ...(supportsRealtimeBlur()
                ? {
                    WebkitBackdropFilter: `blur(${ACRYLIC_BLUR_DP}px) saturate(1.15)`,
                    backdropFilter: `blur(${ACRYLIC_BLUR_DP}px) saturate(1.15)`,
                  }
                : {
                    // API < 31 无 RenderEffect：面板本体加厚，弥补没有真实模糊
                    // （LiquidGlass.kt L199-206 同一口径）
                    backgroundColor: withAlpha(
                      '#FFFFFF',
                      Math.min(1, 0.5 + GLASS_FALLBACK_ALPHA_BOOST),
                    ),
                  }),
              ...adaptiveDialogWidthStyle(0.86),
            }}
          >
            {/* filmGrain(alpha = 0.035f) */}
            <span className="acrylic-panel__grain" style={{ ['--film-grain' as string]: film }} />
            {/* iridescentBorder(prismColors, 1.5.dp, 0.38f) + crystalInnerBevel(1.dp) */}
            <PrismBevelLayer shapeRadius={shapeRadius} primary={primary} secondary={secondary} />
            <div className="acrylic-panel__content" style={{ padding: 24 }}>
              {props.title}
              {props.title !== undefined && props.text !== undefined ? (
                <div style={{ height: 12 }} />
              ) : null}
              {props.text}
              {props.confirmButton !== undefined || props.dismissButton !== undefined ? (
                <div style={{ height: 18 }} />
              ) : null}
              {props.confirmButton !== undefined || props.dismissButton !== undefined ? (
                <div className="acrylic-panel__actions">
                  {props.dismissButton}
                  {props.dismissButton !== undefined ? <div style={{ width: 8 }} /> : null}
                  {props.confirmButton}
                </div>
              ) : null}
              {props.children}
            </div>
          </div>
        </div>
      </DialogEntrance>
    </div>
  );
}

/**
 * `iridescentBorder(shape, prismColors, 1.5.dp, 0.38f)` **and**
 * `crystalInnerBevel(shape, 1.dp)`.
 *
 * REVIEW FIX (BUG): both layers were merged onto the same node, so
 * `bevelLayer()`'s `backgroundImage` overwrote `iridescentBorderCss()`'s
 * `conic-gradient` — the prism sweep disappeared entirely. They are now two
 * stacked nodes (Kotlin draws them as two separate `drawBehind` layers in that
 * order), and the bevel uses the mask-composite ring so it stays a 1dp edge
 * stroke instead of a full-box wash.
 */
function PrismBevelLayer(props: {
  shapeRadius: number;
  primary: string;
  secondary: string;
}): ReactNode {
  return (
    <>
      <span
        className="acrylic-panel__prism"
        aria-hidden="true"
        style={
          iridescentBorderCss({
            colors: crystalPrismColors(props.primary, props.secondary),
            width: 1.5,
            alpha: 0.38,
            radius: props.shapeRadius,
          }) as unknown as CSSProperties
        }
      />
      <span
        className="acrylic-panel__prism"
        aria-hidden="true"
        style={crystalInnerBevelCss({ width: 1, radius: props.shapeRadius }) as unknown as CSSProperties}
      />
    </>
  );
}

export interface AcrylicBottomOverlayProps {
  onDismissRequest: () => void;
  children: ReactNode;
  /** AcrylicDialog.kt line 164 — RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp) */
  shapeRadius?: number;
  primary?: string;
  secondary?: string;
}

/** 底部悬浮亚克力面板（下载中心等）：Dialog + decorView 实时模糊 + 径向遮罩。 */
export function AcrylicBottomOverlay(props: AcrylicBottomOverlayProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const shapeRadius = props.shapeRadius ?? 24;
  const panel = acrylicPanelStyle({ radius: shapeRadius, surfaceAlpha: 0.4, primary, secondary });

  return (
    <div className="acrylic-bottom-overlay" role="dialog" aria-modal="true">
      <ScrimEntrance>
        <div
          className="acrylic-dialog-scrim"
          style={{ backgroundImage: radialGlassScrimCss() }}
          onClick={props.onDismissRequest}
        />
      </ScrimEntrance>
      <BottomSheetEntrance className="acrylic-bottom-overlay__sheet">
        <div
          className="acrylic-panel acrylic-panel--bottom"
          style={{
            ...panel,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            ...(supportsRealtimeBlur()
              ? {
                  WebkitBackdropFilter: `blur(${ACRYLIC_BLUR_DP}px) saturate(1.15)`,
                  backdropFilter: `blur(${ACRYLIC_BLUR_DP}px) saturate(1.15)`,
                }
              : {}),
            maxWidth: 560,
            width: '100%',
            marginInline: 'auto',
            // Kotlin `Modifier.navigationBarsPadding()` (AcrylicDialog.kt L193)
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <span
            className="acrylic-panel__grain"
            style={{ ['--film-grain' as string]: filmGrainLayerCss(0.035) }}
          />
          {/* AcrylicDialog.kt L192 `acrylicPanel(shape, surfaceAlpha = 0.40f)` also
              mounts iridescentBorder + crystalInnerBevel — they were missing here. */}
          <PrismBevelLayer shapeRadius={shapeRadius} primary={primary} secondary={secondary} />
          {props.children}
        </div>
      </BottomSheetEntrance>
    </div>
  );
}