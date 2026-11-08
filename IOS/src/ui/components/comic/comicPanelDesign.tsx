/**
 * comicPanelDesign.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicPanelDesign.kt`（339 行 / 非空 323 行）
 * 中的 **React 组件部分**。纯逻辑部分（颜色 / 滑条几何）在 `src/core/comic/comicPanelDesign.ts`。
 *
 * ══════════ 漫画面板设计系统（第七轮第 3 条） ══════════
 *  苹果式精致/克制路线的阅读设置面板组件族：模块化玻璃卡片、图标 Tab、
 *  带明确背景色块的选中态、统一的自绘滑条与开关。全部组件只依赖既有的
 *  Panel* 色彩令牌与品牌薄荷绿，无霓虹/发光/重投影——高级感来自留白、
 *  层级、控件比例与材质，而不是堆装饰。书架（第 5 条）与隐私窗口（第 6 条）
 *  沿用同一套语言。
 *
 * Kotlin 行号 → TS 对照：
 *   L1-L52   import（Compose / graphics / gestures）→ 见「跳过说明」
 *   L62-L63  PanelCardBg / PanelCardStroke → core 的 PANEL_CARD_BG / PANEL_CARD_STROKE
 *   L66-L72  selectedBg() / selectedStroke() → core 的 panelSelectedBg / panelSelectedStroke(mint)
 *   L74-L77  PanelSectionCard KDoc → 保留在组件上方
 *   L78-L106 internal fun PanelSectionCard(title, icon, modifier, content)
 *            → PanelSectionCard({ title, icon, children })
 *   L108-L109 internal data class PanelTabData(val label, val icon: ImageVector)
 *            → PanelTabData（label: string, icon: ReactNode）
 *   L111-L114 PanelTabRow KDoc → 保留
 *   L115-L163 internal fun PanelTabRow(tabs, selected, onSelect, modifier)
 *            → PanelTabRow({ tabs, selected, onSelect })
 *   L165-L170 PanelSlider KDoc → 保留
 *   L171-L280 internal fun PanelSlider(value, onValueChange, valueRange,
 *              onValueChangeFinished, steps, enabled, modifier, reverse)
 *            → PanelSlider(props) + ComicPanelSliderTrack（Canvas → CSS）
 *   L282-L285 PanelSwitch KDoc → 保留
 *   L286-L321 internal fun PanelSwitch(checked, onChange, modifier) → PanelSwitch(props)
 *   L323-L328 private fun lerpColor → core 的 comicPanelLerpColor
 *   L330-L332 panelSelectedBg() → core 的 panelSelectedBg
 *   L334-L336 panelSelectedStroke() → core 的 panelSelectedStroke
 *   L338-L339 internal data class PanelBgSwatch(label, fill, gradient: Brush?)
 *            → 形状声明在 core（PanelBgSwatch）
 *
 * 跳过说明：
 *   · `ImageVector`（L41/L97/L109/L146）→ Material 图标在 Web 端无内建矢量字体，
 *     与本项目其它模块一致改为 `ReactNode`（调用方传入 SVG）。语义等价。
 *   · `@Composable` / `@OptIn(ExperimentalLayoutApi::class)`：纯编译期标记，无运行期行为。
 *   · `Modifier` 链 → 全部落到 `comicChrome.css` 的类名（该文件里逐行注明 Kotlin 行号）。
 *   · `MintPrimary`（L67/L69/L72/L97/L149/L155/L243-L245/L297/L307）是
 *     `@Composable getter`（MaterialTheme 动态取色），core 不能读 DOM →
 *     由 `resolveComicMintPrimary()` 从 CSS 变量 `--color-primary` 解析后注入
 *     （fallback `#059669`，与 reader.css 的 `--rd-primary` 同一约定）。
 *   · `BoxWithConstraints`（L194）+ `LocalDensity`（L185）→ `getBoundingClientRect()`
 *     + dp→px 1:1 换算（本项目统一约定）。
 *   · `rememberUpdatedState`（L186-L187）→ `useRef` 持有最新回调（见 PanelSlider）。
 *   · Compose `Canvas` + `drawRoundRect/drawCircle`（L246-L278）→ CSS 绝对定位轨道
 *     （`border-radius: trackH/2`）与圆形光环/圆钮。选择 CSS 而非 SVG 的原因：
 *     SVG `preserveAspectRatio="none"` 会把圆形拉成椭圆，需 JS 测量宽度才能保圆；
 *     CSS 的 `left: x%` + `border-radius: 50%` 在任意宽度下都保持正圆，
 *     且无需在 render 期读 ref（见下方「React 19 lint 合规说明」）。
 *     绘制顺序（轨道 → 填充 → 光环 → 圆钮）与几何常量逐行搬到 core（PANEL_SLIDER_*）。
 *   · `animateFloatAsState(spring(DampingRatioLowBouncy, stiffness = 1400f))`（L292-L296）
 *     → CSS `transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)`
 *     （超调曲线对应 LowBouncy；Web 无弹簧引擎，走本项目既有的 CSS 曲线惯例）。
 *
 * React 19 lint 合规说明：
 *   · PanelSlider **不在 render 期读 ref.current**：trackWidth 只在 pointerdown /
 *     keydown 回调里读（与 Compose 在 `pointerInput` 协程里读 `size.width` 同为事件期读取）。
 *   · 整个模块无 `Math.random()` / `Date.now()`。
 *   · PanelTabRow 的 `.map()` 回调里**不调任何 hook**：Tab 是无状态 `<button>`。
 */
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  PANEL_CARD_BG,
  PANEL_CARD_STROKE,
  PANEL_SLIDER_HEIGHT_DP,
  PANEL_SLIDER_PRESS_RING_R_DISABLED_DP,
  PANEL_SLIDER_PRESS_RING_R_DP,
  PANEL_SLIDER_RING_STROKE_DP,
  PANEL_SLIDER_THUMB_R_DP,
  PANEL_SLIDER_TRACK_H_DP,
  PANEL_SWITCH_BASE_OFFSET_DP,
  PANEL_SWITCH_TRAVEL_DP,
  comicPanelLerpColor,
  comicPanelWithAlpha,
  panelSelectedBg,
  panelSelectedStroke,
  panelSliderFraction,
  panelSliderPosToValue,
  panelSliderSnap,
  type FloatRange,
} from '@core/comic/comicPanelDesign';
import '../../../styles/comicChrome.css';

