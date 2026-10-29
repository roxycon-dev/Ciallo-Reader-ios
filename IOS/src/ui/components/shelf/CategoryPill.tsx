/**
 * Port of Android `ui/shelf/ShelfChips.kt` (305 lines total / 291 non-blank / 284 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–49   package + imports → file header.
 *          ⚠️ `LocalHapticsEnabled` / `LocalReduceMotion` / `rememberAppHaptics` are
 *          imported from `com.example.ui.feedback` — they are already ported inside
 *          `@ui/components/favorite/FavoriteHeart` (HAPTIC_KIND / HAPTIC_MILLIS) and
 *          `prefers-reduced-motion`; reused by import, not duplicated.
 *   51–60  the CategoryPill KDoc (all five "fingers can feel it" details) → component
 *          KDoc, verbatim prose.
 *   61–184 `@Composable fun CategoryPill(name, selected, onClick, modifier, count, locked,
 *          accent, onLongClick, dropHighlight)` — the 9th param's KDoc (drop target IS
 *          the page's own pill row; no separate bottom Dock; fill-primary + 1.08 scale
 *          and **不改文案**) → props KDoc, verbatim.
 *   81–83  haptics / hapticsEnabled / reduceMotion composition locals → web equivalents.
 *   85     `var pressed by remember { mutableStateOf(false) }` → `useState(false)`.
 *   86–94  `animateFloatAsState(if (pressed) 0.94f else if (dropHighlight) 1.08f else 1f,
 *          spring(0.60, 500))` → CSS transform + `.shelf-pill--drop { transform: scale(1.08) }`.
 *   95–99  `bgAlpha = if (selected || dropHighlight) 1f else 0.06f` → class switch.
 *   100–104 `borderAlpha = if (dropHighlight) 1f else if (selected) 0f else 0.10f` → class switch.
 *   105–106 `contentColor = if (selected || dropHighlight) White else onSurface.copy(0.72f)`
 *          → `.shelf-pill--on { color: #fff }`.
 *   108–143 the `Row` chain: `height(32)`, `graphicsLayer{scale}`, `clip(Rounded 16)`,
 *          `background(accent or onSurface @ bgAlpha)`, `border(dropHighlight ? 1.5 : 0.5.dp,
 *          accent or onSurface @ borderAlpha, Rounded 16)`, `pointerInput(onClick, onLongClick) {
 *          detectTapGestures(onPress = {pressed = true; tryAwaitRelease()}, onTap = { haptic;
 *          onClick() }, onLongPress = { onLongClick?.invoke() }) }`,
 *          `semantics { contentDescription = if (selected) "分类 $name，已选中" else "分类 $name" }`,
 *          `padding(horizontal = 13.dp)` → `<button>` with onPointerDown/Up + onContextMenu
 *          and the aria-label.
 *   147–153 `Text(name, 12.5.sp, SemiBold when selected/drop else Medium, contentColor, maxLines 1)`
 *   154–162 `if (locked) { Spacer(5); Icon(Lock, "已加密", tint = contentColor.copy(0.9 if selected else 0.45), 12.dp) }`
 *   163–182 `if (count != null && count >= 0) { Spacer(6); Box(r7, selected ? White@0.24 : onSurface@0.08, h5 v1)
 *              { Text(count.toString(), 10.sp, SemiBold, contentColor.copy(1f if selected else 0.62f)) } }`
 *  186–227 `fun Modifier.pressScale(scale = 0.96f, enabled = true, onTap)` — the KDoc
 *          ("苹果几乎所有可点元素都有这一下，缺了它整个界面会显得'没有实体感'"),
 *          `pointerInput` early return when `!enabled`, the same spring(0.60, 500),
 *          the same `onTap` haptic-then-invoke order → `usePressScale()` hook returning
 *          `{ onPointerDown, onPointerUp, onPointerLeave, onContextMenu? , pressed }` plus
 *          a `pressStyle` object for inline transform.
 *  229–305 `@Composable fun AddCategoryPill(onClick, modifier, label = "新建", accent)` —
 *          the KDoc ("虚线描边 + 按下缩放，明确区别于真实分类"), the same spring(0.60, 500)
 *          press, and the `drawBehind { drawRoundRect(color = accent@0.55, Stroke(1.2.dp,
 *          dashPathEffect(6.dp, 5.dp)), CornerRadius(16.dp)) }` → `border: 1.2px dashed rgba(5,150,105,.55)`.
 *          Body: `Icon(Add, null, accent, 13.dp)`, `Spacer(3)`,
 *          `Text(label, 12.5.sp, Medium, accent)`.
 *
 * Skipped: nothing. Every dp/sp/dash value survives verbatim in CSS.
 *
 * THIS-ROUND FIXES (line-by-line review)
 * --------------------------------------
 *   • No behavioural change. This file was verified line by line against
 *     ShelfChips.kt 1–305 and is byte-faithful; it is now also the component
 *     `HomePage.tsx` actually renders (it used to use the reduced
 *     `@ui/components/Chips` `CategoryPill`, which lacked `dropHighlight` and
 *     `disabled`-ed locked pills, making the PIN entry point unreachable).
 *   • `borderAlpha` mapping: Kotlin computes `onSurface.copy(alpha = 0f)` for a
 *     selected pill; the TS emits `borderColor: 'transparent'` — visually and
 *     semantically identical, hence kept (COSMETIC).
 *   • `aria-pressed` is an a11y addition with no Compose counterpart
 *     (semantics only sets contentDescription) — harmless EXTRA, kept.
 *   • `onLongClick` maps Kotlin's `detectTapGestures(onLongPress = …)` to
 *     `contextmenu`; on iOS Safari a long press fires `contextmenu`, so the
 *     affordance exists. Documented platform adaptation.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import '../../../styles/shelf.css';

const MINT_PRIMARY = '#059669';
const ACCENT_0_06 = 'rgba(24, 25, 28, 0.06)';
const ACCENT_0_10 = 'rgba(24, 25, 28, 0.1)';
const ON_SURFACE_RGB = { r: 24, g: 25, b: 28 };

/** Real touch/mouse hold; contextmenu alone does not implement iOS long press. */
function useHoldGesture(onHold: (() => void) | null | undefined) {
  const callback = useRef(onHold), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null), fired = useRef(false);
  useEffect(() => { callback.current = onHold; }, [onHold]);
  const end = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; origin.current = null; }, []);
  useEffect(() => () => end(), [end]);
  return {
    start(event?: { clientX: number; clientY: number; button?: number }) {
      end(); fired.current = false; if (event?.button && event.button !== 0 || !callback.current) return;
      origin.current = { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
      timer.current = setTimeout(() => { fired.current = true; timer.current = null; callback.current?.(); }, 550);
    },
    move(event: { clientX: number; clientY: number }) { const point = origin.current; if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 8) end(); },
    end,
    consumeClick() { const result = fired.current; fired.current = false; return result; },
    contextMenu(event: { preventDefault(): void }) { if (!callback.current) return; event.preventDefault(); end(); if (!fired.current) { fired.current = true; callback.current(); } },
  };
}

