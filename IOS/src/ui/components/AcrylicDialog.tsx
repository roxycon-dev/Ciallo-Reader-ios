import { type CSSProperties, type ReactNode } from 'react';
import { parseHex, withAlpha } from '../../core/glass/color';
import { adaptiveDialogWidthStyle, adaptiveSheetWidthStyle } from '../../core/glass/adaptiveSpec';
import {
  GLASS_FALLBACK_ALPHA_BOOST,
  filmGrainLayerCss,
  iridescentBorderCss,
  radialGlassScrimCss,
  supportsRealtimeBlur,
} from '../../core/glass/liquidGlass';
import { consistentShadow } from '../../core/glass/shadowGlow';
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
  /**
   * Kotlin L53 `MaterialTheme.colorScheme.surface.copy(alpha = surfaceAlpha)` ——
   * **主题的 surface**，不是写死的白色。深色主题下它是深灰（`Theme.kt` 的
   * `surface = #1C1C1E`），此前端口写死 `#FFFFFF`，深色下弹窗变成一块白玻璃。
   */
  surface?: string;
}): Record<string, string> {
  const radius = options.radius ?? 24;
  const surfaceAlpha = options.surfaceAlpha ?? 0.5;
  const surface = options.surface ?? '#FFFFFF';
  const primaryRgb = parseHex(options.primary) ?? { r: 5, g: 150, b: 105 };
  const black = { r: 0, g: 0, b: 0 };
  return {
    borderRadius: `${radius}px`,
    // Kotlin L55-66 两次 `consistentShadow`：
    //   32.dp → ambient primary@0.14 / spot primary@0.18
    //    8.dp → ambient black@0.18   / spot black@0.22
    // 每一层的有效 alpha 还要 × `SHADOW_*_ALPHA_GAIN = 0.10`（ShadowGlow.kt L229/L230），
    // 且 spot 层额外下移 `elevation × 0.28`、模糊 `σ = elevation × 0.22`。
    // 此前端口写的是 `0 32px 64px primary@0.14` —— alpha **没有 ×0.10**（浓 10 倍）
    // 而且把 elevation 当成了「向下偏移 32px」。
    boxShadow:
      `${consistentShadow({
        elevationPx: 32,
        ambientRgb: [primaryRgb.r, primaryRgb.g, primaryRgb.b],
        ambientAlpha: 0.14,
        spotRgb: [primaryRgb.r, primaryRgb.g, primaryRgb.b],
        spotAlpha: 0.18,
      })}, ${consistentShadow({
        elevationPx: 8,
        ambientRgb: [black.r, black.g, black.b],
        ambientAlpha: 0.18,
        spotRgb: [black.r, black.g, black.b],
        spotAlpha: 0.22,
      })}`,
    // 顶棱抛光聚光带 (2.5dp) 叠在 125° 对角镜面光束之上
    backgroundColor: withAlpha(surface, surfaceAlpha),
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
  /** Kotlin `MaterialTheme.colorScheme.surface` —— 面板底色（深色主题别再用白）。 */
  surface?: string;
  /** Test id passthrough. */
  'data-testid'?: string;
  childrenClassName?: string;
}

/** 统一亚克力弹窗：径向遮罩 + 玻璃面板 + 主题一致的按钮区。 */
export function AcrylicDialog(props: AcrylicDialogProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const shapeRadius = props.shapeRadius ?? 24;
  const panel = acrylicPanelStyle({
    radius: shapeRadius,
    primary,
    secondary,
    ...(props.surface === undefined ? {} : { surface: props.surface }),
  });
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
                    // Kotlin `GlassDialogWindowEffect` 只做 `createBlurEffect(blurPx)`
                    // （WindowBackdrop.kt L53 `GlassWindowBlur.acquire(…, blurRadiusPx * progress)`）——
                    // 没有 `colorControls`/`vibrancy`，所以这里**不加** `saturate()`。
                    WebkitBackdropFilter: `blur(${ACRYLIC_BLUR_DP}px)`,
                    backdropFilter: `blur(${ACRYLIC_BLUR_DP}px)`,
                  }
                : {
                    // API < 31 无 RenderEffect：面板本体加厚，弥补没有真实模糊
                    // （LiquidGlass.kt L199-206 同一口径）
                    backgroundColor: withAlpha(
                      props.surface ?? '#FFFFFF',
                      Math.min(1, 0.5 + GLASS_FALLBACK_ALPHA_BOOST),
                    ),
                  }),
              ...adaptiveDialogWidthStyle(0.86),
            }}
          >
            {/* filmGrain(alpha = 0.035f) */}
            <span className="acrylic-panel__grain" style={{ ['--film-grain' as string]: film }} />
            {/* iridescentBorder(prismColors, 1.5.dp, 0.38f) —— Kotlin 在 acrylicPanel
                里只画这一层（`crystalInnerBevel` 是 GodMomentSheet 自己的追加）。 */}
            <PrismLayer shapeRadius={shapeRadius} primary={primary} secondary={secondary} />
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
 * `iridescentBorder(shape, prismColors, 1.5.dp, 0.38f)` —— **只有这一层**。
 *
 * 修正：过去这里还叠了一条 `crystalInnerBevel(1.dp)`。查 Kotlin：
 * `Modifier.acrylicPanel`（AcrylicDialog.kt L69-75）只调用 `filmGrain` 与
 * `iridescentBorder`，`crystalInnerBevel` 在全仓的唯一调用点是
 * `GodMomentSheet.kt:221`（那是个更重的面板，另算）。所以亚克力面板上多出来的
 * 那圈 1dp 内棱是端口自加的。
 */
