/**
 * `me/trishiraj/shadowglow/Parallax.kt`（81 行 / 62 非空）→ `@core/ui/gyroParallax`。
 *
 * 端口此前是 `parityMisc.ts` 里一个**凭空的公式**：
 *
 * ```ts
 * export function rememberGyroParallaxState(sensitivity, gamma = 0, beta = 0) {
 *   return { x: (gamma / 45) * sensitivity, y: (beta / 90) * sensitivity };
 * }
 * ```
 *
 * 而 Kotlin 的四处关键语义一个都没有：
 *
 * 1. **相对基线，不是绝对姿态**。L45-46 第一帧只把 `(pitch, roll)` 记成基线，
 *    之后算 `deltaPitch = currentPitch - basePitch` / `deltaRoll = currentRoll - baseRoll`（L51-52）。
 *    直接拿绝对角算，等于假设用户永远正对屏幕 —— 手机本来就歪着拿时，视差一开始就是满偏。
 * 2. **`sin(δ)` 而不是线性归一化**。L54-55 `-sin(deltaRoll) * sensitivityPx` / `sin(deltaPitch) * sensitivityPx`。
 *    小角度下 `sin δ ≈ δ`，但幅度上限是 **±1 个 sensitivity**，不会随角度无限增长；
 *    而 `gamma / 45` 在 90° 时给 2 倍、在 180° 时给 4 倍。
 * 3. **X 是负号**。L54 `newOffsetX = -sin(deltaRoll) * sensitivityPx` —— 向右倾（roll 正）时
 *    内容要往左让，才有「隔着玻璃看」的错觉；写成正号视差方向整个反过来。
 * 4. **`sensitivity` 是 Dp，要 `toPx()`**（L22 `with(density) { sensitivity.toPx() }`）。
 *    端口把 Dp 当成无量纲系数，于是同一份配置在不同 DPI 上幅度不同。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `sensitivity.toPx()` | L22 | `gyroSensitivityPx(sensitivityDp, density)` |
 * | `baselineOrientation == null` 时记录基线 | L45-46 | `gyroParallaxSample()` 的首次采样 |
 * | `deltaPitch` / `deltaRoll` | L51-52 | 同上 |
 * | `-sin(deltaRoll) * px` / `sin(deltaPitch) * px` | L54-55 | `gyroParallaxOffset()` |
 * | `SENSOR_DELAY_UI` | L66 | `GYRO_SENSOR_DELAY_UI` |
 * | 无旋转传感器 → 基线清空 | L68-70 | `hasSensor: false` 分支 |
 * | `onDispose` 复位 | L72-78 | `reset()` |
 *
 * 平台差异
 * ────────
 * - `SensorManager` / `SensorEvent`（`TYPE_ROTATION_VECTOR`）→ Web 侧 `DeviceOrientationEvent`
 *   （`alpha`/`beta`/`gamma`）。`getOrientation` 给的是 `[azimuth, pitch, roll]`，
 *   对应 `DeviceOrientation` 的 `beta`（前后倾）与 `gamma`（左右倾）；`alpha`（罗盘）不参与。
 *   iOS 需要 `requestPermission()`（Safari 13+），那属于平台层，本模块只吃角度。
 * - `State<Pair<Float, Float>>` → `{ x, y }` 的纯值。
 * - `remember` / `DisposableEffect` 的生命周期在 `useGyroParallax()`（UI 层），
 *   本模块只做**可判定的算术**与基线状态机。
 */

/** L66 `SensorManager.SENSOR_DELAY_UI` 的 Web 等价节流（毫秒）—— UI 档约 16.7 Hz。 */
export const GYRO_SENSOR_DELAY_UI_MS = 1000 / 60;

/** L22 `with(density) { sensitivity.toPx() }`。 */
export function gyroSensitivityPx(sensitivityDp: number, density: number): number {
  return sensitivityDp * density;
}

export interface GyroOffset {
  readonly x: number;
  readonly y: number;
}

/** 零偏移（L24 `mutableStateOf(0f to 0f)`）。 */
export const GYRO_OFFSET_ZERO: GyroOffset = { x: 0, y: 0 };

/**
 * L51-56：由**相对基线**的倾角差算出像素偏移。
 *
 * ```
 * val newOffsetX = -sin(deltaRoll) * sensitivityPx
 * val newOffsetY = sin(deltaPitch) * sensitivityPx
 * ```
 *
 * @param deltaPitch 当前 pitch − 基线 pitch（弧度，`getOrientation[1]` / `beta`）
 * @param deltaRoll  当前 roll − 基线 roll（弧度，`getOrientation[2]` / `gamma`）
 * @param sensitivityPx `sensitivity.toPx()`
 */
