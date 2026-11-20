/**
 * `LiquidSegmentPhysics` —— `ui/components/LiquidSegmentPhysics.kt` L11-128 的逐行 TS 移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L12  `class Spring(var x, var v, var target)`          → `Spring`
 *   L13-16 `class Satellite(anchor, stiffness, radius, offsetY)` → `Satellite`
 *   L17-20 `left` / `right` / `wobble` / `press`            → 同名字段
 *   L21  `satellites = arrayOf(Satellite(-.3f,140f,11f,3f), (.15f,95f,8f,-4f), (-.05f,65f,5.5f,1f))`
 *   L30  `slotWidth = ((width - 8f) / count.coerceAtLeast(1)).coerceAtLeast(1f)`
 *   L40-45 `select(i, snap)`：`left.target = 4f + slotWidth * index`，`right.target = left.target + slotWidth`
 *   L61-73 `dragBy(distance, speed, reduceMotion)`：越界阻尼 .25、速度 clamp ±2400、stretch ≤ 14
 *   L82-122 `step(seconds)`：1/30 帧上限 + 1/120 子步；左右弹簧 (520,30)/(230,21)；
 *           wobble (-190x -7.5v -.0036a)；press (260,22)；卫星 (stiffness, 2·sqrt(k)·.62)；
 *           收敛判据 <2f / <.1f / <.002f / <.05f
 *
 * 全部常量照抄，单位是 dp / 秒（Kotlin 注释 L10：与屏幕密度无关）。
 */

/** `LiquidSegmentPhysics.Spring`。 */
export class Spring {
  constructor(
    public x = 0,
    public v = 0,
    public target = 0,
  ) {}
}

/** `LiquidSegmentPhysics.Satellite`（L13-16）。 */
export class Satellite {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 0;
  vr = 0;
  /** L15 `damping = 2f * sqrt(stiffness) * .62f`。 */
  readonly damping: number;

  constructor(
    readonly anchor: number,
    readonly stiffness: number,
    readonly radius: number,
    readonly offsetY: number,
  ) {
    this.damping = 2 * Math.sqrt(stiffness) * 0.62;
  }
}

/** `LiquidSegmentPhysics`（`ui/components/LiquidSegmentPhysics.kt` L11-128）。 */
export class LiquidSegmentPhysics {
  readonly left = new Spring();
  readonly right = new Spring();
  readonly wobble = new Spring();
  readonly press = new Spring();
  /** L21 三个卫星（anchor / stiffness / radius / offsetY）。 */
  readonly satellites: readonly Satellite[] = [
    new Satellite(-0.3, 140, 11, 3),
    new Satellite(0.15, 95, 8, -4),
    new Satellite(-0.05, 65, 5.5, 1),
  ];

  width = 0;
  height = 0;
  count = 0;
  index = 0;
  dragging = false;
  private previousVelocity = 0;
  private dragLeft = 0;
  private dragDistance = 0;

  /** L30。 */
  get slotWidth(): number {
    return Math.max((this.width - 8) / Math.max(this.count, 1), 1);
  }

  /** L31。 */
  get center(): number {
    return (this.left.x + this.right.x) * 0.5;
  }

  /** L32。 */
  get velocity(): number {
    return (this.left.v + this.right.v) * 0.5;
  }

  /** L34-38。 */
  resize(w: number, h: number, n: number, selectedIndex: number): void {
    this.width = w;
    this.height = h;
    this.count = n;
    this.dragging = false;
    this.select(selectedIndex, true);
  }

  /** L40-45。 */
  select(i: number, snap = false): void {
    this.index = Math.min(Math.max(i, 0), Math.max(this.count - 1, 0));
    this.left.target = 4 + this.slotWidth * this.index;
    this.right.target = this.left.target + this.slotWidth;
    if (snap) this.settle();
  }

  /** L47-55。 */
  settle(): void {
    this.left.x = this.left.target;
    this.right.x = this.right.target;
    this.left.v = 0;
    this.right.v = 0;
    this.previousVelocity = 0;
    this.wobble.x = 0;
    this.wobble.v = 0;
    this.press.x = this.press.target;
    this.press.v = 0;
    for (const q of this.satellites) {
      q.x = this.center + q.anchor * this.slotWidth * 0.5;
      q.y = this.height * 0.5 + q.offsetY;
      q.vx = 0;
      q.vy = 0;
      q.r = 0;
      q.vr = 0;
    }
  }

  /** L57-60。 */
  beginDrag(): void {
    this.dragging = true;
    this.dragLeft = this.left.x;
    this.dragDistance = 0;
    this.press.target = 1;
  }