function PrismLayer(props: { shapeRadius: number; primary: string; secondary: string }): ReactNode {
  return (
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
  );
}

export interface AcrylicBottomOverlayProps {
  onDismissRequest: () => void;
  children: ReactNode;
  /** AcrylicDialog.kt line 164 — RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp) */
  shapeRadius?: number;
  primary?: string;
  secondary?: string;
  /** Kotlin `MaterialTheme.colorScheme.surface` —— 面板底色。 */
  surface?: string;
  /** Kotlin L153 `dismissOnBackgroundClick`：点遮罩是否关闭（默认 true）。 */
  dismissOnBackgroundClick?: boolean;
  /** Kotlin L154 `fitAvailableHeight`：高度取 `maxHeight * 0.9`，底部留 16dp。 */
  fitAvailableHeight?: boolean;
  /** Kotlin L155 `decoratePanel`：false 时不挂亚克力面板（只保留内容）。 */
  decoratePanel?: boolean;
  /** Kotlin L156 `uniformScrim`：遮罩用纯黑而不是径向渐变。 */
  uniformScrim?: boolean;
  /** 视口是否为横屏（`adaptiveSheetWidth()` 的 840dp 分支）。 */
  landscape?: boolean;
}

/**
 * 底部悬浮亚克力面板（下载中心等）：Dialog + decorView 实时模糊 + 径向遮罩。
 *
 * 修正：此前端口只有 `onDismissRequest` / `shapeRadius` / 主题色四个入参，
 * Kotlin 的 `dismissOnBackgroundClick` / `fitAvailableHeight` / `decoratePanel` /
 * `uniformScrim` 四个开关**全部没有**，`maxHeight * 0.9f` 与
 * `padding(bottom = 16.dp)` 也没落 —— 内容高的面板会顶到安全区外。
 */
export function AcrylicBottomOverlay(props: AcrylicBottomOverlayProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const shapeRadius = props.shapeRadius ?? 24;
  const decoratePanel = props.decoratePanel !== false;
  const fitAvailableHeight = props.fitAvailableHeight === true;
  const panel = acrylicPanelStyle({
    radius: shapeRadius,
    surfaceAlpha: 0.4,
    primary,
    secondary,
    ...(props.surface === undefined ? {} : { surface: props.surface }),
  });

  return (
    <div className="acrylic-bottom-overlay" role="dialog" aria-modal="true">
      <ScrimEntrance>
        <div
          className="acrylic-dialog-scrim"
          style={
            props.uniformScrim === true
              ? { background: 'rgba(0, 0, 0, 0.36)' }
              : { backgroundImage: radialGlassScrimCss() }
          }
          onClick={() => {
            if (props.dismissOnBackgroundClick !== false) props.onDismissRequest();
          }}
        />
      </ScrimEntrance>
      <BottomSheetEntrance className="acrylic-bottom-overlay__sheet">
        <div
          className="acrylic-panel acrylic-panel--bottom"
          style={{
            ...(decoratePanel ? panel : {}),
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            ...(decoratePanel && supportsRealtimeBlur()
              ? {
                  WebkitBackdropFilter: `blur(${ACRYLIC_BLUR_DP}px)`,
                  backdropFilter: `blur(${ACRYLIC_BLUR_DP}px)`,
                }
              : {}),
            ...adaptiveSheetWidthStyle(props.landscape === true),
            // Kotlin L185 `val sheetHeight = maxHeight * .9f`（配合
            // L172 `padding(bottom = 16.dp)`），否则走 `navigationBarsPadding()`。
            ...(fitAvailableHeight
              ? {
                  height: '90dvh',
                  paddingBottom: 16,
                }
              : {}),
          }}
        >
          {decoratePanel ? (
            <span
              className="acrylic-panel__grain"
              style={{ ['--film-grain' as string]: filmGrainLayerCss(0.035) }}
            />
          ) : null}
          {/* AcrylicDialog.kt L192 `acrylicPanel(shape, surfaceAlpha = 0.40f)` 的
              iridescentBorder —— 此前还多挂了一条 Kotlin 没有的 bevel。 */}
          {decoratePanel ? (
            <PrismLayer shapeRadius={shapeRadius} primary={primary} secondary={secondary} />
          ) : null}
          {props.children}
        </div>
      </BottomSheetEntrance>
    </div>
  );
}