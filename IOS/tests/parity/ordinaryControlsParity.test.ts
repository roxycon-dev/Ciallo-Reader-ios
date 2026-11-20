/**
 * ordinaryControlsParity.test.ts —— `ui/components/OrdinaryControls.kt`（79 行 / 71 非空）。
 *
 * 「Standard controls keep values and callbacks while avoiding native liquid renderers.」
 * 这条 KDoc 说明了整个文件的存在理由：画质不够或用户选「普通」时，取值与回调必须
 * **一模一样**，只是不做液态渲染。所以这里要钉的不是外观，而是：
 *
 *   · `steps` 的语义（Material3 `steps = n` 是「端点之间插 n 个停靠点」，
 *     对应 `input[step] = (end - start) / (n + 1)`，不是 `/ n`）；
 *   · 双端滑块的**谁动了保另一端**（L52-54 的 if/else）；
 *   · `onDraggingChange` 只在**变化时**回调一次 + 卸载补一次 `false`（L33-39）；
 *   · `reverse` 只翻滑杆、不翻 label（L41 的 label 在 L43 的 CompositionLocal 之外）；
 *   · 分段选择器的三处尾注：`tr(label)` / `♥` / 数字角标，以及"已选中不再回调"。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LiquidSliderConfig } from '@core/glass/liquidSliderConfig';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const KT = 'ui/components/OrdinaryControls.kt';
const TSX = 'src/ui/components/OrdinaryControls.tsx';

/* ══════════════════════════════════════════════════════════════════════════════
   ① 文件头与两个入口的签名
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OrdinaryControls.kt L15-24 两个入口与 KDoc', () => {
  const src = kt(KT);

  it('L15 KDoc「keep values and callbacks while avoiding native liquid renderers」', () => {
    expect(src).toContain('Standard controls keep values and callbacks while avoiding native liquid renderers.');
    // 端口注释里这句换行了，按片段断言（Kotlin 那边是一行，已在上面逐字钉住）
    expect(repoText(TSX)).toContain('keep values and callbacks while avoiding native');
  });

  it('L18-24 `OrdinarySlider` 的十三个参数（顺序即语义）', () => {
    expect(src).toContain('internal fun OrdinarySlider(');
    for (const param of [
      'value: Float',
      'onValueChange: (Float) -> Unit',
      'valueRange: ClosedFloatingPointRange<Float>',
      'steps: Int',
      'enabled: Boolean',
      'reverse: Boolean',
      'rangeEnd: Float?',
      'minGap: Float',
      'onRangeChange: ((Float, Float) -> Unit)?',
      'onValueChangeFinished: (() -> Unit)?',
      'onDraggingChange: ((Boolean) -> Unit)?',
      'formatLabel: (Float) -> String',
    ]) {
      expect(src).toContain(param);
    }
    const tsx = repoText(TSX);
    for (const field of [
      'value: number',
      'onValueChange: (next: number) => void',
      'rangeEnd?: number',
      'minGap?: number',
      'onRangeChange?: (start: number, end: number) => void',
      'onValueChangeFinished?: () => void',
      'onDraggingChange?: (dragging: boolean) => void',
      'formatLabel: (value: number) => string',
    ]) {
      expect(tsx).toContain(field);
    }
  });

  it('L65-66 `OrdinarySegmentedSelector(options, selected, onSelect, modifier, height, fontSp)`', () => {
    expect(src).toContain('internal fun OrdinarySegmentedSelector(options: List<LiquidSegmentOption>, selected: Int,');
    expect(src).toContain('onSelect: (Int) -> Unit, modifier: Modifier, height: Dp, fontSp: Float)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② steps 与尺寸
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OrdinaryControls.kt L30 `steps.coerceIn(0, LiquidSliderConfig.MAX_STOPS)`', () => {
  const src = kt(KT);

  it('上限取 `LiquidSliderConfig.MAX_STOPS`（= 200，见 LiquidSlider.kt L28）', () => {
    expect(src).toContain('val supportedSteps = steps.coerceIn(0, LiquidSliderConfig.MAX_STOPS)');
    const slider = kt('ui/components/LiquidSlider.kt');
    expect(slider).toContain('const val MAX_STOPS = 200');
    expect(LiquidSliderConfig.MAX_STOPS).toBe(200);
    const tsx = repoText(TSX);
    expect(tsx).toContain('clamp(Math.trunc(props.steps ?? 0), 0, LiquidSliderConfig.MAX_STOPS)');
  });

  it('Material3 `steps = n` ⇒ `input[step] = (end - start) / (n + 1)`（不是 `/ n`）', () => {
    // Kotlin 把 supportedSteps 直接交给 `Slider(steps = …)` / `RangeSlider(steps = …)`
    expect(src).toContain('steps = supportedSteps, interactionSource = startInteraction,');
    expect(src).toContain('steps = supportedSteps,');
    const tsx = repoText(TSX);
    expect(tsx).toContain(
      "const step = supportedSteps > 0 ? (end - start) / (supportedSteps + 1) : 'any';",
    );
    // 显式负断言：写成 `/ supportedSteps` 会多出一档
    expect(tsx).not.toContain('(end - start) / supportedSteps');
  });

  it('L40 `Column(fillMaxWidth().height(LiquidSliderConfig.HEIGHT.dp))` —— 高度 110dp', () => {
    expect(src).toContain('Column(modifier.fillMaxWidth().height(LiquidSliderConfig.HEIGHT.dp), verticalArrangement = Arrangement.Center)');
    const slider = kt('ui/components/LiquidSlider.kt');
    expect(slider).toContain('const val HEIGHT = 110f');
    expect(LiquidSliderConfig.HEIGHT).toBe(110);
    expect(repoText(TSX)).toContain('height: `${String(LiquidSliderConfig.HEIGHT)}px`');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ 标签与反向
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OrdinaryControls.kt L41-43 标签与 `reverse`', () => {
  const src = kt(KT);

  it('L41 单值取 `formatLabel(value)`；双端中间是 ` – `（en dash），两端各自 formatLabel', () => {
    expect(src).toContain(
      'Text(if (rangeEnd == null) formatLabel(value) else "${formatLabel(value)} – ${formatLabel(rangeEnd)}",',
    );
    const tsx = repoText(TSX);
    expect(tsx).toContain('props.formatLabel(props.value)');
    expect(tsx).toContain('`${props.formatLabel(props.value)} – ${props.formatLabel(props.rangeEnd)}`');
  });

  it('L42 label 的样式是 `labelMedium` + 左右各 16dp 内边距', () => {
    expect(src).toContain('style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp))');
    expect(repoText('src/styles/liquidSegment.css')).toContain('padding: 0 16px;');
  });

  it('L43-59 `reverse` 的 CompositionLocal **只包滑杆** —— label 在它之外', () => {
    expect(src).toContain(
      'CompositionLocalProvider(LocalLayoutDirection provides if (reverse) LayoutDirection.Rtl else LayoutDirection.Ltr) {',
    );
    // label 的 Text 在 CompositionLocalProvider **之前**
    const labelIndex = src.indexOf('Text(if (rangeEnd == null) formatLabel(value)');
    const rtlIndex = src.indexOf('LocalLayoutDirection provides if (reverse)');
    expect(labelIndex).toBeGreaterThan(0);
    expect(rtlIndex).toBeGreaterThan(0);
    expect(labelIndex).toBeLessThan(rtlIndex);
    // 端口把 direction 加在滑杆那一层，不是外层容器
    const tsx = repoText(TSX);
    expect(tsx).toContain("const sliderDirection: CSSProperties =\n    props.reverse === true ? { direction: 'rtl' } : {};");
    expect(tsx).toContain('className="ordinary-slider__lane" style={sliderDirection}');
    expect(tsx).toContain('className="ordinary-slider__pair" style={sliderDirection}');
    // 外层 `.ordinary-slider` 的 style 里不再有 direction
    expect(tsx).not.toContain("...(props.reverse === true ? { direction: 'rtl' } : null)");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ 双端滑块的夹紧
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OrdinaryControls.kt L49-57 双端滑块', () => {
  const src = kt(KT);

  it('L49 `gap = minGap.coerceIn(0f, end - start)`', () => {
    expect(src).toContain('val gap = minGap.coerceIn(0f, valueRange.endInclusive - valueRange.start)');
    expect(repoText(TSX)).toContain('const gap = clamp(props.minGap ?? 0, 0, end - start);');
  });

  it('L50-51 `start = value.coerceIn(start, end - gap)`、`end = rangeEnd.coerceIn(start + gap, end)`', () => {
    expect(src).toContain('val start = value.coerceIn(valueRange.start, valueRange.endInclusive - gap)');
    expect(src).toContain('val end = rangeEnd.coerceIn(start + gap, valueRange.endInclusive)');
    const tsx = repoText(TSX);
    expect(tsx).toContain('const rangeStart = clamp(props.value, start, end - gap);');
    expect(tsx).toContain('const rangeEnd = clamp(props.rangeEnd ?? end, rangeStart + gap, end);');
  });

  it('L52-54 「谁动了保另一端」：起点动了夹起点、终点动了夹终点', () => {
    expect(src).toContain('if (next.start != start) onRangeChange?.invoke(next.start.coerceAtMost(next.endInclusive - gap), next.endInclusive)');
    expect(src).toContain('else onRangeChange?.invoke(next.start, next.endInclusive.coerceAtLeast(next.start + gap))');
    const tsx = repoText(TSX);
    expect(tsx).toContain('props.onRangeChange?.(Math.min(next, rangeEnd - gap), rangeEnd);');
    expect(tsx).toContain('props.onRangeChange?.(rangeStart, Math.max(next, rangeStart + gap));');
  });

  it('L45 单值时 `value.coerceIn(valueRange)`', () => {
    expect(src).toContain('androidx.compose.material3.Slider(value = value.coerceIn(valueRange), onValueChange = onValueChange,');
    expect(repoText(TSX)).toContain('value={clamp(props.value, start, end)}');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ onDraggingChange 的"只在变化时 + 卸载补 false"
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OrdinaryControls.kt L31-39 onDraggingChange 的两个约束', () => {
  const src = kt(KT);

  it('L33-38 用 `reportedDragging` 记已上报值，只在**变化**时回调', () => {
    expect(src).toContain('val reportDragging by rememberUpdatedState(onDraggingChange)');
    expect(src).toContain('var reportedDragging by remember { mutableStateOf(false) }');
    expect(src).toContain('if (reportedDragging != dragging) {');
    expect(src).toContain('reportDragging?.invoke(dragging)');
    const tsx = repoText(TSX);
    expect(tsx).toContain('if (reported.current === dragging) return;');
    expect(tsx).toContain('reportDrag.current?.(dragging);');
  });

  it('L39 卸载时若仍是拖拽态，补一次 `false`', () => {
    expect(src).toContain('DisposableEffect(Unit) { onDispose { if (reportedDragging) reportDragging?.invoke(false) } }');
    expect(repoText(TSX)).toContain('if (reported.current) reportDrag.current?.(false);');
  });

  it('L27-29 `dragging = startDragging || endDragging`（两个交互源任一在拖）', () => {
    expect(src).toContain('val startDragging by startInteraction.collectIsDraggedAsState()');
    expect(src).toContain('val endDragging by endInteraction.collectIsDraggedAsState()');
    expect(src).toContain('val dragging = startDragging || endDragging');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ 分段选择器
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OrdinaryControls.kt L63-79 OrdinarySegmentedSelector', () => {
  const src = kt(KT);

  it('L69 已选中不再回调（`if (selected != option.id)`）', () => {
    expect(src).toContain('SegmentedButton(selected = selected == option.id, onClick = { if (selected != option.id) onSelect(option.id) },');
    expect(repoText(TSX)).toContain('if (!active) props.onSelect(option.id);');
  });

  it('L70 `shape = SegmentedButtonDefaults.itemShape(index, options.size)` —— 首尾各自圆角', () => {
    expect(src).toContain('shape = SegmentedButtonDefaults.itemShape(index, options.size), icon = {}) {');
    // 端口用 `role="radio"` 列表 + CSS `+` 兄弟选择器表达"相邻分隔线"
    const css = repoText('src/styles/liquidSegment.css');
    expect(css).toContain('.ordinary-segment__item + .ordinary-segment__item {');
    expect(css).toContain('border-radius: 999px;');
  });

  it('L72 label 过词表 `tr(...)`、`maxLines = 1`', () => {
    expect(src).toContain('Text(com.example.i18n.tr(option.label), fontSize = fontSp.sp, maxLines = 1)');
    expect(repoText(TSX)).toContain('<span className="ordinary-segment__text">{tr(option.label)}</span>');
  });

  it('L73-74 两个尾注：`favorite` 追加 `♥`、`badge > 0` 追加数字', () => {
    expect(src).toContain('if (option.favorite) Text("♥", fontSize = fontSp.sp)');
    expect(src).toContain('if (option.badge > 0) Text(option.badge.toString(), fontSize = fontSp.sp)');
    const tsx = repoText(TSX);
    expect(tsx).toContain("{option.favorite === true ? <span className=\"ordinary-segment__heart\">♥</span> : null}");
    expect(tsx).toContain('{(option.badge ?? 0) > 0 ? (');
    expect(tsx).toContain('{String(option.badge)}');
  });

  it('L67 行容器 `fillMaxWidth().height(height)`', () => {
    expect(src).toContain('SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth().height(height)) {');
    const tsx = repoText(TSX);
    expect(tsx).toContain('height: `${String(props.height ?? 48)}px`');
    expect(repoText('src/styles/liquidSegment.css')).toContain('width: 100%;');
  });
});