export function gyroParallaxOffset(deltaPitch: number, deltaRoll: number, sensitivityPx: number): GyroOffset {
  return {
    x: -Math.sin(deltaRoll) * sensitivityPx,
    y: Math.sin(deltaPitch) * sensitivityPx,
  };
}

/** 基线姿态（L25 `baselineOrientation: FloatArray?`，取 `[pitch, roll]`）。 */
export interface GyroBaseline {
  readonly pitch: number;
  readonly roll: number;
}

/**
 * 一次采样的结果：
 * - `baseline === null` 表示这一帧只是**建立基线**，偏移保持 `(0, 0)`；
 * - 否则给出新的偏移。
 */
export interface GyroSample {
  readonly baseline: GyroBaseline;
  readonly offset: GyroOffset;
  /** 这一帧是否只是建立基线（L45-46）。 */
  readonly established: boolean;
}

/**
 * L37-58 的整段 `onSensorChanged` 语义：
 *
 * ```
 * if (baseline == null) { baseline = [pitch, roll]; offset 不变 }
 * else { offset = (-sin(roll - baseRoll), sin(pitch - basePitch)) * px }
 * ```
 *
 * 注意「建立基线那一帧**不改** offset」—— 端口若在同帧就返回 `sin(0)*px = 0`，
 * 结果一样；但若基线用的是**上一次**的（而不是首帧的），就会把「用户换了个姿势拿手机」
 * 变成永久偏移。所以基线必须**只**在首帧建立，之后不再更新（Kotlin 的 `else` 分支不写基线）。
 */
export function gyroParallaxSample(
  baseline: GyroBaseline | null,
  pitch: number,
  roll: number,
  sensitivityPx: number,
): GyroSample {
  if (baseline === null) {
    return { baseline: { pitch, roll }, offset: GYRO_OFFSET_ZERO, established: true };
  }
  return {
    baseline,
    offset: gyroParallaxOffset(pitch - baseline.pitch, roll - baseline.roll, sensitivityPx),
    established: false,
  };
}

/** L68-70 `if (rotationSensor == null) baselineOrientation.value = null`。 */
export function gyroWithoutSensor(): GyroSample {
  return { baseline: { pitch: 0, roll: 0 }, offset: GYRO_OFFSET_ZERO, established: true };
}

/**
 * L27-79 的整块生命周期状态机（`remember` + `DisposableEffect` 的可判定部分）。
 *
 * 三个动作：
 * - `sample(pitch, roll)` —— 有传感器时按上面那套算；
 * - `dispose()` —— L72-78：注销监听 + `offset = (0, 0)` + 基线清空；
 * - `hasSensor = false` 时 `sample` 恒 `(0, 0)` 且**不**建基线。
 */
export class GyroParallaxSampler {
  private baseline: GyroBaseline | null = null;

  private offset: GyroOffset = GYRO_OFFSET_ZERO;

  private hasSensor: boolean;

  private readonly sensitivityPx: number;

  constructor(sensitivityPx: number, hasSensor = true) {
    this.sensitivityPx = sensitivityPx;
    this.hasSensor = hasSensor;
    if (!hasSensor) this.baseline = null;
  }

  /** L37-58 `onSensorChanged`。 */
  sample(pitch: number, roll: number): GyroOffset {
    if (!this.hasSensor) return GYRO_OFFSET_ZERO;
    const next = gyroParallaxSample(this.baseline, pitch, roll, this.sensitivityPx);
    this.baseline = next.baseline;
    this.offset = next.offset;
    return this.offset;
  }

  /** 当前偏移（`parallaxOffset.value`）。 */
  get value(): GyroOffset {
    return this.offset;
  }

  /** 当前基线（`baselineOrientation.value`），未建立时为 null。 */
  get currentBaseline(): GyroBaseline | null {
    return this.baseline;
  }

  /** 传感器被拔掉（L68-70）。 */
  setSensorPresent(present: boolean): void {
    this.hasSensor = present;
    if (!present) this.baseline = null;
  }

  /** L72-78 `onDispose`：注销监听 → 偏移归零 → 基线清空。 */
  dispose(): void {
    this.offset = GYRO_OFFSET_ZERO;
    this.baseline = null;
  }
}
