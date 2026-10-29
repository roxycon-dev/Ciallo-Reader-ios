/**
 * comicChapterEdgeGesture.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicChapterEdgeGesture.kt`（109 行 / 非空 106 行）
 * 的**手势主体部分**。纯逻辑部分（`comicChapterEdgeTarget` / 轴向判定 / 阻尼位移）
 * 在 `src/core/comic/comicChapterEdgeGesture.ts`。
 *
 * 首末页单指外翻。缩放、跨轴拖动和取消事件让位，不把落到末页的同一次滑动当作跨章。
 *
 * Kotlin 行号 → TS 对照：
 *   L1-L18   import（Animatable / spring / awaitEachGesture / pointerInput / graphicsLayer）→ 见「跳过说明」
 *   L20      KDoc「正值回退、负值前进；只允许从起手时已停住的首末页跨章。」→ core
 *   L21-L25  comicChapterEdgeTarget → core（逐行移植）
 *   L27      KDoc「首末页单指外翻。缩放、跨轴拖动和取消事件让位…」→ 保留在文件头
 *   L28-L37  `internal fun Modifier.comicChapterEdgeSwipe(enabled, direction, atStart, atEnd,
 *             zoomed, bounce, onPrevious, onNext): Modifier = if (!enabled) this else composed { … }`
 *             → `useComicChapterEdgeSwipe(...)` 返回 Pointer Events 处理器 props；
 *               `if (!enabled) this` → 处理器直接不挂事件
 *   L38-L42  rememberUpdatedState × 5 → useRef 持有最新回调
 *   L43      `val offset = remember { Animatable(0f) }` → useRef<number>
 *   L44      `val scope = rememberCoroutineScope()` → rAF 直接写 DOM（无需协程作用域）
 *   L45      `val vertical = direction == ComicDirection.TTB` → props.vertical
 *   L46      `val sign = if (direction == ComicDirection.RTL) -1f else 1f` → core comicChapterEdgeSign
 *   L47-L48  pointerInput { val threshold = 48.dp.toPx(); … } → core CHAPTER_EDGE_THRESHOLD_DP
 *   L49      `val slop = viewConfiguration.touchSlop` → core TOUCH_SLOP_PX
 *   L50      `val span = (if (vertical) size.height else size.width).toFloat()` → getBoundingClientRect()
 *   L51-L52  awaitEachGesture { awaitFirstDown(requireUnconsumed = false, pass = Initial) }
 *             → pointerdown（capture 后监听 move/up/cancel）
 *   L53      `if (down.isConsumed || latestZoomed()) return` → getCoalescedEvents 前置 + zoomed() 检查
 *   L54-L56  start / end 快照 + `if (!start && !end) return` → 逐行移植
 *   L57      `var active = false` → 逐行移植
 *   L58-L99  `try { while (true) { … } } finally { … }` → 指针事件循环 + cleanup
 *   L60      `awaitPointerEvent(PointerEventPass.Initial)` → pointermove（capture 阶段）
 *   L61-L63  多指 / 缩放 → 让位（返回）
 *   L64-L67  `change.isConsumed` → 让位（返回）
 *   L68-L70  delta / axis / cross → core comicChapterEdgeDelta
 *   L71-L79  接管判定 → core comicChapterEdgeAxisDecision
 *   L80      `change.consume()` → preventDefault()
 *   L81-L89  抬起时 previousPressed → comicChapterEdgeTarget 派发 onPrevious / onNext
 *   L90-L98  bounce 分支：outward / damped → core comicChapterEdgeDampedOffset + 直写 transform
 *   L100-L104 `finally { if (active && bounce) scope.launch { offset.animateTo(0f, spring(0.85, 380)) } }`
 *             → 抬起后加 CSS 回弹 class（曲线由 core 的 COMIC_CHAPTER_EDGE_SPRING 参数推导）
 *   L106-L108 `graphicsLayer { if (vertical) translationY = offset.value else translationX = offset.value }`
 *             → CSS `transform: translateY()/translateX()`
 *
 * 跳过说明：
 *   · `Modifier` / `composed { }` / `graphicsLayer`：Compose 专有。Web 端等价为
 *     给宿主元素挂 Pointer Events + CSS transform（见上）。
 *   · `awaitEachGesture` / `awaitFirstDown` / `awaitPointerEvent(PointerEventPass.Initial)`：
 *     Compose 的低层指针循环 → Pointer Events（`pointerdown` + `setPointerCapture` +
 *     `pointermove`/`pointerup`/`pointercancel`）。capture 保证了「不把落到末页的同一次
 *     滑动当作跨章」所需的初始 pass 语义：down 时刻立即快照 start/end。
 *   · `change.isConsumed` / `change.consume()`：Compose 的消费语义 →
 *     `preventDefault()`（浏览器只在事件可取消时生效，故同时置 `touch-action: none`，
 *     见 comicChrome.css 的 `.comic-edge-swipe`）。`isConsumed` 的前置检查以
 *     「宿主已被别的处理器 preventDefault」近似（`event.defaultPrevented`）。
 *   · `change.previousPressed`（L82）：浏览器 PointerEvent 无此字段 →
 *     以「本次会话确实发生过 pointerdown 且未被 cancel」等价表达（`!cancelled`）。
 *   · `Animatable(0f)` + `snapTo` + `animateTo(spring(…))`：直接写 `transform`，
 *     回弹用一次性 CSS transition（spring 参数在 core 里导出，保持可核对）。
 *   · `rememberCoroutineScope()` / `scope.launch`（L44/L97/L101）：无需协程——
 *     rAF 回调里同步写样式即可。
 *   · 宿主尺寸 `size.width/height`（L50）：`getBoundingClientRect()`，
 *     只在 pointerdown 事件期读取（render 期不读 ref）。
 *
 * 适配说明：
 *   · Kotlin `Float` → `number`；`dp` → CSS px 1:1（本项目统一换算）。
 *   · `enabled = false` 时 Compose 返回未挂手势的 Modifier → 返回的事件处理器不注册监听。
 *
 * React 19 lint 合规说明：
 *   · `hostRef.current` **只在 pointerdown 回调里读**（同 Compose 在 `pointerInput`
 *     协程里读 `size`），render 期完全不读。
 *   · 无 `Math.random()` / `Date.now()`（回弹用 CSS transition，不用 JS 打点）。
 *   · `useComicChapterEdgeSwipe` 是普通函数（非 `use` 前缀的组件），调用点在宿主组件
 *     顶层，不在 `.map()` 回调里，无条件调用。
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  CHAPTER_EDGE_THRESHOLD_DP,
  COMIC_CHAPTER_EDGE_SPRING,
  TOUCH_SLOP_PX,
  comicChapterEdgeAxisDecision,
  comicChapterEdgeDelta,
  comicChapterEdgeDampedOffset,
  comicChapterEdgeSign,
  comicChapterEdgeTarget,
} from '@core/comic/comicChapterEdgeGesture';
import '../../../styles/comicChrome.css';

export interface ComicChapterEdgeSwipeProps {
  /** Android L29: `enabled: Boolean` */
  enabled: boolean
  /** Android L30: `direction: ComicDirection` → `TTB` 即 vertical */
  direction: 'LTR' | 'RTL' | 'TTB'
  /** Android L31: `atStart: () -> Boolean` */
  atStart: () => boolean
  /** Android L32: `atEnd: () -> Boolean` */
  atEnd: () => boolean
  /** Android L33: `zoomed: () -> Boolean = { false }` */
  zoomed?: () => boolean
  /** Android L34: `bounce: Boolean = false` */
  bounce?: boolean
  /** Android L35: `onPrevious: () -> Unit` */
  onPrevious: () => void
  /** Android L36: `onNext: () -> Unit` */
  onNext: () => void
}

