/**
 * comicReaderBackground.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicReaderBackground.kt`（164 行 / 非空 157 行）。
 *
 * 阅读背景系统：纯色 / 纸张纹理（程序化生成）/ 沉浸式动态（当前页主色调平滑过渡）。
 *
 * Kotlin 行号 → TS 对照：
 *   L1-L19   import（Bitmap / Compose / SystemClock / Log）→ 见「跳过说明」
 *   L21-L23  KDoc「阅读背景系统」→ 保留在文件头
 *   L24      object ComicReaderBackgrounds → 同名导出对象
 *   L26-L27  private var cachedTexture: Pair<Int, ImageBitmap>? → 模块级 cachedTexture
 *   L29-L35  fun paperTexture(intensity): ImageBitmap → paperTexture(intensity): string（dataURL）
 *   L37-L48  fun paperTextureRaw(intensity): Bitmap → paperTextureRaw(intensity): string
 *            （第六轮第 2 条：Compose 背景层与 CURL 引擎的 GL 背景共用同一份纹理生成，
 *              单一数据源——两种引擎下纸张背景逐像素一致）
 *   L50-L71  private fun generatePaper(key): ImageBitmap → generatePaper(key): string
 *   L74      KDoc「背景渲染：type = BLACK/WHITE/GRAY/PAPER/DYNAMIC(color)」→ 保留
 *   L75-L82  @Composable fun ComicReaderBackground(bgType, paperIntensity, dynamicColor, modifier)
 *            → export function ComicReaderBackground(props)
 *   L83      `when (bgType)` → switch + BLACK/WHITE/GRAY/PAPER/DYNAMIC 五分支
 *   L84      BLACK  → Box(base.background(Color.Black))
 *   L85      WHITE  → Box(base.background(Color(0xFFF7F7F5)))
 *   L86      GRAY   → Box(base.background(Color(0xFF232326)))
 *   L87-L95  PAPER  → remember(paperIntensity) + Image(texture, base.background(Color(0xFFF3ECDF)), Crop)
 *   L96-L110 DYNAMIC 显式 Animatable 构造 → 用 ref 保存插值状态（不进 render 读取）
 *   L112-L132 LaunchedEffect(dynamicColor) 挂钟驱动的逐帧插值 → useEffect + requestAnimationFrame
 *   L133-L150 animated 取值 + DEBUG 信标 LaunchedEffect → 派生值 + import.meta.env.DEV 分支
 *   L151-L161 Box(base.background(Brush.verticalGradient([0.92α, 1α, 0.92α])))
 *            → CSS `linear-gradient(to bottom, …)`（三停靠点位置 0% / 50% / 100%）
 *   L162-L164 各分支收尾
 *
 * 跳过说明：
 *   · `android.graphics.Bitmap` + `Bitmap.createBitmap/setPixels`（L68-L70）：
 *     Web 端无位图对象，改用 `OffscreenCanvas`（退化到 `<canvas>`）+ `putImageData`
 *     + `toDataURL('image/png')`。像素值逐行等价（同一份循环），因此纹理逐像素一致。
 *     `paperTextureRaw` 的「GL 背景 mesh 共用」语义由返回同一条 dataURL 承载。
 *   · `androidx.compose.ui.graphics.ImageBitmap` / `asImageBitmap` / `asAndroidBitmap`
 *     → dataURL 字符串（`<img src>` 直接可用）。
 *   · `androidx.compose.animation.core.Animatable` + `TwoWayConverter`（L101-L111）：
 *     Web 端无组合期动画状态对象；改用 `useRef` 持有 `{ start, end, t }` 插值状态，
 *     每帧写 CSS 变量驱动背景（与 Compose 逐帧 `snapTo` 同节奏）。
 *   · `androidx.compose.runtime.withFrameNanos`（L125）→ `requestAnimationFrame`。
 *   · `android.os.SystemClock.uptimeMillis()`（L122/L126）→ `performance.now()`
 *     （同为单调挂钟；Android 的 vsync 时间戳会大幅跳变正是这里要规避的问题）。
 *   · `androidx.compose.animation.core.FastOutSlowInEasing.transform`（L127）：
 *     Compose 的 FastOutSlowIn = CubicBezier(0.4f, 0f, 0.2f, 1f) → 本文件内
 *     `fastOutSlowInTransform(t)`（标准单位贝塞尔求解，与 Android UnitBezier 同算法）。
 *   · `androidx.compose.ui.graphics.lerp`（L128）→ core 的 `comicPanelLerpColor`
 *     （同为逐通道线性插值，alpha 端点完全一致）。
 *   · `kotlinx.coroutines.isActive`（L124）→ 取消标记（CancelledError / effect cleanup）。
 *   · `com.example.BuildConfig.DEBUG`（L134）→ `import.meta.env.DEV`。
 *   · `androidx.compose.runtime.snapshotFlow { … }.collect`（L137-L149）→
 *     rAF 循环内按同样的采样节拍打点（同一 tag `ComicDynBg`、同一格式串）。
 *   · `android.util.Log.d`（L145）→ `console.debug`（eslint 规则只放行 warn/error，
 *     故加 eslint-disable-next-line；仅 DEBUG 构建触发，与 Kotlin 的 BuildConfig.DEBUG 一致）。
 *   · `Brush.verticalGradient`（L152-L159）→ CSS linear-gradient；三个色标的 alpha
 *     （0.92 / 1 / 0.92）与 Kotlin 完全一致。
 *
 * 适配说明：
 *   · `java.util.Random(20260828L)`（L55）无 Web 等价物，但纹理必须与 Android 逐像素一致，
 *     故**完整移植 java.util.Random 的 48 位 LCG**（`0x5DEECE66D` / `0xB`），
 *     种子常量 `20260828` 原样保留。这是本文件最不容妥协的一段。
 *   · Kotlin `Int` 溢出/`shr`（有符号算术右移）→ `| 0` + `>>`（JS 位运算即 32 位有符号）。
 *   · Kotlin Int 除法向零截断 → `(a / b) | 0`（JS 的 `Math.trunc`）。
 *   · Compose `remember(key)` → `useMemo` / `useRef`（纹理本身在模块级缓存，无需 hook）。
 *   · `Color.Black` → `#000000`；`Color(0xFFF7F7F5)` → `#F7F7F5`；
 *     `Color(0xFF232326)` → `#232326`；`Color(0xFFF3ECDF)` → `#F3ECDF`；
 *     `Color(0xFF101014)` → `#101014`。
 *
 * React 19 lint 合规说明：
 *   · 纹理与插值状态用模块级缓存 / `useRef`；**render 期不读 ref.current**，
 *     派生出的 style 从 `useState` 得到的 `dynamicCss` 直接渲染。
 *   · 无 `Math.random()` / `Date.now()`（RNG 是显式移植的 java.util.Random，种子固定）。
 *   · 无 `setState` in `useEffect` 承载派生数据：`dynamicCss` 由 rAF 回调直接更新
 *     （属于「外部时间线驱动」，不是由 props 派生）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { comicPanelLerpColor } from '@core/comic/comicPanelDesign';
import type { ComicBgType } from '@core/comic/comicPageLayout';
import '../../../styles/comicChrome.css';

//
// ── L50-L71 的纹理生成（依赖下面的 java.util.Random 移植）
//

/**
 * `java.util.Random` 的完整移植（Java 规范：48 位 LCG）。
 * Kotlin L55 用 `java.util.Random(20260828L)`；Web 端必须逐位一致，
 * 否则纸张纹理与 Android 不匹配（跨引擎背景将不再统一）。
 * 规范公式：`seed = (seed ^ 0x5DEECE66D) & ((1<<48)-1)`；
 *           `next(bits): seed = (seed * 0x5DEECE66D + 0xB) & ((1<<48)-1); return seed >>> (48 - bits)`。
 * 用 Number（53 位尾数）承载 48 位无符号数：乘法中间值需拆分避免精度丢失。
 */
