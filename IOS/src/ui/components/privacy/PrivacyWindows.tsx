/**
 * PrivacyWindows.tsx — 逐行移植 Android `ui/privacy/PrivacyWindows.kt` 的 UI 层。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/privacy/PrivacyWindows.kt
 *            (633 行 / 618 非空)
 * TS 目标:   IOS/src/ui/components/privacy/PrivacyWindows.tsx
 * 配套:      IOS/src/core/privacy/privacyWindows.ts（数值 + 状态机，纯 TS 可单测）
 *            IOS/src/styles/privacyWindows.css（视觉）
 *
 * 移植范围（本文件负责 UI，判定逻辑全在 core）
 * ------------------------------------------------------
 *   61-67  设计语言注释            → 文件头（压缩保留）
 *   69-110 `PinDots(filled, error, modifier)`
 *                                 → PinDots（振幅/摆动表来自 core）
 *   112-144 `GlassPinKey(label, onClick, modifier, enabled, keySize = 68.dp)`
 *                                 → GlassPinKey
 *   146-178 `GlassPinIconKey(icon, contentDescription, onClick, …)`
 *                                 → GlassPinIconKey（Backspace 图标内联 SVG）
 *   180-181 `enum class PinEntryMode` → core.PinEntryMode（本文件只 re-export 类型）
 *   183-383 `PrivacyPinOverlay(mode, onPinSet, onPinVerified, onDismiss)`
 *                                 → PrivacyPinOverlay
 *   385-633 `PrivacyManageOverlay(categories, privacyModeEnabled,
 *             onToggleProtected, onToggleIncognito, incognitoBrowsingEnabled,
 *             favoritesProtected, onToggleFavoritesProtected,
 *             onChangePin, onDisablePrivacy, onDismiss)`
 *                                 → PrivacyManageOverlay
 *
 * 平台适配
 * --------
 *  - `Box/Column/Row/Spacer/weight(1f)`  → flex 布局（见 privacyWindows.css）
 *  - `BoxWithConstraints { maxHeight }`  → `useViewportHeightPx()`（resize 订阅，
 *                                          render 期不读 DOM）
 *  - `Animatable` + `spring` / `animateFloatAsState`
 *                                        → rAF 逐段插值（PinDots 抖动）
 *                                          与 CSS `:active` 过渡（按键缩放）
 *  - `BackHandler(onBack = onDismiss)`   → `Escape` 键桥（Web 无系统返回键）
 *  - `ScrimEntrance` / `DialogEntrance` → 复用 `@ui/components/OverlayAnimations`
 *  - `GlassCard(shape, contentPadding)` → 共享 `GlassCard.tsx`（radius / padding）
 *  - `Icons.Filled.*` (Material Icons)   → 内联 Material Symbols path（字面量搬运）
 *  - `AppSwitch`                        → 复用 `@ui/components/AppSwitch`
 *  - `Color(0x59000000)` / colorScheme  → CSS rgba / theme.css 变量
 *  - `LazyColumn(items(categories, key = { it.id })`
 *                                        → `overflow-y:auto` + `key={cat.id}`
 *  - `suspend (String) -> Unit|Boolean` → `Promise<void>` / `Promise<boolean>`
 *  - `CategoryEntity`                   → 结构子集 `PrivacyCategory`
 *
 * React 19 约束（均已满足）
 * -------------------------
 *  - render 期不读 ref.current、不调用 Math.random()/Date.now()；
 *  - 派生数据（PinDots 的归零、compact 度量）全部 render 期计算；
 *  - useEffect 内不做同步 setState（只有 rAF 回调 / Promise 回调 / 事件回调里 setState）；
 *  - `props.categories.map(...)` 的回调里没有任何 hook，复杂行抽成了
 *    `PrivacyToggleRow` / `PrivacyCategoryRow` 两个子组件；
 *  - 所有 hook 位于组件顶层、无条件调用。
 *
 * 重复端口的收敛（本文件是唯一实现）
 * -------------------------------------
 * 同一份 Kotlin 曾被两个并行 agent 各移植一次：`PrivacySetupOverlay.tsx`（只做了
 * 键盘层）与本文件。分歧只有抖动摆动每段的挂钟时长 —— 那份用 123 ms / 256 ms 的
 * 硬编码近似，本文件用 `core.springHalfSwingMs()` 从 ζ/k 闭式解出的
 * **127.36 ms / 196.35 ms**（弹簧参数 ζ=0.15 k=1400 与振幅 10 → 6.7 → 3.3 两版一致）。
 * 本文件是权威版，`PrivacySetupOverlay.tsx` 已删除：
 *   1. 本文件把 compact 判定、按键钳位、状态机搬进了 core，可单测；
 *   2. 本文件额外支持 `onToggleProtected` 返回 Promise（写库）并在锁定期间
 *      可选禁用键盘（`locked` prop）；
 *   3. 那份引用的 17 个 class 名（`privacy-pin-*` / `privacy-manage-overlay*`）在任何
 *      样式表里都不存在 —— 即它从未真正可渲染；本文件的 class 全部由
 *      `styles/privacyWindows.css` 覆盖。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GlassCard } from '../GlassCard';
import { DialogEntrance, ScrimEntrance } from '../OverlayAnimations';
import { AppSwitch } from '../AppSwitch';
import {
  ERROR_RGB,
  MINT_PRIMARY,
  ON_SURFACE_RGB,
  PIN_BACKSPACE_CONTENT_DESCRIPTION,
  PIN_DOTS_ALPHA_INACTIVE,
  PIN_DOTS_COUNT,
  PIN_DOTS_SIZE_PX,
  PIN_ENTRY_TITLE,
  PIN_KEYPAD_ROWS,
  PRIVACY_MANAGE_ACTION_CHANGE_PIN,
  PRIVACY_MANAGE_ACTION_DISABLE,
  PRIVACY_MANAGE_CATEGORY_HINT,
  PRIVACY_MANAGE_DONE,
  PRIVACY_MANAGE_FAVORITES_LABEL,
  PRIVACY_MANAGE_INCOGNITO_LABEL,
  PRIVACY_MANAGE_LEAD,
  PRIVACY_MANAGE_TITLE,
  advancePinFlow,
  appendPinDigit,
  applyCategoryProtectionToggle,
  backspacePinDigit,
  categoryRowHintVisible,
  favoritesHintText,
  incognitoHintText,
  initialPinFlow,
  isPinKeypadBackspace,
  isPinKeypadBlank,
  pinDotsShakeSchedule,
  pinEntrySubtitle,
  pinOverlayMetrics,
  privacyManageEntryAllowed,
  settlePinFlow,
  type PinEntryMode,
  type PinFlowState,
} from '@core/privacy/privacyWindows';
import '../../../styles/privacyWindows.css';

export type { PinEntryMode } from '@core/privacy/privacyWindows';

/* ═══════════════════════════════════════════════════════════════════════════
 * 容器尺寸（Kotlin L280-283 `BoxWithConstraints { maxHeight }`）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** SSR / 测试环境下的兜底高度（Kotlin 侧无对应物，Android 一定有容器尺寸）。 */