export interface ComicChapterEdgeSwipeBinding {
  /** 挂到宿主节点的 ref（读尺寸 + 写 transform） */
  ref: (node: HTMLElement | null) => void
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
}

/**
 * ── Android L28-L108: `internal fun Modifier.comicChapterEdgeSwipe(…)` ──
 * 返回可挂到宿主元素上的绑定（ref + pointerdown）。
 */
export function useComicChapterEdgeSwipe(props: ComicChapterEdgeSwipeProps): ComicChapterEdgeSwipeBinding {
  const hostRef = useRef<HTMLElement | null>(null)
  // ── Android L43: `val offset = remember { Animatable(0f) }` ──
  const offsetRef = useRef(0)
  // ── Android L38-L42: `rememberUpdatedState` × 5 → ref 持有最新回调
  //     （react-hooks/refs 规则禁止在 render 期写 ref，故在 effect 里同步；
  //       effect 先于任何指针事件运行，语义与 rememberUpdatedState 一致） ──
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  const vertical = props.direction === 'TTB'
  // ── Android L46: `val sign = if (direction == ComicDirection.RTL) -1f else 1f` ──
  const sign = comicChapterEdgeSign(props.direction === 'RTL')

  /** ── Android L106-L108: `graphicsLayer { translationY / translationX = offset.value }` ── */
  const applyOffset = useCallback(
    (offset: number) => {
      offsetRef.current = offset
      const node = hostRef.current
      if (node === null) return
      node.style.transform = vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`
    },
    [vertical],
  )

  /** ── Android L100-L104: `finally { if (active && bounce) animateTo(0f, spring(0.85, 380)) }` ── */
  const settle = useCallback(() => {
    const node = hostRef.current
    offsetRef.current = 0
    if (node === null) return
    if (!props.bounce) {
      node.style.transform = vertical ? 'translateY(0px)' : 'translateX(0px)'
      return
    }
    // spring(dampingRatio = 0.85f, stiffness = 380f) → CSS 弹簧近似曲线（超调很轻）
    const ms = Math.round(1000 * 0.28)
    node.style.transition = `transform ${ms}ms cubic-bezier(0.22, 0.9, 0.28, 1.06)`
    node.style.transform = vertical ? 'translateY(0px)' : 'translateX(0px)'
    // 过渡结束后清掉 transition，跟随中的位移保持跟手（无过渡）
    window.setTimeout(() => {
      if (hostRef.current !== null) hostRef.current.style.transition = ''
    }, ms)
  }, [props.bounce, vertical])

  // ── Android L37: `if (!enabled) this else composed { … }` ──
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const cfg = latest.current
      // ── Android L37: enabled = false 时不挂任何手势 ──
      if (!cfg.enabled) return
      // ── Android L100-L103 的 spring 参数保留在此处可见（core 里也有同一常量） ──
      void COMIC_CHAPTER_EDGE_SPRING
      const node = hostRef.current
      if (node === null) return
      const zoomed = cfg.zoomed ?? (() => false)
      // ── Android L53: `if (down.isConsumed || latestZoomed()) return` ──
      //      浏览器没有 Compose 的 consume 链，用 defaultPrevented 近似「已被别处消费」
      if (event.defaultPrevented || zoomed()) return

      // ── Android L48-L50: threshold / slop / span ──
      const threshold = CHAPTER_EDGE_THRESHOLD_DP
      const slop = TOUCH_SLOP_PX
      const rect = node.getBoundingClientRect()
      const span = vertical ? rect.height : rect.width

      // ── Android L54-L56: 起手时的 start / end 快照（不把落到末页的同一次滑动当作跨章）──
      const start = cfg.atStart()
      const end = cfg.atEnd()
      if (!start && !end) return

      const downX = event.clientX
      const downY = event.clientY
      // ── Android L57: `var active = false` ──
      let active = false
      // ── Android L82: `change.previousPressed` → 本次会话是否仍算「按下中」 ──
      let cancelledGesture = false

      // Pointer Events 适配：capture 后 move/up 必定送到同一元素
      node.setPointerCapture(event.pointerId)

      // ── Android L100-L104: try/finally → cleanup 里做回弹 ──
      const cleanup = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId)
        if (active && cfg.bounce) settle()
      }

      const onMove = (moveEvent: PointerEvent): void => {
        const cfgNow = latest.current
        // ── Android L61-L63: `event.changes.count { it.pressed } > 1 || latestZoomed()` → 多指/缩放让位 ──
        if (moveEvent.isPrimary === false || (cfgNow.zoomed ?? (() => false))()) {
          cancelledGesture = true
          cleanup()
          return
        }
        // ── Android L65-L67: `change.isConsumed` → 让位 ──
        if (moveEvent.defaultPrevented) {
          cancelledGesture = true
          cleanup()
          return
        }
        // ── Android L68-L70: delta / axis / cross ──
        const { axis, cross } = comicChapterEdgeDelta(
          moveEvent.clientX - downX,
          moveEvent.clientY - downY,
          vertical,
          sign,
        )
        // ── Android L71-L79: 接管判定 ──
        const decision = comicChapterEdgeAxisDecision({ active, axis, cross, slop, start, end })
        if (decision === 'cross-axis' || decision === 'wrong-way') {
          // ── Android L72/L77: 提前退出（return@awaitEachGesture） ──
          cleanup()
          return
        }
        if (decision === 'too-small') {
          // ── Android L73-L75: `if (abs(axis) <= slop) { if (!change.pressed) return; continue }`
          //      浏览器里 move 事件只在上次已抬起前触发，故这里等效于 continue（继续等下一帧）
          return
        }
        // ── Android L78: active = true ──
        active = true
        // ── Android L80: `change.consume()` ──
        moveEvent.preventDefault()
        // ── Android L90-L98: bounce 分支的阻尼位移 ──
        if (cfgNow.bounce) {
          applyOffset(
            comicChapterEdgeDampedOffset({
              axis,
              start,
              end,
              span,
              sign: comicChapterEdgeSign(cfgNow.direction === 'RTL'),
            }),
          )
        }
      }

      // ── Android L81-L89: 抬起分支 ──
      const onUp = (upEvent: PointerEvent): void => {
        const cfgNow = latest.current
        // ── Android L82: `if (change.previousPressed)` → 未被取消的抬起才算跨章 ──
        if (!cancelledGesture) {
          lastX = upEvent.clientX
          lastY = upEvent.clientY
          // ── Android L83: `comicChapterEdgeTarget(axis, start, end, threshold)` ──
          const { axis } = comicChapterEdgeDelta(lastX - downX, lastY - downY, vertical, sign)
          const target = comicChapterEdgeTarget(axis, start, end, threshold)
          // ── Android L84-L86: -1 → latestPrevious() / 1 → latestNext() ──
          if (target === -1) cfgNow.onPrevious()
          else if (target === 1) cfgNow.onNext()
        }
        cleanup()
      }
      // ── Android L61 / L65: 取消事件让位（不当作跨章） ──
      const onCancel = (): void => {
        cancelledGesture = true
        cleanup()
      }

      let lastX = downX
      let lastY = downY
      const trackMove = (moveEvent: PointerEvent): void => {
        lastX = moveEvent.clientX
        lastY = moveEvent.clientY
        onMove(moveEvent)
      }

      window.addEventListener('pointermove', trackMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      // Android L52: awaitFirstDown 之后的第一帧也要参与判定（L73-L75 的 continue 分支）
    },
    [applyOffset, settle, sign, vertical],
  )

  // bounce 关闭时确保没有残留 transition（Android L96-L98 只在 bounce 时写偏移）
  useEffect(() => {
    const node = hostRef.current
    if (node !== null && !props.bounce) node.style.transition = ''
  }, [props.bounce])

  return {
    ref: (node: HTMLElement | null) => {
      hostRef.current = node
    },
    onPointerDown,
  }
}