class JavaRandom {
  private static readonly MULTIPLIER = 0x5deece66d
  private static readonly MASK = (1 << 48) - 1
  private seed: number

  constructor(seed: number) {
    this.seed = (JavaRandom.MASK & (Math.trunc(seed) ^ JavaRandom.MULTIPLIER)) >>> 0
  }

  /** `next(bits: Int): Int` —— bits ∈ [1, 32]。 */
  next(bits: number): number {
    // 48 位乘法拆成高低两部分，避免 Number 精度不足
    const lo = this.seed & 0xffff
    const mid = (this.seed >>> 16) & 0xffff
    const hi = (this.seed >>> 32) & 0xffff
    const loMul = lo * JavaRandom.MULTIPLIER
    const midMul = mid * JavaRandom.MULTIPLIER + (loMul >>> 16)
    const hiMul = hi * JavaRandom.MULTIPLIER + (midMul >>> 16)
    this.seed = ((hiMul << 32) | ((midMul & 0xffff) << 16) | (loMul & 0xffff)) & JavaRandom.MASK
    return (this.seed >>> (48 - bits)) >>> 0
  }

  /** `nextInt(): Int` = `next(32)` 后按有符号 Int 解释（Kotlin 里可能为负）。 */
  nextInt(): number {
    return this.next(32) | 0
  }
}

