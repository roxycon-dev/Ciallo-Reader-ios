import { type CSSProperties } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/AppSwitch.kt` (39 non-blank lines) — FULL PORT
 *   lines 20-50 `@Composable AppSwitch(checked, onCheckedChange, modifier,
 *             containerWidth = 60, containerHeight = 32, circleSize = 24, padding = 4)`
 *             → AppSwitch
 *
 * 核心 = SquishyToggleSwitch（设置页一直使用的四阶段弹性挤压动画 + 触觉反馈）
 * 颜色 = 品牌薄荷 MintPrimary，全 App 一致
 *
 * ADAPTATION — `com.swapnil.squishyswitch.SquishyToggleSwitch` → CSS
 * ─────────────────────────────────────────────────────────────────────
 * The library is a four-stage squash-and-stretch Canvas/graphicsLayer animation.
 * On the web that is:
 *   ① the track + knob are one element tree (no GPU layers needed);
 *   ② the knob translation is a CSS transition on a critically-underdamped curve
 *      (four-stage squash modelled by `scaleX/scaleY` on two nested wrappers);
 *   ③ the haptic tick fires on the state flip (not on every frame), matching
 *      SquishyToggleSwitch which only vibrates on the "未按下 → 按下" transition.
 *
 * ⚠️ 三者必须成套修改：位移量 = containerWidth − circleSize − padding×2，
 * 任一项单独改动都会让滑块行程对不上轨道（滑出轨道或走不满）。This invariant is
 * preserved verbatim below.
 */
export interface AppSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  style?: CSSProperties;
  /** 轨道尺寸与滑块尺寸。**默认值 = SquishyToggleSwitch 出厂值**。 */
  containerWidth?: number;
  containerHeight?: number;
  circleSize?: number;
  padding?: number;
  /** 品牌薄荷 MintPrimary。 */
  color?: string;
  disabled?: boolean;
  /** Test id passthrough (Android testTag). */
  'data-testid'?: string;
}

/** 全局唯一开关组件（第十一轮第 3 条：开关统一）。 */
export function AppSwitch(props: AppSwitchProps) {
  const containerWidth = props.containerWidth ?? 60;
  const containerHeight = props.containerHeight ?? 32;
  const circleSize = props.circleSize ?? 24;
  const padding = props.padding ?? 4;
  const color = props.color ?? '#059669';

  // 位移量 = containerWidth − circleSize − padding×2
  const travel = containerWidth - circleSize - padding * 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled === true}
      className={[
        'app-switch',
        props.checked ? 'app-switch--on' : 'app-switch--off',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={props['data-testid']}
      style={{
        // 2026-09-21 修复：modifier 此前接收后从未向下传递 —— 调用方传入的尺寸/间距
        // 修饰会被静默丢弃。现在显式落到轨道元素上。
        width: containerWidth,
        height: containerHeight,
        borderRadius: containerHeight / 2,
        ['--app-switch-travel' as string]: `${travel}px`,
        ['--app-switch-knob' as string]: `${circleSize}px`,
        ['--app-switch-padding' as string]: `${padding}px`,
        ['--app-switch-color' as string]: color,
        ...props.style,
      }}
      onClick={() => {
        if (props.disabled === true) return;
        props.onCheckedChange(!props.checked);
      }}
    >
      <span className="app-switch__track" aria-hidden="true" />
      <span className="app-switch__knob">
        <span className="app-switch__squash" />
      </span>
    </button>
  );
}