const FALLBACK_VIEWPORT_HEIGHT = 800;

function readViewportHeight(): number {
  return typeof window === 'undefined' ? FALLBACK_VIEWPORT_HEIGHT : window.innerHeight;
}

/**
 * 视口高度订阅。Kotlin 在 layout 阶段每帧拿到 `maxHeight`；Web 只能靠事件，
 * 所以用 `useState` 惰性初值 + resize/orientationchange 订阅（**不是** render 期
 * 读 `window.innerHeight`，也不是 effect 内同步 setState）。
 */
function useViewportHeightPx(): number {
  const [height, setHeight] = useState(readViewportHeight);
  useEffect(() => {
    const onResize = (): void => setHeight(readViewportHeight());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return height;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L69-110 — `PinDots(filled: Int, error: Boolean, modifier: Modifier)`
 *
 * ⚠️ 按下缩放（Kotlin L121-127 `MutableInteractionSource` +
 * `collectIsPressedAsState` + `animateFloatAsState(0.94f, spring(0.6f, 900f))`）
 * 由 CSS `:active` + `transform: scale(0.94)` + 过渡承担，见
 * `styles/privacyWindows.css` 的 `.privacy-windows-pin-key:active`。
 * 本文件因此**不再**维护一份 pressed state —— 那只会多一次无谓的重渲染。
 * ═══════════════════════════════════════════════════════════════════════════ */

function PinDots(props: { filled: number; error: boolean }) {
  // Kotlin L75 `val offsetX = remember { Animatable(0f) }`
  const [offsetX, setOffsetX] = useState(0);
  const rafRef = useRef(0);
  // Kotlin L78-80：`if (!error) { offsetX.snapTo(0f); return }` 是**同步**归零，
  // 因此这里用「render 期派生调整」而不是在 effect 里 setState（React 19）。
  const [lastError, setLastError] = useState(props.error);
  if (lastError !== props.error) {
    setLastError(props.error);
    if (!props.error) setOffsetX(0);
  }

  // Kotlin L76-88 `LaunchedEffect(error) { … }`
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (!props.error) return;
    // Kotlin L82-87 `repeat(3) { animateTo(±amp, spring(0.15f, 1400f)) }` +
    //              `animateTo(0f, spring(0.6f, 900f))`
    const schedule = pinDotsShakeSchedule();
    let index = 0;
    let from = 0;
    const step = (): void => {
      const segment = schedule[index];
      if (segment === undefined) return;
      const { to, ms, ease } = segment;
      const begin = from;
      const start = nowMs();
      const tick = (): void => {
        const t = Math.min(1, (nowMs() - start) / ms);
        setOffsetX(begin + (to - begin) * ease(t));
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          from = to;
          index += 1;
          if (index < schedule.length) rafRef.current = requestAnimationFrame(step);
        }
      };
      tick();
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [props.error]);

  return (
    <div className="privacy-windows-pin-dots" style={{ transform: `translateX(${offsetX}px)` }}>
      {Array.from({ length: PIN_DOTS_COUNT }, (_, i) => {
        // Kotlin L94 `val active = i < filled`
        const active = i < props.filled;
        // Kotlin L101-105 `when { error -> error; active -> MintPrimary; else -> onSurface }`
        const background = props.error
          ? `rgb(${ERROR_RGB})`
          : active
            ? MINT_PRIMARY
            : `rgb(${ON_SURFACE_RGB})`;
        return (
          <span
            key={i}
            className="privacy-windows-pin-dots__dot"
            style={{
              background,
              // Kotlin L98 `alpha = if (active) 1f else 0.45f`
              opacity: active ? 1 : PIN_DOTS_ALPHA_INACTIVE,
              width: PIN_DOTS_SIZE_PX,
              height: PIN_DOTS_SIZE_PX,
            }}
          />
        );
      })}
    </div>
  );
}

function nowMs(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L112-144 — `GlassPinKey`
 * ═══════════════════════════════════════════════════════════════════════════ */

function GlassPinKey(props: {
  label: string;
  onClick: () => void;
  keySize: number;
  enabled: boolean;
  labelFontSize: number;
}) {
  return (
    <button
      type="button"
      className={`privacy-windows-pin-key${
        props.enabled ? '' : ' privacy-windows-pin-key--muted'
      }`}
      style={{
        width: props.keySize,
        height: props.keySize,
        // Kotlin L133 `surface.copy(alpha = if (enabled) 0.55f else 0.25f)`
        background: `rgba(255, 255, 255, ${props.enabled ? 0.55 : 0.25})`,
      }}
      disabled={!props.enabled}
      onClick={props.onClick}
    >
      <span
        className="privacy-windows-pin-key-label"
        style={{
          // Kotlin L139 `fontSize = if (keySize < 60.dp) 19.sp else 22.sp`
          fontSize: props.labelFontSize,
          // Kotlin L141 `onSurface.copy(alpha = if (enabled) 0.9f else 0.35f)`
          color: `rgba(${ON_SURFACE_RGB}, ${props.enabled ? 0.9 : 0.35})`,
        }}
      >
        {props.label}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L146-178 — `GlassPinIconKey`（删除键）
 * ═══════════════════════════════════════════════════════════════════════════ */

function GlassPinIconKey(props: { onClick: () => void; keySize: number; iconSize: number }) {
  return (
    <button
      type="button"
      className="privacy-windows-pin-key privacy-windows-pin-key--icon"
      // Kotlin L354 `contentDescription = "删除"`
      aria-label={PIN_BACKSPACE_CONTENT_DESCRIPTION}
      style={{
        width: props.keySize,
        height: props.keySize,
        // Kotlin L167 `background(surface.copy(alpha = 0.55f))` —— 图标键无 disabled 态
        background: 'rgba(255, 255, 255, 0.55)',
      }}
      onClick={props.onClick}
    >
      {/* Kotlin L353 `Icons.Filled.Backspace` —— Material Symbols path 搬运 */}
      <svg
        viewBox="0 0 24 24"
        width={props.iconSize}
        height={props.iconSize}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7L2 12l5-7h15v14zm-5-2h2v-4h4v-2h-4V7h-2v4H9v2h4v4z" />
      </svg>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L183-383 — `PrivacyPinOverlay`
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L199 `␛` 键：`BackHandler(onBack = onDismiss)`（Web 无返回键的替代）。 */
function useEscapeToDismiss(onDismiss: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);
}

export interface PrivacyPinOverlayProps {
  /** Kotlin L192。 */
  mode: PinEntryMode;
  /** Kotlin L193 `suspend (String) -> Unit`（SETUP/CONFIRM 全流程完成，新 PIN 生效）。 */
  onPinSet: (pin: string) => Promise<void> | void;
  /** Kotlin L194 `suspend (String) -> Boolean`（VERIFY / CHANGE_OLD 返回校验结果）。 */
  onPinVerified: (pin: string) => Promise<boolean> | boolean;
  onDismiss: () => void;
  /**
   * 可选：锁定期间禁用键盘（`core.readPinLockout` 的 `locked`）。
   * Kotlin 侧没有这个 prop —— 锁定是 `PrivacyManager` 内部的静默短路，
   * UI 仍然可以输满 6 位再吃一次 false。此 prop 是可选增强，默认 false。
   */
  locked?: boolean;
  /** 锁定时的辅助文案（Kotlin 无对应物，默认不渲染）。 */
  lockedHint?: string;
}

/**
 * PIN 输入悬浮毛玻璃窗口：
 * - SETUP → CONFIRM：首次开启隐私模式的「设置 + 二次确认」流程；
 * - VERIFY：进入受保护分类 / 打开隐私管理窗口前的验证；
 * - CHANGE_OLD → CHANGE_NEW：修改密码。
 * 输满 6 位自动提交，错误时圆点抖动 + 清空重试。
 */
export function PrivacyPinOverlay(props: PrivacyPinOverlayProps) {
  // Kotlin L197-204 五个 `remember { mutableStateOf(…) }` 合并为一个 record。
  const [state, setState] = useState<PinFlowState>(() => initialPinFlow(props.mode));
  // Kotlin 的 `LaunchedEffect` 没有「重入中」概念；Web 需要一个守卫，
  // 否则 PBKDF2（120k 迭代）未返回时同一 6 位会被再次提交。
  const submitting = useRef(false);
  const locked = props.locked === true;

  // Kotlin L212-255 的**纯状态**分支（SETUP → CONFIRM、CONFIRM 不匹配回退、
  // CHANGE_NEW → CONFIRM）在 render 期推进：每个分支都把 `entered` 清空，
  // 所以 `settlePinFlow` 最多两步收敛。这是 React 19 要求的
  // 「derive-during-render」形状，等价于 Kotlin 里 effect 重启后连跑两次 when。
  const flow = settlePinFlow(state);
  if (flow !== state) setState(flow);

  useEscapeToDismiss(props.onDismiss);

  /* 宿主回调的最新值。提交 effect 的键集必须**只有** `flow`（等价 Kotlin
   * `LaunchedEffect(entered, currentMode)`）—— 若把三个回调直接写进依赖数组，
   * 宿主每次重建回调都会让 effect 重跑，而 `advancePinFlow(flow)` 在提交后
   * 仍会返回同一个 `set`/`verify`，于是同一位 PIN 会被重复提交。
   * 用一个 ref 承接「最新的回调」，effect 只依赖 `flow`，既保持 Kotlin 的键集
   * 语义，又不必用规则抑制注释来掩盖 exhaustive-deps。 */
  const handlersRef = useRef({
    onPinSet: props.onPinSet,
    onPinVerified: props.onPinVerified,
    onDismiss: props.onDismiss,
  });
  // 声明在提交 effect **之前**：同一 commit 内 effect 按声明顺序执行，
  // 保证提交时读到的是本次 commit 的回调。
  useEffect(() => {
    handlersRef.current = {
      onPinSet: props.onPinSet,
      onPinVerified: props.onPinVerified,
      onDismiss: props.onDismiss,
    };
  }, [props.onPinSet, props.onPinVerified, props.onDismiss]);

  // Kotlin L212 `LaunchedEffect(entered, currentMode)` —— 输满自动提交。
  // effect 内只剩两个真副作用（onPinSet / onPinVerified），没有同步 setState。
  useEffect(() => {
    const action = advancePinFlow(flow);
    if (action.type === 'none') return;
    if (submitting.current) return;
    const handlers = handlersRef.current;
    if (action.type === 'set') {
      // Kotlin L221 `if (entered == firstSetup) onPinSet(entered)`
      submitting.current = true;
      void Promise.resolve().then(() => handlers.onPinSet(action.pin)).catch((error: unknown) => {
        setState((state) => ({ ...state, entered: '', error: error instanceof Error ? error.message : '安全存储暂时不可用，请重试' }));
      }).finally(() => {
        submitting.current = false;
      });
      return;
    }
    // Kotlin L236-244：`VERIFY` / `CHANGE_OLD`
    submitting.current = true;
    void Promise.resolve().then(() => handlers.onPinVerified(action.pin)).then((ok) => {
      if (ok) {
        if (action.dismissOnSuccess) {
          // Kotlin L237 `if (onPinVerified(entered)) onDismiss()`
          handlers.onDismiss();
        } else {
          // Kotlin L240-242 CHANGE_OLD 成功 → 切到 CHANGE_NEW 并清空
          setState(action.nextOnSuccess);
        }
      } else {
        // Kotlin L237 / L243 失败 → reset("密码错误，请重试")
        setState(action.nextOnFailure);
      }
    }).catch((error: unknown) => {
      setState((state) => ({ ...state, entered: '', error: error instanceof Error ? error.message : '安全存储暂时不可用，请重试' }));
    }).finally(() => { submitting.current = false; });
  }, [flow]);

  // Kotlin L280-283 `BoxWithConstraints { val compact = maxHeight < 560.dp … }`
  const metrics = pinOverlayMetrics(useViewportHeightPx());

  const keypad = (
    <div
      className="privacy-windows-pin-keys"
      style={{ display: 'flex', flexDirection: 'column', gap: metrics.rowSpace }}
    >
      {PIN_KEYPAD_ROWS.map((rowKeys, rowIndex) => (
        <div
          key={rowIndex}
          style={{ display: 'flex', justifyContent: 'center', gap: metrics.keyGap }}
        >
          {rowKeys.map((key, keyIndex) => {
            const at = `${rowIndex}-${keyIndex}`;
            if (isPinKeypadBlank(key)) {
              // Kotlin L351 `key.isEmpty() -> Spacer(Modifier.size(keySize))`
              return (
                <span key={at} style={{ width: metrics.keySize, height: metrics.keySize }} />
              );
            }
            if (isPinKeypadBackspace(key)) {
              return (
                <GlassPinIconKey
                  key={at}
                  keySize={metrics.keySize}
                  iconSize={metrics.iconSize}
                  onClick={() => {
                    // Kotlin L356-361
                    //   if (entered.isNotEmpty()) { entered = entered.dropLast(1); error = null }
                    setState((s) => ({ ...s, entered: backspacePinDigit(s.entered), error: null }));
                  }}
                />
              );
            }
            return (
              <GlassPinKey
                key={at}
                label={key}
                keySize={metrics.keySize}
                labelFontSize={metrics.labelFontSize}
                enabled={!locked}
                onClick={() => {
                  // Kotlin L366-371
                  setState((s) => ({ ...s, entered: appendPinDigit(s.entered, key), error: null }));
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div className="privacy-windows-overlay" role="presentation">
      <ScrimEntrance>
        {/* Kotlin L265-275：遮罩点击 → onDismiss */}
        <div
          className="privacy-windows-overlay__scrim"
          onClick={props.onDismiss}
          aria-hidden="true"
        />
      </ScrimEntrance>
      <DialogEntrance>
        <div className="privacy-windows-overlay__center">
          {/* Kotlin L284-295：GlassCard(radius 28dp, contentPadding) */}
          <GlassCard
            radius={28}
            padding={0}
            className="privacy-windows-pin-card"
          >
            <div
              className="privacy-windows-pin-inner"
              style={{
                paddingLeft: metrics.cardPaddingX,
                paddingRight: metrics.cardPaddingX,
                paddingTop: metrics.cardPaddingY,
                paddingBottom: metrics.cardPaddingY,
              }}
            >
              {/* Kotlin L298-306：紧凑模式去掉盾牌图标 */}
              {metrics.showShield ? (
                <>
                  <span className="privacy-windows-pin-shield" style={{ color: MINT_PRIMARY }}>
                    <svg
                      viewBox="0 0 24 24"
                      width={28}
                      height={28}
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
                    </svg>
                  </span>
                  <div style={{ height: metrics.shieldGap }} />
                </>
              ) : null}

              {/* Kotlin L307-317：标题 */}
              <p className="privacy-windows-pin-title">{PIN_ENTRY_TITLE[flow.currentMode]}</p>
              {/* Kotlin L318 */}
              <div style={{ height: metrics.titleGap }} />
              {/* Kotlin L319-328：副标题 */}
              <p className="privacy-windows-pin-subtitle">{pinEntrySubtitle(flow.currentMode)}</p>
              {/* Kotlin L329 */}
              <div style={{ height: metrics.gapBeforeDots }} />
              {/* Kotlin L330 */}
              <PinDots filled={flow.entered.length} error={flow.error !== null} />
              {/* Kotlin L331-332 */}
              <div style={{ height: metrics.gapAfterDots }} />
              {/* Kotlin L333-339：固定高度占位，避免错误文案出现时跳动 */}
              <div
                className="privacy-windows-pin-error-slot"
                style={{ height: metrics.errorSlotHeight }}
              >
                {flow.error ?? (locked ? (props.lockedHint ?? '') : '')}
              </div>
              {/* Kotlin L340 */}
              <div style={{ height: metrics.gapBeforeKeys }} />
              {keypad}
            </div>
          </GlassCard>
        </div>
      </DialogEntrance>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L385-633 — `PrivacyManageOverlay`
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin `com.example.data.CategoryEntity` 的最小结构（`ui/privacy` 只用 3 个字段）。 */
export interface PrivacyCategory {
  id: number;
  name: string;
  isProtected: boolean;
}

export interface PrivacyManageOverlayProps {
  /** Kotlin L392 `categories: List<CategoryEntity>`。 */
  categories: readonly PrivacyCategory[];
  /** Kotlin L393。 */
  privacyModeEnabled: boolean;
  /** Kotlin L394 `onToggleProtected: (CategoryEntity, Boolean) -> Unit`。 */
  onToggleProtected: (
    category: PrivacyCategory,
    protectedOn: boolean,
  ) => Promise<void> | void;
  /** Kotlin L395-396「第九轮：全局无痕浏览开关」。 */
  onToggleIncognito?: (enabled: boolean) => void;
  /** Kotlin L397。 */
  incognitoBrowsingEnabled?: boolean;
  /** Kotlin L398-399「「我喜欢的」是否也要密码才能看（与受保护分类同一套 PIN）」。 */
  favoritesProtected?: boolean;
  onToggleFavoritesProtected?: (enabled: boolean) => void;
  /** Kotlin L401。 */
  onChangePin: () => void;
  /** Kotlin L402。 */
  onDisablePrivacy: () => void;
  /** Kotlin L403。 */
  onDismiss: () => void;
  /**
   * 可选：打开本窗口前是否已验证 PIN（Kotlin L388 KDoc「进入前提：隐私模式已开启
   * 且已验证 PIN」）。为 false 时整个内容区替换成一条说明 + 「返回」按钮。
   */
  pinVerified?: boolean;
  /** `pinVerified === false` 时的说明文案（Kotlin 无对应物，调用方提供）。 */
  lockedHint?: string;
}

/**
 * 隐私模式管理悬浮毛玻璃窗口（6.4.3：统一管理「哪些分类需要密码保护」）。
 * 进入前提：隐私模式已开启且已验证 PIN。窗口内可切换各分类保护开关、
 * 修改密码、关闭隐私模式（后两者需再次验证 PIN）。
 */
export function PrivacyManageOverlay(props: PrivacyManageOverlayProps) {
  useEscapeToDismiss(props.onDismiss);

  // Kotlin L396-400 的默认值：`incognitoBrowsingEnabled = false` /
  // `favoritesProtected = false`
  const incognito = props.incognitoBrowsingEnabled === true;
  const favorites = props.favoritesProtected === true;
  // Kotlin L388 KDoc 的两道前置条件。`pinVerified` 未传时按 Kotlin 行为（已验证）处理。
  const entered = privacyManageEntryAllowed({
    privacyModeEnabled: props.privacyModeEnabled,
    pinVerified: props.pinVerified ?? true,
  });

  if (!entered) {
    // Kotlin 没有这一分支；它是 KDoc L388「进入前提」的可执行形式。
    return (
      <div className="privacy-windows-overlay" role="presentation">
        <ScrimEntrance>
          <div
            className="privacy-windows-overlay__scrim"
            onClick={props.onDismiss}
            aria-hidden="true"
          />
        </ScrimEntrance>
        <DialogEntrance>
          <div className="privacy-windows-overlay__center">
            <GlassCard radius={28} padding={20} className="privacy-windows-manage-card">
              <div className="privacy-windows-manage-head">
                <span style={{ color: MINT_PRIMARY }}>
                  <ShieldIcon size={20} />
                </span>
                <span style={{ width: 8 }} />
                <h2 className="privacy-windows-manage-title">{PRIVACY_MANAGE_TITLE}</h2>
                <button
                  type="button"
                  className="privacy-windows-manage-done"
                  onClick={props.onDismiss}
                >
                  {PRIVACY_MANAGE_DONE}
                </button>
              </div>
              <div style={{ height: 8 }} />
              <p className="privacy-windows-manage-lead">
                {props.lockedHint ?? PRIVACY_MANAGE_LEAD}
              </p>
            </GlassCard>
          </div>
        </DialogEntrance>
      </div>
    );
  }

  return (
    <div className="privacy-windows-overlay" role="presentation">
      <ScrimEntrance>
        {/* Kotlin L412-422：遮罩点击 → onDismiss */}
        <div
          className="privacy-windows-overlay__scrim"
          onClick={props.onDismiss}
          aria-hidden="true"
        />
      </ScrimEntrance>
      <DialogEntrance>
        <div className="privacy-windows-overlay__center">
          {/* Kotlin L424-434：GlassCard(radius 28dp, contentPadding 20dp, maxHeight 0.72f) */}
          <GlassCard radius={28} padding={20} className="privacy-windows-manage-card">
            <div className="privacy-windows-manage-body">
              {/* Kotlin L437-460：头部（盾牌 + 「隐私模式」+「完成」） */}
              <div className="privacy-windows-manage-head">
                <span style={{ color: MINT_PRIMARY }}>
                  <ShieldIcon size={20} />
                </span>
                <span style={{ width: 8 }} />
                <h2 className="privacy-windows-manage-title">{PRIVACY_MANAGE_TITLE}</h2>
                <button
                  type="button"
                  className="privacy-windows-manage-done"
                  onClick={props.onDismiss}
                >
                  {PRIVACY_MANAGE_DONE}
                </button>
              </div>
              {/* Kotlin L461 */}
              <div style={{ height: 8 }} />
              {/* Kotlin L462-466 */}
              <p className="privacy-windows-manage-lead">{PRIVACY_MANAGE_LEAD}</p>
              {/* Kotlin L467 */}
              <div style={{ height: 10 }} />

              {/* Kotlin L469-506：全局无痕浏览总开关 */}
              <PrivacyToggleRow
                checked={incognito}
                label={PRIVACY_MANAGE_INCOGNITO_LABEL}
                hint={incognitoHintText(incognito)}
                icon={<VisibilityOffIcon />}
                onToggle={(next) => props.onToggleIncognito?.(next)}
              />
              {/* Kotlin L506 */}
              <div style={{ height: 10 }} />

              {/* Kotlin L508-545：「我喜欢的」密码保护 */}
              <PrivacyToggleRow
                checked={favorites}
                label={PRIVACY_MANAGE_FAVORITES_LABEL}
                hint={favoritesHintText(favorites)}
                icon={<FavoriteIcon />}
                onToggle={(next) => props.onToggleFavoritesProtected?.(next)}
              />
              {/* Kotlin L545 */}
              <div style={{ height: 10 }} />

              {/* Kotlin L547-589：受保护分类列表（LazyColumn + items(key = id)） */}
              <div className="privacy-windows-manage-list">
                {props.categories.map((cat) => (
                  <PrivacyCategoryRow
                    key={cat.id}
                    category={cat}
                    onToggle={(next) => {
                      // Kotlin L583-586 `AppSwitch(onCheckedChange = { onToggleProtected(cat, it) })`
                      const gate = applyCategoryProtectionToggle({
                        privacyModeEnabled: props.privacyModeEnabled,
                        categoryId: cat.id,
                        protectedOn: next,
                        unlockedCategoryIds: EMPTY_UNLOCKED,
                      });
                      if (!gate.changed) return;
                      void Promise.resolve(props.onToggleProtected(cat, next));
                    }}
                  />
                ))}
              </div>

              {/* Kotlin L591 */}
              <div style={{ height: 10 }} />
              {/* Kotlin L592-628：底部两枚动作键 */}
              <div className="privacy-windows-manage-actions">
                <button
                  type="button"
                  className="privacy-windows-manage-action"
                  onClick={props.onChangePin}
                >
                  {PRIVACY_MANAGE_ACTION_CHANGE_PIN}
                </button>
                <button
                  type="button"
                  className="privacy-windows-manage-action privacy-windows-manage-action--danger"
                  onClick={props.onDisablePrivacy}
                >
                  {PRIVACY_MANAGE_ACTION_DISABLE}
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      </DialogEntrance>
    </div>
  );
}

/** 空解锁集合（模块级常量；render 期不得生成新对象）。 */
const EMPTY_UNLOCKED: ReadonlySet<number> = new Set<number>();

/**
 * Kotlin L472-505 / L511-544 的两个开关行（同构，抽成一个子组件以便
 * `.map()` 回调里不出现 hook）。
 */
function PrivacyToggleRow(props: {
  checked: boolean;
  label: string;
  hint: string;
  icon: ReactNode;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="privacy-windows-manage-toggle">
      <span
        className={`privacy-windows-manage-toggle__icon${
          props.checked ? ' privacy-windows-manage-toggle__icon--on' : ''
        }`}
      >
        {props.icon}
      </span>
      {/* Kotlin L487 Spacer(Modifier.width(10.dp)) */}
      <span style={{ width: 10, flex: '0 0 auto' }} />
      <div className="privacy-windows-manage-row__texts">
        <p className="privacy-windows-manage-row__label">{props.label}</p>
        <p className="privacy-windows-manage-row__hint">{props.hint}</p>
      </div>
      <AppSwitch checked={props.checked} onCheckedChange={props.onToggle} />
    </div>
  );
}

/** Kotlin L554-588 的分类行（同样抽出，保证 map 回调无 hook）。 */
function PrivacyCategoryRow(props: {
  category: PrivacyCategory;
  onToggle: (next: boolean) => void;
}) {
  const cat = props.category;
  return (
    <div className="privacy-windows-manage-row">
      <span
        className={`privacy-windows-manage-row__icon${
          cat.isProtected ? ' privacy-windows-manage-row__icon--on' : ''
        }`}
      >
        {/* Kotlin L561-567 `if (cat.isProtected) Icons.Filled.Lock else Icons.Filled.LockOpen` */}
        {cat.isProtected ? <LockIcon /> : <LockOpenIcon />}
      </span>
      {/* Kotlin L568 Spacer(Modifier.width(10.dp)) */}
      <span style={{ width: 10, flex: '0 0 auto' }} />
      <div className="privacy-windows-manage-row__texts">
        <p className="privacy-windows-manage-row__label">{cat.name}</p>
        {/* Kotlin L575-581 `if (cat.isProtected) { Text("无痕 · 阅读不计入统计") }` */}
        {categoryRowHintVisible(cat.isProtected) ? (
          <p className="privacy-windows-manage-row__hint">{PRIVACY_MANAGE_CATEGORY_HINT}</p>
        ) : null}
      </div>
      <AppSwitch checked={cat.isProtected} onCheckedChange={props.onToggle} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Material Icons 字面量搬运（Kotlin L35 / L32 / L34 / L33 / L36）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L35 `Icons.Filled.Shield` — size 28.dp（L303）/ 20.dp（L442）。 */
function ShieldIcon(props: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size}
      height={props.size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
    </svg>
  );
}

/** Kotlin L36 `Icons.Filled.VisibilityOff` — size 17.dp（L485）。 */
function VisibilityOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} fill="currentColor" aria-hidden="true">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78c3.58.33 5.44 3.28 4.76 6.87l-6.63-6.63c.6-.2 1.23-.3 1.87-.24z" />
    </svg>
  );
}

/** Kotlin L33 `Icons.Filled.Favorite` — size 17.dp（L523）。 */
function FavoriteIcon() {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

/** Kotlin L34 `Icons.Filled.Lock` — size 17.dp（L567）。 */
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z" />
    </svg>
  );
}

/** Kotlin L34 `Icons.Filled.LockOpen` — size 17.dp（L567）。 */
function LockOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} fill="currentColor" aria-hidden="true">
      <path d="M18 8h-9V6c0-1.66 1.34-3 3-3 1.31 0 2.39.85 2.8 2h2.08C15.89 3.01 14.08 1 12 1 9.24 1 7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </svg>
  );
}

/* re-export 供测试与调用方直接引用的纯逻辑（core 是唯一真值）。
 * 之所以在此转出而不是让调用方直接 import core：调用方（SettingsPage /
 * HomePage）已经从 `@ui/components/privacy/…` 取这两个组件，顺手从同一处
 * 拿纯逻辑可以少写一条 import。core 仍是唯一定义处。 */
export {
  PIN_ENTRY_MODES,
  PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE,
  PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP,
  PIN_ERROR_WRONG,
  PIN_INPUT_LENGTH,
  PIN_KEYPAD_ROWS,
  PIN_SUBMIT_LENGTH,
  PRIVACY_MANAGE_CATEGORY_HINT,
  pinDotsShakeSchedule,
  readPinLockout,
  resetPinFlow,
  settlePinFlow,
  springHalfSwingMs,
  verifyPinWithLockout,
} from '@core/privacy/privacyWindows';
export type { PinFlowAction, PinFlowState, PinLockout } from '@core/privacy/privacyWindows';