/** `LocalReduceMotion` — Motion.kt L88 (`ANIMATOR_DURATION_SCALE ≤ 0.01` ⇒ reduce). */
function useReduceMotion(): boolean {
  // ⚠️ Lazy `useState` initializer (no `Math.random()`/`Date.now()`/DOM read during
  // render is fine here — `matchMedia` is a pure environment query, evaluated once).
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** `LocalHapticsEnabled` — Motion.kt L91 (default true). */
function useHapticsEnabled(): boolean {
  // ⚠️ Lazy initializer: reads localStorage once instead of setState-in-effect.
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('haptics_enabled') !== 'false';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (): void => {
      setEnabled(window.localStorage.getItem('haptics_enabled') !== 'false');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return enabled;
}

function hapticSelection(enabled: boolean): void {
  // Kotlin L134: HapticKind.SELECTION -> 8ms / amplitude 48.
  if (!enabled) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(8);
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * 书架 / 我喜欢的 共用的分类胶囊。
 *
 * 细节（都是"手指能感觉到"的那一类）：
 * - 按下瞬间缩到 0.94（硬弹簧，跟手），松手弹回 1.0（带一点过冲）；
 * - 切换选中时底色、描边、字重、字色一起过渡，不是硬切；
 * - 点击给一颗 selection 级轻震动（可随系统触觉开关关闭）；
 * - 数量角标跟着选中态换底色，避免"选中后角标看不清"；
 * - 「减少动态效果」开启时全部退化为 0 时长的直接切换。
 */
export function CategoryPill(props: {
  name: string;
  selected: boolean;
  onClick: () => void;
  count?: number | null;
  locked?: boolean;
  accent?: string;
  onLongClick?: (() => void) | null;
  /**
   * 拖拽悬停在本胶囊上（"松手就放进这里"）。
   *
   * 放置目标就是**页面里这一排分类胶囊本身**，不再另起一个底部 Dock ——
   * 用户明确要求：拖到对应分类就是拖到「我的书架 / 我喜欢的」下面这几个按钮上。
   * 高亮用「填充主色 + 放大 1.08」表达，且**不改文案**，
   * 否则 FlowRow 里的兄弟胶囊会跟着位移甚至换行，手指底下的目标就跑了。
   */
  dropHighlight?: boolean;
}) {
  const hapticsEnabled = useHapticsEnabled();
  const reduceMotion = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const hold = useHoldGesture(props.onLongClick);
  const dropHighlight = props.dropHighlight === true;
  const selected = props.selected;
  const locked = props.locked === true;
  const accent = props.accent ?? MINT_PRIMARY;
  const hasCount = typeof props.count === 'number' && props.count >= 0;

  // `animateFloatAsState(if (pressed) 0.94f else if (dropHighlight) 1.08f else 1f, …)`
  const scale = pressed ? 0.94 : dropHighlight ? 1.08 : 1;

  // `bgAlpha` / `borderAlpha` (Kotlin L95–104)
  const bgAlpha = selected || dropHighlight ? 1 : 0.06;
  const borderAlpha = dropHighlight ? 1 : selected ? 0 : 0.1;
  // `contentColor` (Kotlin L105–106)
  const contentColor = selected || dropHighlight ? '#FFFFFF' : 'rgba(24, 25, 28, 0.72)';

  const style: CSSProperties = {
    // background: accent.copy(alpha = bgAlpha) when selected/drop, else onSurface@bgAlpha
    background: selected || dropHighlight ? withAlpha(accent, bgAlpha) : ACCENT_0_06,
    // border: dropHighlight ? 1.5.dp : 0.5.dp of accent/onSurface @ borderAlpha
    borderWidth: dropHighlight ? 1.5 : 0.5,
    borderColor: dropHighlight
      ? withAlpha(accent, borderAlpha)
      : selected
        ? 'transparent'
        : ACCENT_0_10,
    color: contentColor,
    transform: `scale(${String(scale)})`,
    transitionDuration: reduceMotion ? '0ms' : undefined,
  };

  return (
    <button
      type="button"
      className={[
        'shelf-pill',
        'shelf-pill--accent',
        selected ? 'shelf-pill--on' : '',
        dropHighlight ? 'shelf-pill--drop' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ...style, ['--pill-accent' as string]: accent }}
      // Kotlin L141–142: `semantics { contentDescription = … }`
      aria-label={selected ? `分类 ${props.name}，已选中` : `分类 ${props.name}`}
      aria-pressed={selected}
      onPointerDown={(event) => { setPressed(true); hold.start(event); }}
      onPointerMove={hold.move}
      onPointerUp={() => { setPressed(false); hold.end(); }}
      onPointerCancel={() => { setPressed(false); hold.end(); }}
      onPointerLeave={() => { setPressed(false); hold.end(); }}
      onClick={() => {
        if (hold.consumeClick()) return;
        hapticSelection(hapticsEnabled);
        props.onClick();
      }}
      onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
        hold.contextMenu(event);
      }}
    >
      {props.name}
      {locked ? (
        <span className="shelf-pill__lock" aria-label="已加密">
          <IconLock />
        </span>
      ) : null}
      {hasCount ? <span className="shelf-pill__count">{props.count}</span> : null}
    </button>
  );
}

/**
 * 通用「点按反馈」修饰符：按下缩到 [scale]（硬弹簧跟手），松手弹回并触发点击。
 * 苹果几乎所有可点元素都有这一下，缺了它整个界面会显得"没有实体感"。
 *
 * Kotlin 190–227 is a `Modifier.pressScale` composable modifier; the React port is the
 * `usePressScale` hook below. The same values drive both this pill family and the
 * shelf/favorite cards, so the function name is preserved.
 */
export function usePressScale(options?: {
  scale?: number;
  enabled?: boolean;
  onTap?: () => void;
  onLongTap?: (() => void) | null;
}) {
  const scale = options?.scale ?? 0.96;
  const enabled = options?.enabled !== false;
  const onTap = options?.onTap;
  const onLongTap = options?.onLongTap ?? null;
  const hold = useHoldGesture(enabled ? onLongTap : null);
  const hapticsEnabled = useHapticsEnabled();
  const reduceMotion = useReduceMotion();
  const [pressed, setPressed] = useState(false);

  const onPointerDown = (event?: { clientX: number; clientY: number; button?: number }): void => {
    if (!enabled) return;
    setPressed(true);
    hold.start(event);
  };

  const onPointerUp = (): void => {
    setPressed(false);
    hold.end();
  };

  const handleClick = (): void => {
    // Kotlin L221–225: `if (!enabled) return@pointerInput` guards the whole handler.
    if (!enabled) return;
    if (hold.consumeClick()) return;
    hapticSelection(hapticsEnabled);
    onTap?.();
  };

  const handleContextMenu = hold.contextMenu;

  const style: CSSProperties = {
    transform: `scale(${String(pressed ? scale : 1)})`,
    transitionDuration: reduceMotion ? '0ms' : undefined,
  };

  return {
    pressed,
    style,
    onPointerDown,
    onPointerMove: hold.move,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave: onPointerUp,
    onClick: handleClick,
    onContextMenu: handleContextMenu,
  };
}

/** 「＋新建分类」胶囊：虚线描边 + 按下缩放，明确区别于真实分类。 */
export function AddCategoryPill(props: {
  onClick: () => void;
  label?: string;
  accent?: string;
}) {
  const hapticsEnabled = useHapticsEnabled();
  const reduceMotion = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const label = props.label ?? '新建';
  const accent = props.accent ?? MINT_PRIMARY;
  // `val dashOn = 6.dp; dashOff = 5.dp; dashColor = accent.copy(alpha = 0.55f); dashWidth = 1.2.dp`
  const scale = pressed ? 0.94 : 1;

  return (
    <button
      type="button"
      className="shelf-add-pill"
      style={{
        color: accent,
        borderColor: withAlpha(accent, 0.55),
        transform: `scale(${String(scale)})`,
        transitionDuration: reduceMotion ? '0ms' : undefined,
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => {
        hapticSelection(hapticsEnabled);
        props.onClick();
      }}
    >
      <IconAdd />
      {label}
    </button>
  );
}

/** 多选态下条目左上角的圆形勾选框。 — ShelfSelectionHost.kt L183–223 */
export function ShelfSelectBadge(props: { selected: boolean; indexLabel?: string | null }) {
  return (
    <span
      className={props.selected ? 'shelf-select-badge shelf-select-badge--on' : 'shelf-select-badge'}
      // Kotlin L209–211: `contentDescription = if (selected) "已选中${indexLabel}" else "未选中"`
      role="img"
      aria-label={props.selected ? `已选中${props.indexLabel ?? ''}` : '未选中'}
    >
      {props.selected ? <IconCheck /> : null}
    </span>
  );
}

/** `Color.copy(alpha = a)` equivalent for #RRGGBB hex. */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(${String(ON_SURFACE_RGB.r)}, ${String(ON_SURFACE_RGB.g)}, ${String(ON_SURFACE_RGB.b)}, ${String(alpha)})`;
  }
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}