/** Kotlin Int 除法（向零截断）。 */
function intDiv(a: number, b: number): number {
  return (a / b) | 0
}

/**
 * ── Android L50-L71: `private fun generatePaper(key: Int): ImageBitmap` ──
 * 逐行移植（含 java.util.Random 的噪声序列、横向纤维扰动、逐通道 clamp）。
 * 返回 PNG dataURL（Web 端「位图」的等价物）。
 */
function generatePaper(key: number): string {
  // ── L51-L56 ──
  const size = 256
  const base = [0xf3ecdf, 0xf1e9db]
  const amp = 2 + intDiv(key * 9, 20)
  const pixels = new Uint8ClampedArray(size * size)
  const rnd = new JavaRandom(20260828)
  let noise = 0

  for (let i = 0; i < pixels.length; i++) {
    // ── L58: noise = (noise * 3 + rnd.nextInt()) shr 2 ──
    noise = (Math.imul(noise, 3) + rnd.nextInt()) >> 2
    // ── L59: val n = (noise and 0xFF) - 128 ──
    const n = (noise & 0xff) - 128
    // ── L61: 横向纤维：x 相关微扰 → val fiber = ((i % size) % 37 - 18) / 6 ──
    const fiber = intDiv(intDiv(i % size, 1) % 37 - 18, 6)
    // ── L62: val c = base[abs(i / size) % 2] ──
    const c = base[Math.abs(intDiv(i, size)) % 2] as number
    // ── L63-L65: 三通道各自的噪声/纤维权重 ──
    const r = Math.min(Math.max((((c >>> 16) & 0xff) + intDiv(n * amp, 128) + intDiv(fiber * amp, 24)) | 0, 0), 255)
    const g = Math.min(Math.max((((c >>> 8) & 0xff) + intDiv(n * amp, 128) + intDiv(fiber * amp, 26)) | 0, 0), 255)
    const b = Math.min(Math.max(((c & 0xff) + intDiv(n * amp, 132) + intDiv(fiber * amp, 28)) | 0, 0), 255)
    // ── L66: pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b ──
    //        Canvas ImageData 是 RGBA 顺序（与 ARGB 整数仅字节序不同）
    pixels[i * 4] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
    pixels[i * 4 + 3] = 0xff
  }

  // ── L68-L70: Bitmap.createBitmap(size, size, ARGB_8888) + setPixels ──
  return pixelsToPngDataUrl(pixels, size, size)
}

/** 把 RGBA 像素写成 PNG dataURL（`ImageBitmap` 的 Web 等价物）。
 *  入参声明为 `Uint8ClampedArray<ArrayBuffer>`：`ImageData` 构造器只接受 ArrayBuffer 支撑的
 *  视图，而 `generatePaper` 里 `new Uint8ClampedArray(n)` 正好就是这种（不会把像素复制一遍）。 */
