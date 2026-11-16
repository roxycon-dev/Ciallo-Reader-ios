/**
 * CardAppearancePage.tsx — line-by-line port of Android
 * `com/example/ui/CardAppearanceScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/CardAppearanceScreen.kt`, 187 lines / 176 non-blank).
 *
 * Kotlin → TS line map
 * ────────────────────
 *   L1-30    package + Compose imports                 → React imports; Compose/Android imports SKIPPED
 *   L32-38   `CardAppearanceScreen(tw: CardTweaks, updateCardTweaks: ((CardTweaks) -> CardTweaks) -> Unit,
 *            onBack)`                                  → `CardAppearancePageProps` (same three names)
 *   L39-40   `pressPreview = !LocalReduceMotion.current && !LocalRenderQuality.current.minimal`
 *                                                       → `pressPreview` (props `reduceMotion` / `minimalQuality`)
 *   L41      `GlassManagementPage("自定义卡片参数", "APPEARANCE / CARDS", onBack)`
 *                                                       → `.page` + `TabScreenHeader`
 *   L43-75   `AdaptiveWorkspace(controls = { … })`      → CSS container branch at 1040px
 *                                                       (`widthIn(max = 1040.dp)`); the preview becomes the
 *                                                       sticky column, exactly like the Kotlin `controls` slot.
 *   L47      `key(tw.cornerRadiusDp, tw.blurRadiusDp, tw.tintMix, tw.cardAlpha) { … }`
 *                                                       → React `key` on the preview node (same four fields)
 *   L48-51   `CompositionLocalProvider(LocalCardTweaks provides tw, LocalWenkuMainSurface provides true)`
 *                                                       → `CardTweaksProvider tweaks={tw}` (same
 *                                                       `@core/glass/cardTweaks` values); `LocalWenkuMainSurface`
 *                                                       has no web counterpart (it only suppresses nested
 *                                                       glass inside Wenku pages — see 「未移植」).
 *   L52-72   `GlassCard(onClick = if (pressPreview) ({}) else null, contentPadding 16/12)`
 *                                                       → `<GlassCard>`; `onClick` only when `pressPreview`
 *   L57-71   Row(heightIn 72.dp, spacedBy 12.dp) + `WenkuIcon(Layers)` + Column("实时预览", desc)
 *                                                       → `.card-appearance__preview-*`
 *   L64      `tr("实时预览")`                             → `实时预览`
 *   L66      `if (pressPreview) tr("按住卡片边缘，查看倾斜与压力反馈") else tr("圆角、色调与不透明度即时更新")`
 *                                                       → same ternary
 *   L77-81   LazyColumn(spacedBy 14.dp, contentPadding 24/8/24/24) → `.card-appearance__list`
 *   L82-115  item("finish") `WenkuContentPanel` + `tr("表面与色调")` + 4 sliders
 *                                                       → `<CardTweakPanel title="表面与色调">`
 *   L86-92   `壁纸玻璃模糊（自定义壁纸＋高或极致画质）` 8…40dp  → slider #1
 *   L93-99   `卡片圆角` 2…48dp                            → slider #2
 *   L100-106 `主题色叠加浓度` 0%…30%                       → slider #3
 *   L107-113 `卡片不透明度` 40%…100%                       → slider #4
 *   L116-149 item("contact") `WenkuContentPanel` + `tr("倾斜与按压")` + 4 sliders
 *                                                       → `<CardTweakPanel title="倾斜与按压">`
 *   L120-126 `3D 倾斜最大角度` 0°…15°（position = sqrt(v/15)） → slider #5
 *   L127-133 `立体透视强度（越大越立体）` 平面…立体           → slider #6
 *   L134-140 `压力形变强度` 0%…200%                        → slider #7
 *   L141-147 `压力形变半径` 0.5×…2.5×                      → slider #8
 *   L150-155 item("reset") `WenkuTextButton("重置默认", { updateCardTweaks { CardTweaks() } }, Refresh)`
 *                                                       → `<AppButton>重置默认</AppButton>` (AppButton.tsx)
 *   L162-187 `CardTweakSlider(label, valueText, position, startText, endText, onChange)`
 *                                                       → `CardTweakSlider` (exported, same six params)
 *
 * ── Value fidelity (逐字对照) ──────────────────────────────────────────────────────
 *  * 八个滑杆的 `valueText` / `position` / 区间端点 / 反解公式与 Kotlin 一一对应：
 *      blur      : `${v}dp`        pos=(v-8)/32     v'=8+v*32     8…40
 *      corner    : `${v}dp`        pos=(v-2)/46     v'=2+v*46     2…48
 *      tintMix   : `${v*100}%`     pos=v/0.3        v'=v*0.3      0%…30%
 *      cardAlpha : `${v*100}%`     pos=(v-0.4)/0.6  v'=0.4+v*0.6  40%…100%
 *      tiltMaxDeg: `${v.toFixed(1)}°` pos=sqrt(v/15) v'=v*v*15    0°…15°
 *      camera    : `${(12-v)/9*100}%` pos=(12-v)/9   v'=12-v*9     平面…立体
 *      pressStr  : `${v*100}%`     pos=v/2          v'=v*2        0%…200%
 *      pressRad  : `×${v.toFixed(1)}` pos=(v-0.5)/2 v'=0.5+v*2    0.5×…2.5×
 *    `Float.toInt()`（向零截断）→ `Math.trunc`；`"%.1f"` → `toFixed(1)`。
 *  * 默认值 = `CardTweaks()`（`PreferencesManager` 的 9 个 key 出厂值），
 *    复用 `@core/glass/cardTweaks#DEFAULT_CARD_TWEAKS`（22 / 16 / 6 / 5 / 0.42 / 0.08 / 1.25 / 1.1 / 1）。
 *  * 重置分支逐字照抄：`updateCardTweaks { CardTweaks() }` → `update(() => ({ ...DEFAULT_CARD_TWEAKS }))`
 *    （返回**全新**实例，等价于 Kotlin 的 `CardTweaks()` 构造）。
 *
 * ── Adaptations ──────────────────────────────────────────────────────────────────
 *  * `com.ramotion.fluidslider.FluidSlider`（气泡 + 形变）→ 原生 `<input type="range">`
 *    + 项目玻璃轨道样式：`min=0 max=1 step=0.001`（position 域与 Kotlin 完全一致，
 *    `coerceIn(0f, 1f)` 也照抄）。气泡在 hover / focus / 拖动时显示 `valueText`。
 *    FluidSlider 的「形变」是按压位移的自绘效果，Web 用 `:active` 放大拇指代替。
 *  * `Widget.CardTweakSlider` 的 `Column` 没有 `verticalArrangement`，间距来自 FluidSlider
 *    自带的 8dp 气泡预留区 → CSS `.card-appearance__card { gap: 8px }`。
 *  * `updateCardTweaks` 保持 Kotlin 的「传函数」语义；未接线时页面内部自持 `useState`，
 *    因此本页可以独立挂载（`value` + `onChange` 为受控用法，二者都写时以 `value` 为准）。
 *  * 未移植：`LocalWenkuMainSurface provides true`（Wenku 页面内的嵌套玻璃抑制开关，
 *    iOS 无对应渲染路径）、`LocalRenderQuality.minimal`（只影响 `pressPreview`，
 *    由 props 传入后语义一致）。
 */