/** MintPrimary（MaterialTheme.colorScheme.primary）的 Web 端取值。
 *  漫画 chrome 为深色面板，统一取品牌薄荷绿 `#059669`；读取 CSS 变量以尊重用户自定义主色。 */
export const COMIC_MINT_FALLBACK = '#059669'

export function resolveComicMintPrimary(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return COMIC_MINT_FALLBACK
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
  // 只接受 3/6 位十六进制（comicPanelLerpColor 的解析器支持范围），其余回落
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : COMIC_MINT_FALLBACK
}

/** 面板设计令牌（本文件内部使用；CSS 侧同名变量见 comicChrome.css）。 */
export const PANEL_DESIGN_TOKENS = {
  cardBg: PANEL_CARD_BG,
  cardStroke: PANEL_CARD_STROKE,
} as const

/**
 * 模块化玻璃卡片：面板内每个功能区块的容器。
 * 独立圆角卡片形成清晰的视觉分组（替代"标题文字 + 留白"的旧分隔方式）。
 * ── Android L78-L106 ──
 */
export function PanelSectionCard(props: {
  title?: string | null
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="comic-panel-card">
      {props.title != null ? (
        <>
          {/* Android L95-L101: Row(CenterVertically) { icon?.let { … }; Text(title) } */}
          <div className="comic-panel-card__head">
            {props.icon != null ? (
              <>
                {/* Android L97: tint = MintPrimary.copy(alpha = 0.9f), size 15dp */}
                <span
                  className="comic-panel-card__head-icon"
                  style={{ color: comicPanelWithAlpha(resolveComicMintPrimary(), 0.9) }}
                >
                  {props.icon}
                </span>
                <span className="comic-panel-card__head-gap6" />
              </>
            ) : null}
            <span className="comic-panel-card__title">{props.title}</span>
          </div>
          {/* Android L102: Spacer(Modifier.height(8.dp)) */}
          <span className="comic-panel-card__gap8" />
        </>
      ) : null}
      {/* Android L104: content()（ColumnScope 作用域 → Web 直接 children） */}
      {props.children}
    </div>
  )
}