  /** L61-73。 */
  dragBy(distance: number, speed: number, reduceMotion: boolean): void {
    this.dragDistance += distance;
    const limit = 4 + this.slotWidth * Math.max(this.count - 1, 0);
    let x = this.dragLeft + this.dragDistance;
    if (x < 4) x = 4 - (4 - x) * 0.25;
    if (x > limit) x = limit + (x - limit) * 0.25;
    const v = reduceMotion ? 0 : Math.min(Math.max(speed, -2400), 2400);
    const stretch = Math.min(Math.abs(v) / 60, 14);
    this.left.x = x - (v < 0 ? stretch : 0);
    this.right.x = x + this.slotWidth + (v > 0 ? stretch : 0);
    this.left.v = v;
    this.right.v = v;
    this.index = Math.min(
      Math.max(Math.trunc((x - 4) / this.slotWidth + 0.5), 0),
      Math.max(this.count - 1, 0),
    );
  }

  /** L75-79。 */
  endDrag(i: number = this.index, reduceMotion = false): void {
    this.dragging = false;
    this.press.target = 0;
    this.left.v = Math.min(Math.max(this.left.v, -1500), 1500);
    this.right.v = Math.min(Math.max(this.right.v, -1500), 1500);
    this.select(i, reduceMotion);
  }

  /** L82-122：返回 false 表示已收敛，调用方可以停掉帧回调。 */
  step(seconds: number): boolean {
    let remaining = Math.min(Math.max(seconds, 0), 1 / 30);
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      remaining -= dt;
      if (!this.dragging) {
        const movingRight = this.right.target > this.right.x || this.left.target > this.left.x;
        integrate(movingRight ? this.right : this.left, 520, 30, dt);
        integrate(movingRight ? this.left : this.right, 230, 21, dt);
      } else {
        this.left.v *= Math.exp(-12 * dt);
        this.right.v = this.left.v;
      }
      const v = this.velocity;
      const acceleration = (v - this.previousVelocity) / dt;
      this.previousVelocity = v;
      this.wobble.v += (-190 * this.wobble.x - 7.5 * this.wobble.v - 0.0036 * acceleration) * dt;
      this.wobble.x = Math.min(Math.max(this.wobble.x + this.wobble.v * dt, -0.55), 0.55);
      integrate(this.press, 260, 22, dt);
      const halfWidth = (this.right.x - this.left.x) * 0.5;
      const speedFactor = Math.min(Math.max((Math.abs(v) - 120) / 900, 0), 1);
      for (const q of this.satellites) {
        q.vx += (-q.stiffness * (q.x - this.center - q.anchor * halfWidth) - q.damping * q.vx) * dt;
        q.x += q.vx * dt;
        q.vy += (-120 * (q.y - this.height * 0.5 - q.offsetY) - 12 * q.vy) * dt;
        q.y += q.vy * dt;
        const bounded = Math.min(Math.max(q.x, 4 + q.r), Math.max(4 + q.r, this.width - 4 - q.r));
        if (bounded !== q.x) {
          q.x = bounded;
          q.vx = 0;
        }
        const far = Math.min(
          Math.max((Math.hypot(q.x - this.center, q.y - this.height * 0.5) - halfWidth * 0.55) / 26, 0),
          1,
        );
        const targetRadius = q.radius * Math.max(speedFactor, far);
        q.vr += (-220 * (q.r - targetRadius) - 22 * q.vr) * dt;
        q.r = Math.max(0, q.r + q.vr * dt);
      }
    }
    const calm =
      (this.dragging ||
        (Math.abs(this.left.v) < 2 &&
          Math.abs(this.right.v) < 2 &&
          Math.abs(this.left.x - this.left.target) < 0.1 &&
          Math.abs(this.right.x - this.right.target) < 0.1)) &&
      Math.abs(this.velocity) < 2 &&
      Math.abs(this.wobble.x) < 0.002 &&
      Math.abs(this.wobble.v) < 0.02 &&
      Math.abs(this.press.x - this.press.target) < 0.002 &&
      Math.abs(this.press.v) < 0.02 &&
      this.satellites.every((q) => q.r < 0.05 && Math.abs(q.vx) < 1 && Math.abs(q.vy) < 1 && Math.abs(q.vr) < 0.05);
    if (calm && !this.dragging) this.settle();
    return !calm;
  }
}

/** L124-127 `integrate(spring, stiffness, damping, dt)`。 */
function integrate(s: Spring, stiffness: number, damping: number, dt: number): void {
  s.v += (-stiffness * (s.x - s.target) - damping * s.v) * dt;
  s.x += s.v * dt;
}