import { useState, type ReactElement } from 'react';
import { AppButton } from '@ui/components/AppButton';
import { CardTweaksProvider } from '@ui/components/CardTweaks';
import { GlassCard } from '@ui/components/GlassCard';
import { TabScreenHeader } from '@ui/components/TabScreenHeader';
import {
  DEFAULT_CARD_TWEAKS,
  type CardTweaks,
} from '@core/glass/cardTweaks';
import { DESIGN_TOKENS } from '@ui/theme/tokens';
import '../../styles/cardAppearance.css';

/**
 * Kotlin `tw: CardTweaks` — the nine persisted card parameters.
 * `CardTweaks` itself is the line-by-line port of `ui/components/CardTweaks.kt`,
 * so the screen reuses it instead of inventing a parallel value type.
 */
export type CardAppearanceValue = CardTweaks;

/** Kotlin `CardTweaks()` — the出厂 defaults (`PreferencesManager` initial values). */
export const DEFAULT_CARD_APPEARANCE: CardTweaks = DEFAULT_CARD_TWEAKS;

export interface CardAppearancePageProps {
  /** Kotlin `tw: CardTweaks` — controlled value. Omitted ⇒ the page owns its own draft. */
  value?: CardTweaks;
  /**
   * Kotlin `updateCardTweaks: ((CardTweaks) -> CardTweaks) -> Unit`.
   * Receives the transform, not the result — identical to the Kotlin call sites
   * (`updateCardTweaks { it.copy(blurRadiusDp = 8f + v * 32f) }`).
   */
  updateCardTweaks?: (update: (current: CardTweaks) => CardTweaks) => void;
  /** Convenience observer for the same transform's result (web-only; not in Kotlin). */
  onChange?: (next: CardTweaks) => void;
  /** Kotlin `onBack: () -> Unit`. */
  onBack?: () => void;
  /** Kotlin `LocalReduceMotion.current`. */
  reduceMotion?: boolean;
  /** Kotlin `LocalRenderQuality.current.minimal`. */
  minimalQuality?: boolean;
}