/** Tab 定义（图标 + 文字） ── Android L108-L109 ── */
export interface PanelTabData {
  readonly label: string
  /** Android: `icon: ImageVector` → Web: ReactNode（SVG） */
  readonly icon: ReactNode
}

/**
 * 图标 Tab 导航行：作为完整导航区域设计——图标在上文字在下，统一高度与间距，
 * 选中 = 薄荷半透明填充 + 细边框（不再只靠文字变色），未选中弱化。
 * ── Android L115-L163 ──
 */
export function PanelTabRow(props: {
  tabs: readonly PanelTabData[]
  selected: number
  onSelect: (index: number) => void
}) {
  const mint = resolveComicMintPrimary()
  return (
    // Android L122-L128: Row(clip r14).background(PanelChipBg).padding(4.dp) + spacedBy(3.dp)
    <div
      className="comic-panel-tabs"
      style={
        {
          '--comic-tab-active-bg': panelSelectedBg(mint),
          '--comic-tab-active-stroke': panelSelectedStroke(mint),
        } as CSSProperties
      }
    >
      {props.tabs.map((tab, i) => {
        const active = i === props.selected
        return (
          <button
            key={tab.label}
            type="button"
            className={active ? 'comic-panel-tabs__tab comic-panel-tabs__tab--active' : 'comic-panel-tabs__tab'}
            aria-pressed={active}
            onClick={() => {
              props.onSelect(i)
            }}
          >
            {/* Android L147: Icon(tint = if (active) MintPrimary else Color(0x99FFFFFF), size 17dp) */}
            <span
              className="comic-panel-tabs__icon"
              style={{ color: active ? mint : 'rgba(255, 255, 255, 0.6)' }}
            >
              {tab.icon}
            </span>
            {/* Android L152: Spacer(Modifier.height(3.dp)) */}
            <span className="comic-panel-tabs__gap3" />
            {/* Android L153-L159: 选中 MintPrimary/SemiBold，未选中 Color(0xAAFFFFFF)/Normal */}
            <span
              className={
                active ? 'comic-panel-tabs__label comic-panel-tabs__label--active' : 'comic-panel-tabs__label'
              }
              style={{ color: active ? mint : 'rgba(255, 255, 255, 0.667)' }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Android L100: `val slop = viewConfiguration.touchSlop`（平台默认 8dp → 8px）。 */
const TOUCH_SLOP_PX = 8

/**
 * 面板统一滑条（自绘）：细玻璃轨道 + 薄荷填充 + 白色圆钮（轻按压光环）。
 * 全面板唯一的滑条样式（纸纹/间距/滤镜/增强强度等共用），与 FluidSlider 的
 * 液态语言同源但为紧凑面板做了收敛——不放大尺寸、不加气泡。
 * 水平位移超过 slop 且水平分量占优才接管（与外层垂直滚动正确仲裁）。
 * ── Android L171-L280 ──
 */
export function PanelSlider(props: {
  value: number
  onValueChange: (value: number) => void
  valueRange: FloatRange
  onValueChangeFinished?: () => void
  steps?: number
  enabled?: boolean
  /** Android: `modifier: Modifier` → Web 用 `className` / `style` / `contentDescription` 代替 */
  reverse?: boolean
  /** Android L515-L518: `Modifier.semantics { contentDescription; progressBarRangeInfo }` */
  contentDescription?: string
}) {
  const steps = props.steps ?? 0
  const enabled = props.enabled ?? true
  const reverse = props.reverse ?? false
  const [rangeStart, rangeEnd] = props.valueRange
  const trackRef = useRef<HTMLDivElement | null>(null)
  // ── Android L186-L187: `rememberUpdatedState` → ref 持有最新回调 ──
  //     （react-hooks/refs 规则禁止在 render 期写 ref，故在 effect 里同步；
  //       effect 先于任何用户事件运行，语义与 rememberUpdatedState 一致）
  const latestOnValueChange = useRef(props.onValueChange)
  const latestOnValueChangeFinished = useRef(props.onValueChangeFinished)
  useEffect(() => {
    latestOnValueChange.current = props.onValueChange
    latestOnValueChangeFinished.current = props.onValueChangeFinished
  }, [props.onValueChange, props.onValueChangeFinished])

  // ── Android L182-L184: fraction 计算（core: panelSliderFraction） ──
  const fraction = panelSliderFraction(props.value, props.valueRange)

  /** ── Android L201-L205: `fun posToValue(x: Float): Float`（事件期读 trackWidth） ── */
  const posToValue = useCallback(
    (x: number): number => {
      const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 0
      if (trackWidth <= 0) return rangeStart
      return panelSliderPosToValue(x, trackWidth, props.valueRange, steps, reverse)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, reverse, rangeStart, rangeEnd],
  )

  /** ── Android L198-L236: `pointerInput { awaitEachGesture { … } }` ── */
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Android L199: `if (!enabled) return@pointerInput`
      if (!enabled) return
      const slop = TOUCH_SLOP_PX
      // Android L202: 用相对节点坐标（Compose 的 PointerInputChange.position 已是节点局部坐标）
      const rect = event.currentTarget.getBoundingClientRect()
      // Android L207-L210: `val down = awaitFirstDown(...); totalX / totalY / dragging`
      const downX = event.clientX - rect.left
      let totalX = 0
      let totalY = 0
      let dragging = false
      let lastClientX = event.clientX
      let lastClientY = event.clientY
      let finished = false

      // Pointer Events 适配：capture 到指针后 move/up 稳定送达同一目标
      event.currentTarget.setPointerCapture(event.pointerId)

      const finish = (): void => {
        // Android L215-L220: 抬起分支
        if (finished) return
        finished = true
        if (!dragging && Math.abs(totalX) < slop) {
          // Android L216-L217: 视为点击定位 → 立即 change + finished
          latestOnValueChange.current(posToValue(downX))
          latestOnValueChangeFinished.current?.()
        } else if (dragging) {
          latestOnValueChangeFinished.current?.()
        }
      }

      const onMove = (moveEvent: PointerEvent): void => {
        // Android L223-L226: `val dx = change.positionChange().x` 等并累加
        const dx = moveEvent.clientX - lastClientX
        const dy = moveEvent.clientY - lastClientY
        lastClientX = moveEvent.clientX
        lastClientY = moveEvent.clientY
        totalX += dx
        totalY += dy
        // Android L227-L229: 水平过 slop 且水平占优才接管
        if (!dragging && Math.abs(totalX) > slop && Math.abs(totalX) > Math.abs(totalY)) dragging = true
        // Android L230-L233: dragging 时上报 + `change.consume()`
        if (dragging) {
          latestOnValueChange.current(posToValue(moveEvent.clientX - rect.left))
          moveEvent.preventDefault()
        }
      }

      // Android L213-L222: `if (!change.pressed) { … break }` —— pointerup / pointercancel 同分支
      const onUp = (): void => {
        finish()
        cleanup()
      }
      const onCancel = (): void => {
        finish()
        cleanup()
      }
      const cleanup = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        const host = trackRef.current
        if (host !== null && host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    },
    [enabled, posToValue],
  )

  /** Android 无键盘等价物；补 role="slider" 的无障碍可达性（aria-*，不改视觉）。 */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return
      const span = rangeEnd - rangeStart
      // 与 Android 的 steps 离散化保持同一档位语义
      const nudge = span / (steps > 0 ? steps + 1 : 50)
      let next: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = props.value - nudge
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = props.value + nudge
      else if (event.key === 'Home') next = rangeStart
      else if (event.key === 'End') next = rangeEnd
      if (next === null) return
      event.preventDefault()
      const clamped = Math.min(Math.max(next, rangeStart), rangeEnd)
      const snapped =
        reverse || span === 0
          ? clamped
          : rangeStart + panelSliderSnap((clamped - rangeStart) / span, steps) * span
      latestOnValueChange.current(snapped)
      latestOnValueChangeFinished.current?.()
    },
    [enabled, props.value, steps, reverse, rangeStart, rangeEnd],
  )

  const mint = resolveComicMintPrimary()
  // ── Android L243-L245: DrawScope 不是组合作用域，MintPrimary 需在组合期取值 ──
  const fillEnabled = comicPanelWithAlpha(mint, 0.9) // MintPrimary.copy(alpha = 0.9f)
  const fillDisabled = comicPanelWithAlpha(mint, 0.35) // MintPrimary.copy(alpha = 0.35f)
  const ringColor = comicPanelWithAlpha(mint, 0.18) // MintPrimary.copy(alpha = 0.18f)

  return (
    <div
      ref={trackRef}
      className={enabled ? 'comic-panel-slider' : 'comic-panel-slider comic-panel-slider--disabled'}
      style={{ height: PANEL_SLIDER_HEIGHT_DP }}
      role="slider"
      tabIndex={enabled ? 0 : -1}
      aria-label={props.contentDescription}
      aria-valuemin={rangeStart}
      aria-valuemax={rangeEnd}
      aria-valuenow={props.value}
      aria-valuetext={String(props.value)}
      aria-orientation="horizontal"
      aria-disabled={!enabled}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <ComicPanelSliderTrack
        fraction={fraction}
        enabled={enabled}
        reverse={reverse}
        fillEnabled={fillEnabled}
        fillDisabled={fillDisabled}
        ringColor={ringColor}
      />
    </div>
  )
}

/**
 * ── Android L238-L278 的绘制层 ──
 * `Canvas(Modifier.fillMaxSize()) { … }` → 绝对定位的 CSS 层。
 * 绘制顺序：轨道（L249-L256）→ 填充（L257-L262）→ 光环（L263-L271）→ 圆钮（L272-L277），
 * 几何常量逐行取自 core（PANEL_SLIDER_TRACK_H_DP / THUMB_R / PRESS_RING_R / RING_STROKE / HEIGHT）。
 * `cx = trackWidth * (if (reverse) 1f - fraction else fraction)`（L248）→ `left: x%`。
 */
function ComicPanelSliderTrack(props: {
  fraction: number
  enabled: boolean
  reverse: boolean
  fillEnabled: string
  fillDisabled: string
  ringColor: string
}) {
  const trackH = PANEL_SLIDER_TRACK_H_DP
  const thumbR = PANEL_SLIDER_THUMB_R_DP
  // Android L240: `val pressRingR = with(density) { (if (enabled) 12.dp else 10.dp).toPx() }`
  const pressRingR = props.enabled ? PANEL_SLIDER_PRESS_RING_R_DP : PANEL_SLIDER_PRESS_RING_R_DISABLED_DP
  // Android L247: `val cy = size.height / 2f`（高度固定 30dp）
  const cy = PANEL_SLIDER_HEIGHT_DP / 2
  // Android L248: `val cx = trackWidth * (if (reverse) 1f - fraction else fraction)`
  const cxPercent = (props.reverse ? 1 - props.fraction : props.fraction) * 100
  // Android L261: `size = Size((trackWidth * fraction).coerceAtLeast(trackH), trackH)`
  // → 百分比宽度 + trackH 兜底（Android 的 `.coerceAtLeast(trackH)` 同义）
  const fillWidth = Math.max(props.fraction * 100, (trackH / PANEL_SLIDER_HEIGHT_DP) * 100)
  // Android L260: `topLeft = Offset(if (reverse) cx else 0f, cy - trackH / 2)`
  const fillLeft = props.reverse ? cxPercent - fillWidth : 0
  // Android L274: `if (enabled) Color(0xFFFFFFFF) else Color(0xAAFFFFFF)`
  const thumbFill = props.enabled ? '#FFFFFF' : '#FFFFFFAA'
  const layerStyle: CSSProperties = {
    position: 'absolute',
    top: cy - trackH / 2,
    height: trackH,
    // Android L250/L252: `cornerRadius = CornerRadius(trackH / 2)`
    borderRadius: trackH / 2,
  }

  return (
    <>
      {/* Android L249-L256: 轨道 `Color(0x2EFFFFFF)`，width = trackWidth */}
      <div
        aria-hidden="true"
        style={{ ...layerStyle, left: 0, width: '100%', background: 'rgba(255, 255, 255, 0.18)' }}
      />
      {/* Android L257-L262: 填充 `if (enabled) fillEnabled else fillDisabled` */}
      <div
        aria-hidden="true"
        style={{
          ...layerStyle,
          left: `${fillLeft}%`,
          width: `${fillWidth}%`,
          background: props.enabled ? props.fillEnabled : props.fillDisabled,
        }}
      />
      {/* Android L263-L271: 光环（克制：低透明度描边圈，不做发光；禁用时收起） */}
      {props.enabled ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${cxPercent}%`,
            top: cy - pressRingR,
            width: pressRingR * 2,
            height: pressRingR * 2,
            // Android L269: `style = Stroke(width = 1.dp.toPx())`
            border: `${PANEL_SLIDER_RING_STROKE_DP}px solid ${props.ringColor}`,
            borderRadius: '50%',
            transform: 'translateX(-50%)',
            boxSizing: 'border-box',
          }}
        />
      ) : null}
      {/* Android L272-L277: 圆钮 */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${cxPercent}%`,
          top: cy - thumbR,
          width: thumbR * 2,
          height: thumbR * 2,
          borderRadius: '50%',
          background: thumbFill,
          transform: 'translateX(-50%)',
        }}
      />
    </>
  )
}

/**
 * 面板统一开关（自绘玻璃胶囊）：品牌绿轨道 + 白色圆钮弹性滑动，
 * 与 M3 Switch 相比更轻薄、与玻璃面板同材质。全面板唯一开关样式。
 * ── Android L286-L321 ──
 */
export function PanelSwitch(props: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const mint = resolveComicMintPrimary()
  // ── Android L292: `animateFloatAsState(targetValue = if (checked) 1f else 0f, …)` →
  //    Web 端用 CSS transition 驱动（.tsx 文件头已注明曲线近似），
  //    轨道/描边色仍按 Kotlin 的 lerpColor 端点逐字计算。 ──
  const t = props.checked ? 1 : 0
  // Android L297: `lerpColor(Color(0x33FFFFFF), MintPrimary.copy(alpha = 0.85f), t)`
  const trackColor = comicPanelLerpColor('#FFFFFF33', comicPanelWithAlpha(mint, 0.85), t)
  // Android L307: `lerpColor(Color(0x2EFFFFFF), MintPrimary.copy(alpha = 0.6f), t)`
  const strokeColor = comicPanelLerpColor('#FFFFFF2E', comicPanelWithAlpha(mint, 0.6), t)
  return (
    // Android L300-L310: width 46 / height 28 / clip Circle / background / border / clickableNoRipple
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className="comic-panel-switch"
      style={{ background: trackColor, borderColor: strokeColor }}
      onClick={() => {
        props.onChange(!props.checked)
      }}
    >
      {/* Android L312-L319: align(CenterStart).offset { (3dp + t * travel) }.size(22.dp).background(White) */}
      <span
        className={props.checked ? 'comic-panel-switch__knob comic-panel-switch__knob--on' : 'comic-panel-switch__knob'}
        style={{
          // Android L315: `IntOffset((3.dp.toPx() + t * travel).roundToInt(), 0)`
          transform: `translate(${PANEL_SWITCH_BASE_OFFSET_DP + t * PANEL_SWITCH_TRAVEL_DP}px, -50%)`,
        }}
      />
    </button>
  )
}

/** 导出 core 的滑条离散化，供 chrome 侧语义值计算复用（Android L189-L192）。 */
export { panelSliderSnap }

/** `Color.copy(alpha=)` 与值域类型的重导出：chrome 侧（comicReaderChrome）从本模块取用，
 *  与 `panelSliderSnap` / `PanelBgSwatch` 同一约定（一处 import 即可）。 */
export { comicPanelWithAlpha }
export type { FloatRange } from '@core/comic/comicPanelDesign'

/** 背景类型色卡形状（Android L338-L339）的重导出，方便 UI 侧一处 import。 */
export type { PanelBgSwatch } from '@core/comic/comicPanelDesign'
