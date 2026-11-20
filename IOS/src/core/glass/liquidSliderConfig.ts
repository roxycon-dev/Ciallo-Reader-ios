/**
 * `LiquidSliderConfig` —— `ui/components/LiquidSlider.kt` L25-43 的逐值移植。
 *
 * Kotlin 注释：「One physical and visual specification for every slider in the app.
 * Units are dp/seconds.」 —— 全站滑块的唯一物理/视觉规格，单位 dp 与秒。
 *
 * 每个常量都在 `docs/PARITY_LEDGER.md` 里对得上行号，测试
 * `tests/parity/liquidControlsParity.test.ts` 从 Kotlin 原文取数逐一比对。
 */
export const LiquidSliderConfig = {
  /** L26 控件高度（dp）。 */
  HEIGHT: 110,
  /** L27 曲线采样点数。 */
  SAMPLES: 96,
  /** L28 `steps` 上限（`OrdinarySlider` 的 `steps.coerceIn(0, MAX_STOPS)`）。 */
  MAX_STOPS: 200,
  /** L29 轨道粗细（dp）。 */
  TRACK: 6,
  /** L30 液滴弯曲幅度（dp）。 */
  BEND: 11,
  /** L31 尾迹比例。 */
  TAIL: 0.045,
  /** L32 液滴半径（dp）。 */
  RADIUS: 14,
  /** L33 按压时半径增量（dp）。 */
  PRESS_RADIUS: 3.5,
  /** L34 透镜折射强度。 */
  LENS: 1.6,
  /** L35/L36 位置弹簧（k / d）。 */
  POSITION_K: 760,
  POSITION_D: 36,
  /** L37/L38 步进弹簧（k / d）。 */
  STEP_K: 620,
  STEP_D: 30,
  /** L39/L40 弯曲弹簧（k / d）。 */
  BEND_K: 260,
  BEND_D: 9,
  /** L41 按压缩放速率（1/s）。 */
  PRESS_RATE: 14,
  /** L42 单帧时间上限（秒）。 */
  MAX_DT: 0.033,
} as const;