function pixelsToPngDataUrl(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): string {
  const imageData = new ImageData(pixels, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    // 无 2D 上下文（极老环境）：退化为 1×1 透明，避免整页崩
    return TRANSPARENT_PNG
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/** 1×1 透明 PNG（仅在 canvas 不可用时兜底）。 */
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

//
// ── L24-L72  object ComicReaderBackgrounds
//

/** ── Android L27: `private var cachedTexture: Pair<Int, ImageBitmap>?`（模块级缓存） ── */
let cachedTexture: { key: number; image: string } | null = null

export const ComicReaderBackgrounds = {
  /** 生成可平铺纸张纹理（缓存按强度 + 尺寸） ── Android L29-L35 ── */
  paperTexture(intensity: number): string {
    // ── L30: val key = intensity.coerceIn(0, 100) / 5 ── 5% 一档缓存 ──
    const key = intDiv(Math.min(Math.max(intensity, 0), 100), 5)
    // ── L31: cachedTexture?.let { (k, bmp) -> if (k == key) return bmp } ──
    if (cachedTexture !== null && cachedTexture.key === key) return cachedTexture.image
    const image = generatePaper(key)
    cachedTexture = { key, image }
    return image
  },

  /**
   * 原始纹理位图（第六轮第 2 条）：Compose 背景层与 CURL 引擎的 GL 背景
   * 共用同一份纹理生成（单一数据源）——两种引擎下纸张背景逐像素一致。
   * 返回的纹理由缓存持有，调用方不得 recycle（Web 端无 recycle，返回同一 dataURL 缓存值）。
   * ── Android L42-L48 ──
   */
  paperTextureRaw(intensity: number): string {
    const key = intDiv(Math.min(Math.max(intensity, 0), 100), 5)
    if (cachedTexture !== null && cachedTexture.key === key) return cachedTexture.image
    const image = generatePaper(key)
    cachedTexture = { key, image }
    return image
  },
}

//
// ── FastOutSlowInEasing（Android L127 的 `FastOutSlowInEasing.transform`）
//

/** Compose `FastOutSlowInEasing` = `CubicBezierEasing(0.4f, 0f, 0.2f, 1f)`。 */
const FAST_OUT_SLOW_IN = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const

/** 单位贝塞尔 x(t) 与参数 t 的单调求逆（Android `UnitBezier` 同算法：二分 + 牛顿迭代）。 */
function unitBezier(bezier: typeof FAST_OUT_SLOW_IN, x: number): number {
  const ax = 3 * bezier.x1 - 3 * bezier.x2 + 1
  const bx = 3 * bezier.x2 - 6 * bezier.x1
  const cx = 3 * bezier.x1
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleDX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx
  if (x <= 0) return 0
  if (x >= 1) return 1
  // 二分求根（8 次迭代足以到 float 精度）
  let t = x
  for (let i = 0; i < 8; i++) {
    const xNow = sampleX(t) - x
    if (Math.abs(xNow) < 1e-6) return t
    const dx = sampleDX(t)
    if (Math.abs(dx) < 1e-6) break
    t -= xNow / dx
  }
  let lo = 0
  let hi = 1
  t = x
  while (lo < hi) {
    const xNow = sampleX(t)
    if (Math.abs(xNow - x) < 1e-6) break
    if (xNow > x) hi = t
    else lo = t
    t = (hi + lo) / 2
  }
  return t
}

/** `FastOutSlowInEasing.transform(t)`（Android L127）。 */
export function fastOutSlowInTransform(t: number): number {
  // y = ((ay*t + by) * t + cy) * t，a/b/c 由控制点展开
  const ay = 3 * FAST_OUT_SLOW_IN.y1 - 3 * FAST_OUT_SLOW_IN.y2 + 1
  const by = 3 * FAST_OUT_SLOW_IN.y2 - 6 * FAST_OUT_SLOW_IN.y1
  const cy = 3 * FAST_OUT_SLOW_IN.y1
  const u = unitBezier(FAST_OUT_SLOW_IN, t)
  return ((ay * u + by) * u + cy) * u
}

//
// ── L74-L164  @Composable fun ComicReaderBackground
//

export interface ComicReaderBackgroundProps {
  /** Android: `bgType: ComicBgType` */
  bgType: ComicBgType
  /** Android: `paperIntensity: Int` */
  paperIntensity: number
  /** Android: `dynamicColor: Color?` → CSS 颜色（#RRGGBB / #RRGGBBAA / rgb()），null = 回落 #101014 */
  dynamicColor: string | null
  /** Android: `modifier: Modifier` → 宿主 style */
  style?: CSSProperties
  className?: string
}

/** 动态背景的静态回落色 ── Android L103/L120: `Color(0xFF101014)` ── */
const DYNAMIC_FALLBACK = '#101014'

/** ── Android L122/L126: `val dur = 400L` ── */
const DYNAMIC_DURATION_MS = 400

/** 背景渲染：type = BLACK/WHITE/GRAY/PAPER/DYNAMIC(color) ── Android L74 ── */
export function ComicReaderBackground(props: ComicReaderBackgroundProps) {
  // ── Android L82: `val base = modifier.fillMaxSize()` ──
  const base: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    ...props.style,
  }

  // ── L87-L88 PAPER: `remember(paperIntensity) { ComicReaderBackgrounds.paperTexture(paperIntensity) }` ──
  // 纹理本身在模块级按 5% 一档缓存，故 useMemo 只是把 React 侧的依赖对齐；
  // 不在 render 期做任何重计算。
  const paperTexture = useMemo(
    () => (props.bgType === 'PAPER' ? ComicReaderBackgrounds.paperTexture(props.paperIntensity) : ''),
    [props.bgType, props.paperIntensity],
  )

  // ── L96-L162 DYNAMIC ──
  return (
    <ComicReaderBackgroundInner
      bgType={props.bgType}
      dynamicColor={props.dynamicColor}
      paperTexture={paperTexture}
      base={base}
      className={props.className}
    />
  )
}

/**
 * DYNAMIC 分支单独成一个子组件 —— 让 rAF 生命周期只挂在真正需要动画的背景类型上，
 * 避免在父组件里对所有 bgType 都跑一遍 effect（也避免 `.map()` 内出现 hook）。
 */
function ComicReaderBackgroundInner(props: {
  bgType: ComicBgType
  dynamicColor: string | null
  paperTexture: string
  base: CSSProperties
  /** 文件内私有子组件：允许显式 `undefined` 透传（exactOptionalPropertyTypes）。 */
  className?: string | undefined
}) {
  // ── Android L101-L111: `val colorAnim = remember { Animatable(initialValue = dynamicColor ?: Color(0xFF101014)) }` ──
  // 「当前已动画到的色值」进 useState（render 期直接渲染它，绝不读 ref）。
  const dynamicColor = props.dynamicColor
  const [animated, setAnimated] = useState<string>(dynamicColor ?? DYNAMIC_FALLBACK)
  // 插值起点用 ref 保存：只在 effect / rAF 回调里读写（render 期不读）。
  const animatedRef = useRef<string>(dynamicColor ?? DYNAMIC_FALLBACK)

  useEffect(() => {
    // ── Android L119-L120: `val start = colorAnim.value; val end = dynamicColor ?: Color(0xFF101014)` ──
    const start = animatedRef.current
    const end = dynamicColor ?? DYNAMIC_FALLBACK
    // ── Android L121: `if (start != end) { … }` ──
    if (start === end) return
    // ── Android L122-L123: `val t0 = SystemClock.uptimeMillis(); val dur = 400L` ──
    const t0 = performance.now()
    let raf = 0
    let cancelled = false
    // ── Android L137-L149: DEBUG 渐变采样信标的 frame 计数 ──
    let frame = 0
    // ── Android L124: `while (isActive) { withFrameNanos { }; … }` ──
    const tick = (): void => {
      if (cancelled) return
      // ── L126: `val t = (uptimeMillis() - t0).coerceAtMost(dur) / dur.toFloat()` ──
      const t = Math.min((performance.now() - t0) / DYNAMIC_DURATION_MS, 1)
      // ── L127: `val eased = FastOutSlowInEasing.transform(t)` ──
      const eased = fastOutSlowInTransform(t)
      // ── L128: `colorAnim.snapTo(lerp(start, end, eased))` ──
      const next = comicPanelLerpColor(toArgbHex(start), toArgbHex(end), eased)
      animatedRef.current = next
      setAnimated(next)
      // ── Android L134-L150: BuildConfig.DEBUG 下的逐帧采样信标 ──
      if (import.meta.env.DEV && (frame < 6 || frame % 6 === 0)) {
        // eslint-disable-next-line no-console
        console.debug('ComicDynBg', ComicDynBgBeacon.format(next, frame))
      }
      frame++
      // ── L129: `if (t >= 1f) break` ──
      if (t >= 1) return
      raf = requestAnimationFrame(tick)
    }
    // Android L125: `withFrameNanos { }` 只作帧节拍 → 先跑一帧再排下一帧
    raf = requestAnimationFrame(tick)
    return () => {
      // ── Android L124: `while (isActive)` → cleanup 即取消 ──
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [dynamicColor])

  // ── Android L133: `val animated = colorAnim.value` ──
  if (props.bgType === 'BLACK') {
    // ── L84: Box(base.background(Color.Black)) ──
    return <div className={props.className} style={{ ...props.base, background: '#000000' }} />
  }
  if (props.bgType === 'WHITE') {
    // ── L85: Box(base.background(Color(0xFFF7F7F5))) ──
    return <div className={props.className} style={{ ...props.base, background: '#F7F7F5' }} />
  }
  if (props.bgType === 'GRAY') {
    // ── L86: Box(base.background(Color(0xFF232326))) ──
    return <div className={props.className} style={{ ...props.base, background: '#232326' }} />
  }
  if (props.bgType === 'PAPER') {
    // ── L89-L94: Image(bitmap = texture, base.background(Color(0xFFF3ECDF)), ContentScale.Crop) ──
    return (
      <img
        className={`comic-reader-bg comic-reader-bg--image${props.className == null ? '' : ` ${props.className}`}`}
        src={props.paperTexture}
        alt=""
        aria-hidden="true"
        style={{ ...props.base, background: '#F3ECDF' }}
      />
    )
  }

  // ── Android L151-L161: Box(base.background(Brush.verticalGradient([0.92α, 1α, 0.92α]))) ──
  return (
    <div
      className={props.className}
      style={{
        ...props.base,
        // Brush.verticalGradient → 自上而下的三停靠点线性渐变
        background: `linear-gradient(to bottom, ${withAlpha(animated, 0.92)} 0%, ${withAlpha(animated, 1)} 50%, ${withAlpha(
          animated,
          0.92,
        )} 100%)`,
      }}
    />
  )
}

/** Android L141-L146 的信标格式：`"anim frame#$frame argb=%06X".format(argb)`。 */
export const ComicDynBgBeacon = {
  /** 与 Kotlin 相同的 ARGB 十六进制（`%06X`，大写）。 */
  format(color: string, frame: number): string {
    const [r, g, b, a] = parseRgba(color)
    const argb = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0
    return `anim frame#${frame} argb=${argb.toString(16).toUpperCase().padStart(6, '0')}`
  },
}

/** 把任意 CSS 色转成 `#RRGGBBAA`（`comicPanelLerpColor` 的输入约束）。 */
function toArgbHex(color: string): string {
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color
  const [r, g, b, a] = parseRgba(color)
  const hex = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`
}

/** 解析 CSS 色 → [r, g, b, a]（0-255）。支持 #RGB / #RRGGBB / #RRGGBBAA / rgb() / rgba()。 */
function parseRgba(color: string): [number, number, number, number] {
  let hex = color.trim().replace('#', '')
  if (/^rgba?\(/i.test(color)) {
    const nums = color
      .replace(/^rgba?\(/i, '')
      .replace(/\)$/, '')
      .split(/[,/\s]+/)
      .filter((s) => s !== '')
      .map((s) => Number.parseFloat(s))
    const r = Math.round(nums[0] ?? 0)
    const g = Math.round(nums[1] ?? 0)
    const b = Math.round(nums[2] ?? 0)
    const a = Math.round(Math.min(Math.max(nums[3] ?? 1, 0), 1) * 255)
    return [r, g, b, a]
  }
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c)
  if (hex.length === 6) hex += 'FF'
  if (hex.length !== 8) return [0, 0, 0, 255]
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    Number.parseInt(hex.slice(6, 8), 16),
  ]
}

/** `Color.copy(alpha = a)` —— 替换 alpha、保留 RGB（Android L155/L157）。 */
function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseRgba(color)
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
  const hex = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`
}