/** `%.1f` / `%.1f°` / `×%.1f` — Kotlin's `String.format` with one decimal. */
export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/** `(tw.tintMix * 100).toInt()` etc. — Kotlin `Float.toInt()` truncates toward zero. */
export function percentText(fraction: number): string {
  return `${String(Math.trunc(fraction * 100))}%`;
}

/**
 * Kotlin `CardAppearanceScreen` (L32-160).
 *
 * Every slider writes through `updateCardTweaks` with the Kotlin transform verbatim, so the
 * persisted `PreferencesManager.card*` keys stay in the caller's hands (no global store writes
 * from this file).
 */
export function CardAppearancePage(props: CardAppearancePageProps): ReactElement {
  const [draft, setDraft] = useState<CardTweaks>(() => props.value ?? DEFAULT_CARD_TWEAKS);
  const tw = props.value ?? draft;
  // Kotlin L40 `pressPreview = !LocalReduceMotion.current && !LocalRenderQuality.current.minimal`
  const pressPreview = props.reduceMotion !== true && props.minimalQuality !== true;

  const update = (transform: (current: CardTweaks) => CardTweaks): void => {
    const next = transform(tw);
    if (props.updateCardTweaks !== undefined) props.updateCardTweaks(transform);
    else setDraft(next);
    props.onChange?.(next);
  };

  return (
    <div className="page card-appearance-page">
      <TabScreenHeader
        title="自定义卡片参数"
        subtitle="APPEARANCE / CARDS"
        {...(props.onBack === undefined
          ? {}
          : {
              leading: (
                <button
                  type="button"
                  className="settings-header-back"
                  onClick={props.onBack}
                  aria-label="返回"
                >
                  <ArrowBackIcon />
                </button>
              ),
            })}
      />

      <div className="card-appearance__layout">
        {/*
          Kotlin L47 `key(tw.cornerRadiusDp, tw.blurRadiusDp, tw.tintMix, tw.cardAlpha)`：
          the sample layer is rebuilt whenever its painted surface changes.
        */}
        <div
          key={`${String(tw.cornerRadiusDp)}-${String(tw.blurRadiusDp)}-${String(tw.tintMix)}-${String(tw.cardAlpha)}`}
          className="card-appearance__preview-part"
        >
          <CardTweaksProvider tweaks={tw}>
            <GlassCard
              radius={DESIGN_TOKENS.radius.lg}
              padding={0}
              {...(pressPreview ? { onClick: () => undefined } : {})}
            >
              <div className="card-appearance__preview">
                <span className="card-appearance__preview-icon">
                  <LayersIcon />
                </span>
                <div className="card-appearance__preview-text">
                  <p className="card-appearance__preview-title">实时预览</p>
                  <p className="card-appearance__preview-desc">
                    {pressPreview ? '按住卡片边缘，查看倾斜与压力反馈' : '圆角、色调与不透明度即时更新'}
                  </p>
                </div>
              </div>
            </GlassCard>
          </CardTweaksProvider>
        </div>

        <div className="card-appearance__list">
          <div className="card-appearance__part" style={{ ['--ca-part' as string]: 2 }}>
            <CardTweakPanel title="表面与色调">
              <CardTweakSlider
                label="壁纸玻璃模糊（自定义壁纸＋高或极致画质）"
                valueText={`${String(Math.trunc(tw.blurRadiusDp))}dp`}
                position={(tw.blurRadiusDp - 8) / 32}
                startText="8"
                endText="40"
                onChange={(v) => {
                  update((current) => ({ ...current, blurRadiusDp: 8 + v * 32 }));
                }}
              />
              <CardTweakSlider
                label="卡片圆角"
                valueText={`${String(Math.trunc(tw.cornerRadiusDp))}dp`}
                position={(tw.cornerRadiusDp - 2) / 46}
                startText="2"
                endText="48"
                onChange={(v) => {
                  update((current) => ({ ...current, cornerRadiusDp: 2 + v * 46 }));
                }}
              />
              <CardTweakSlider
                label="主题色叠加浓度"
                valueText={percentText(tw.tintMix)}
                position={tw.tintMix / 0.3}
                startText="0%"
                endText="30%"
                onChange={(v) => {
                  update((current) => ({ ...current, tintMix: v * 0.3 }));
                }}
              />
              <CardTweakSlider
                label="卡片不透明度"
                valueText={percentText(tw.cardAlpha)}
                position={(tw.cardAlpha - 0.4) / 0.6}
                startText="40%"
                endText="100%"
                onChange={(v) => {
                  update((current) => ({ ...current, cardAlpha: 0.4 + v * 0.6 }));
                }}
              />
            </CardTweakPanel>
          </div>

          <div className="card-appearance__part" style={{ ['--ca-part' as string]: 3 }}>
            <CardTweakPanel title="倾斜与按压">
              <CardTweakSlider
                label="3D 倾斜最大角度"
                valueText={`${oneDecimal(tw.tiltMaxDeg)}°`}
                position={Math.sqrt(tw.tiltMaxDeg / 15)}
                startText="0°"
                endText="15°"
                onChange={(v) => {
                  update((current) => ({ ...current, tiltMaxDeg: v * v * 15 }));
                }}
              />
              <CardTweakSlider
                label="立体透视强度（越大越立体）"
                valueText={percentText((12 - tw.cameraDistMult) / 9)}
                position={(12 - tw.cameraDistMult) / 9}
                startText="平面"
                endText="立体"
                onChange={(v) => {
                  update((current) => ({ ...current, cameraDistMult: 12 - v * 9 }));
                }}
              />
              <CardTweakSlider
                label="压力形变强度"
                valueText={percentText(tw.pressStrength)}
                position={tw.pressStrength / 2}
                startText="0%"
                endText="200%"
                onChange={(v) => {
                  update((current) => ({ ...current, pressStrength: v * 2 }));
                }}
              />
              <CardTweakSlider
                label="压力形变半径"
                valueText={`×${oneDecimal(tw.pressRadius)}`}
                position={(tw.pressRadius - 0.5) / 2.0}
                startText="0.5×"
                endText="2.5×"
                onChange={(v) => {
                  update((current) => ({ ...current, pressRadius: 0.5 + v * 2.0 }));
                }}
              />
            </CardTweakPanel>
          </div>

          {/* Kotlin L150-155 `WenkuTextButton("重置默认", { updateCardTweaks { CardTweaks() } }, Refresh)` */}
          <div className="card-appearance__part" style={{ ['--ca-part' as string]: 4 }}>
            <AppButton
              variant="tertiary"
              fullWidth
              icon={<RefreshIcon />}
              onClick={() => {
                update(() => ({ ...DEFAULT_CARD_TWEAKS }));
              }}
            >
              重置默认
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Kotlin `WenkuContentPanel` — same shared glass card as the rest of the app. */
function CardTweakPanel(props: { title: string; children: ReactElement[] }): ReactElement {
  return (
    <GlassCard radius={DESIGN_TOKENS.radius.lg} padding={16}>
      <div className="card-appearance__card">
        <p className="card-appearance__card-title">{props.title}</p>
        <div className="card-appearance__sliders">{props.children}</div>
      </div>
    </GlassCard>
  );
}

/**
 * Kotlin L162-187 `CardTweakSlider(label, valueText, position, startText, endText, onChange)`.
 *
 * `position.coerceIn(0f, 1f)` is reproduced; the label is also the accessible name
 * (Kotlin L184 `Modifier.semantics { contentDescription = label }`).
 */
export function CardTweakSlider(props: {
  label: string;
  valueText: string;
  position: number;
  startText: string;
  endText: string;
  onChange: (position: number) => void;
}): ReactElement {
  const position = Math.min(1, Math.max(0, props.position));
  const percent = `${String(position * 100)}%`;
  return (
    <div className="card-appearance__slider">
      <div className="card-appearance__slider-head">
        <span className="card-appearance__slider-label">{props.label}</span>
        <span className="card-appearance__slider-value">{props.valueText}</span>
      </div>
      <div className="card-appearance__slider-track">
        <span className="card-appearance__slider-fill" style={{ width: percent }} aria-hidden="true" />
        <span className="card-appearance__slider-thumb" style={{ left: percent }} aria-hidden="true" />
        <span className="card-appearance__slider-bubble" style={{ left: percent }} aria-hidden="true">
          {props.valueText}
        </span>
        <input
          className="card-appearance__range"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={position}
          aria-label={props.label}
          aria-valuetext={props.valueText}
          onChange={(event) => {
            props.onChange(Number(event.currentTarget.value));
          }}
        />
      </div>
      <div className="card-appearance__slider-ends" aria-hidden="true">
        <span>{props.startText}</span>
        <span>{props.endText}</span>
      </div>
    </div>
  );
}

function ArrowBackIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

/** Kotlin `WenkuSymbol.Layers`. */
function LayersIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z" />
    </svg>
  );
}

/** Kotlin `WenkuSymbol.Refresh`. */
function RefreshIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  );
}

export default CardAppearancePage;
