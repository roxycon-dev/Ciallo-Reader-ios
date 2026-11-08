/**
 * DOM equivalent of Android `paperComposable` + `PullOutVisibility` for full-page
 * routes. It owns one interruptible spring and samples geometry only while the
 * transition is moving. It never calls View Transitions or captures a document image.
 *
 * Integration:
 *   const paper = createPaperPageTransitionController(pageShell, { origin: triggerRect });
 *   void paper.open(); // call in a layout effect, before the first painted frame
 *   await paper.close();
 *   commitRouteBack(); // unmount only after close resolves as "finished"
 *   paper.dispose();   // when the page shell unmounts
 *
 * `pageShell` must be a dedicated full-page wrapper; while active this controller owns
 * its transform, transform-origin, opacity, clip-path, transition, will-change and
 * pointer-events inline styles. Pass an Element, a DOMRect-like value, or a provider
 * as `origin`. A copied DOMRect survives a route replacement and remains the return
 * geometry if the original trigger is detached before the close animation.
 */

export interface PaperRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type PaperOriginValue = Element | PaperRect | null;
export type PaperOriginInput = PaperOriginValue | (() => PaperOriginValue);
export type PaperTransitionMode = 'paper' | 'surface';
export type PaperTransitionResult = 'finished' | 'interrupted';

export interface PaperFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PaperContourPoint {
  /** Position in the paper's page-local surface coordinate system. */
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
  readonly shade: number;
}

export interface PaperGeometry {
  readonly frame: PaperFrame;
  /** 64 samples across the Kotlin warp frame, used as a live CSS polygon clip. */
  readonly contour: readonly PaperContourPoint[];
}

export interface PaperPageTransitionOptions {
  /** Button or other source rectangle. Omitted/null uses the centered stable surface. */
  origin?: PaperOriginInput;
  /** `paper` ports the Kotlin paper contour; `surface` ports its lightweight branch. */
  mode?: PaperTransitionMode;
  /** Defaults to a closed page (`0`). Use `1` when attaching to an already-open page. */
  initialProgress?: number;
  /** Overrides the OS setting, mainly for deterministic embedding/test environments. */
  reducedMotion?: boolean;
  onProgress?: (progress: number) => void;
}

export interface PaperPageTransitionController {
  /** Current visible progress, clamped to [0, 1]. */
  readonly progress: number;
  /** Target state; it changes immediately when `open` or `close` is called. */
  readonly targetOpen: boolean;
  open(): Promise<PaperTransitionResult>;
  close(): Promise<PaperTransitionResult>;
  /** Update the source before a later transition; geometry is copied immediately. */
  setOrigin(origin: PaperOriginInput): void;
  /** Stops a live frame callback/listener and restores every owned inline style. */
  dispose(): void;
}

export const PAPER_TRANSITION_CONFIG = Object.freeze({
  scrim: 0.35,
  surfaceScale: 0.96,
  surfaceTravel: 12,
  warpRows: 64,
  warpForwardRows: 128,
  warpNeck: 0.3,
  warpDecay: 90,
  warpSoftness: 12,
  warpUnfold: 24,
  warpBend: 16,
  warpFlutter: 4,
  warpShade: 0.025,
  warpOpacityGain: 5,
  openStiffness: 140,
  openDamping: 24,
  closeStiffness: 260,
  closeDamping: 34,
  fallbackOpenStiffness: 800,
  fallbackOpenDamping: 50,
  fallbackCloseStiffness: 1000,
  fallbackCloseDamping: 60,
});

const FORWARD_COUNT = PAPER_TRANSITION_CONFIG.warpForwardRows;
const OUTPUT_ROWS = PAPER_TRANSITION_CONFIG.warpRows;
const SETTLE_POSITION = 0.0005;
const SETTLE_VELOCITY = 0.03125;
const MAX_FRAME_SECONDS = 0.033;
const PAPER_OPEN_SPRING = coefficients(PAPER_TRANSITION_CONFIG.openStiffness, PAPER_TRANSITION_CONFIG.openDamping);
const PAPER_CLOSE_SPRING = coefficients(PAPER_TRANSITION_CONFIG.closeStiffness, PAPER_TRANSITION_CONFIG.closeDamping);
const FALLBACK_OPEN_SPRING = coefficients(
  PAPER_TRANSITION_CONFIG.fallbackOpenStiffness,
  PAPER_TRANSITION_CONFIG.fallbackOpenDamping,
);
const FALLBACK_CLOSE_SPRING = coefficients(
  PAPER_TRANSITION_CONFIG.fallbackCloseStiffness,
  PAPER_TRANSITION_CONFIG.fallbackCloseDamping,
);

interface SpringCoefficients {
  readonly halfDamping: number;
  readonly discriminant: number;
  readonly frequency: number;
  readonly r1: number;
  readonly r2: number;
}

function coefficients(stiffness: number, damping: number): SpringCoefficients {
  const halfDamping = damping / 2;
  const discriminant = halfDamping * halfDamping - stiffness;
  const frequency = Math.sqrt(Math.abs(discriminant));
  return {
    halfDamping,
    discriminant,
    frequency,
    r1: -halfDamping + frequency,
    r2: -halfDamping - frequency,
  };
}

/**
 * Exact Kotlin `PaperWarpGeometry.update` contour equations, with CSS-pixel density 1.
 * `origin` and `surface` use the same viewport coordinate system; returned geometry is
 * local to `surface`. The renderer intentionally keeps the shape/frame math exact while
 * using CSS clipping instead of Android's per-pixel RenderEffect content remap.
 */
export function computePaperGeometry(
  progress: number,
  origin: PaperRect,
  surface: PaperRect,
  density = 1,
): PaperGeometry {
  const q = clamp01(progress);
  const width = Math.max(1, surface.width);
  const height = Math.max(1, surface.height);
  const source = {
    left: origin.left - surface.left,
    top: origin.top - surface.top,
    width: Math.max(0, origin.width),
    height: Math.max(0, origin.height),
  };
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const wave = Math.sin(Math.PI * q);
  const slit = clamp(sourceCenterY, 0, height);
  const far = Math.max(slit, height - slit, 1);
  const softness = PAPER_TRANSITION_CONFIG.warpSoftness * density;
  const lock = (1 - q) * (far + softness * 10) - q * softness * 10;
  const softplus = (value: number): number => {
    if (value > softness * 20) return value;
    if (value < -softness * 20) return 0;
    return softness * Math.log1p(Math.exp(value / softness));
  };
  const base = softplus(-lock);
  const y0 = sourceCenterY + (slit / height - 0.5) * source.height * (1 - q) +
    (slit - sourceCenterY) * q;
  const centerX = sourceCenterX + (width / 2 - sourceCenterX) * q;
  const neckWave = (1 - PAPER_TRANSITION_CONFIG.warpNeck) * Math.pow(Math.max(wave, 0), 0.7);
  const y: number[] = [];
  const center: number[] = [];
  const halfWidth: number[] = [];
  const shade: number[] = [];
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;

  for (let index = 0; index <= FORWARD_COUNT; index += 1) {
    const v = index / FORWARD_COUNT;
    const delta = v * height - slit;
    const absoluteDelta = Math.abs(delta);
    const released = softplus(absoluteDelta - lock) - base;
    const mapped = released + (absoluteDelta - released) * source.height / height;
    const free = clamp01(released / far);
    const neck = 1 - neckWave * Math.exp(-Math.abs(mapped) / (PAPER_TRANSITION_CONFIG.warpDecay * density));
    const unfold = q + (1 - q) * (1 - Math.exp(-released / (PAPER_TRANSITION_CONFIG.warpUnfold * density)));
    const paperWidth = source.width + (width - source.width) * unfold;
    const lineCenter = centerX + density * wave * (
      PAPER_TRANSITION_CONFIG.warpBend * free * free +
      PAPER_TRANSITION_CONFIG.warpFlutter * free * Math.sin(v * 4 + q * 5)
    );
    const lineHalfWidth = paperWidth * neck / 2;
    const lineY = y0 + Math.sign(delta) * mapped;
    const lineShade = 1 - PAPER_TRANSITION_CONFIG.warpShade * (1 - q) * wave * (1 - free) * (1 + Math.sin(v * 9));
    y.push(lineY);
    center.push(lineCenter);
    halfWidth.push(lineHalfWidth);
    shade.push(lineShade);
    left = Math.min(left, lineCenter - lineHalfWidth);
    right = Math.max(right, lineCenter + lineHalfWidth);
  }

  if (q === 0) { left = source.left; right = source.left + source.width; }
  if (q === 1) { left = 0; right = width; }
  const frame: PaperFrame = q === 0
    ? { left: source.left, top: source.top, width: source.width, height: source.height }
    : q === 1
      ? { left: 0, top: 0, width, height }
      : { left, top: y[0] ?? 0, width: Math.max(1, right - left), height: Math.max(1, (y[FORWARD_COUNT] ?? height) - (y[0] ?? 0)) };

  const frameHeight = Math.max(frame.height, 1);
  const contour: PaperContourPoint[] = [];
  let segment = 0;
  for (let row = 0; row < OUTPUT_ROWS; row += 1) {
    const targetY = frame.top + frameHeight * row / (OUTPUT_ROWS - 1);
    while (segment < FORWARD_COUNT - 1 && (y[segment + 1] ?? Number.POSITIVE_INFINITY) < targetY) segment += 1;
    const y0Forward = y[segment] ?? 0;
    const y1Forward = y[segment + 1] ?? y0Forward;
    const t = clamp01((targetY - y0Forward) / Math.max(y1Forward - y0Forward, 0.00001));
    const interpCenter = catmullRom(center, segment, t);
    const interpHalfWidth = catmullRom(halfWidth, segment, t);
    const interpShade = catmullRom(shade, segment, t);
    contour.push({ x: interpCenter, y: targetY, halfWidth: interpHalfWidth, shade: interpShade });
  }
  return { frame, contour };
}

function catmullRom(values: readonly number[], segment: number, t: number): number {
  const a = values[Math.max(0, segment - 1)] ?? 0;
  const b = values[segment] ?? a;
  const c = values[segment + 1] ?? b;
  const d = values[Math.min(values.length - 1, segment + 2)] ?? c;
  return b + 0.5 * t * (
    c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a))
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function isElement(value: PaperOriginValue): value is Element {
  return value !== null && typeof value === 'object' &&
    typeof (value as Element).getBoundingClientRect === 'function';
}

function copyRect(value: PaperRect): PaperRect | null {
  const { left, top, width, height } = value;
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

type OwnedStyle = 'transform' | 'transformOrigin' | 'opacity' | 'clipPath' | 'transition' | 'willChange' | 'pointerEvents';

const OWNED_STYLES: readonly OwnedStyle[] = [
  'transform', 'transformOrigin', 'opacity', 'clipPath', 'transition', 'willChange', 'pointerEvents',
];

class PaperPageTransition implements PaperPageTransitionController {
  private readonly originalStyles: Record<OwnedStyle, string>;
  private readonly reducedMotionOverride: boolean | undefined;
  private readonly onProgress: ((progress: number) => void) | undefined;
  private readonly mode: PaperTransitionMode;
  private readonly mediaQuery: MediaQueryList | null;
  private readonly mediaListener: ((event: MediaQueryListEvent) => void) | null;
  private originInput: PaperOriginInput;
  private cachedOrigin: PaperRect | null = null;
  private surface: PaperRect | null = null;
  private rawProgress: number;
  private target = 0;
  private velocity = 0;
  private lastTime: number | null = null;
  private frameId: number | null = null;
  private waiters: Array<(result: PaperTransitionResult) => void> = [];
  private disposed = false;

  constructor(private readonly element: HTMLElement, options: PaperPageTransitionOptions) {
    this.originInput = options.origin ?? null;
    this.mode = options.mode ?? 'paper';
    this.reducedMotionOverride = options.reducedMotion;
    this.onProgress = options.onProgress;
    this.rawProgress = clamp01(options.initialProgress ?? 0);
    this.target = this.rawProgress >= 1 ? 1 : 0;
    this.originalStyles = Object.fromEntries(OWNED_STYLES.map((property) => [property, element.style[property]])) as Record<OwnedStyle, string>;
    this.cachedOrigin = this.readOrigin();
    this.mediaQuery = options.reducedMotion === undefined && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.mediaListener = this.mediaQuery === null ? null : (event) => {
      if (event.matches && this.frameId !== null) this.finishImmediately(this.target);
    };
    if (this.mediaQuery !== null && this.mediaListener !== null) {
      if (typeof this.mediaQuery.addEventListener === 'function') this.mediaQuery.addEventListener('change', this.mediaListener);
      else this.mediaQuery.addListener?.(this.mediaListener);
    }
    if (this.rawProgress !== 1) this.captureSurface();
    this.render(this.rawProgress);
    if (this.rawProgress === 1) this.restoreStyles();
  }

  get progress(): number { return clamp01(this.rawProgress); }
  get targetOpen(): boolean { return this.target === 1; }

  open(): Promise<PaperTransitionResult> { return this.animateTo(1); }
  close(): Promise<PaperTransitionResult> { return this.animateTo(0); }

  setOrigin(origin: PaperOriginInput): void {
    if (this.disposed) return;
    this.originInput = origin;
    this.cachedOrigin = this.readOrigin();
    if (this.frameId === null && this.rawProgress < 1) this.captureSurface();
    this.render(this.rawProgress);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.detachMotionPreference();
    this.resolveWaiters('interrupted');
    this.restoreStyles();
  }

  private animateTo(target: 0 | 1): Promise<PaperTransitionResult> {
    if (this.disposed) return Promise.resolve('interrupted');
    const wasMoving = this.frameId !== null;
    if (target !== this.target) {
      if (wasMoving) this.resolveWaiters('interrupted');
      else this.captureSurface();
      this.target = target;
    }
    if (!wasMoving && Math.abs(this.rawProgress - target) < SETTLE_POSITION) {
      this.rawProgress = target;
      this.velocity = 0;
      this.render(target);
      if (target === 1) this.restoreStyles();
      return Promise.resolve('finished');
    }
    const pending = new Promise<PaperTransitionResult>((resolve) => this.waiters.push(resolve));
    if (this.isReducedMotion() || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.finishImmediately(target);
    } else if (!wasMoving) {
      this.lastTime = null;
      this.scheduleFrame();
      this.element.style.willChange = 'transform, clip-path, opacity';
    }
    return pending;
  }

  private scheduleFrame(): void {
    if (this.disposed || this.frameId !== null || this.isReducedMotion()) return;
    this.frameId = window.requestAnimationFrame((time) => this.onFrame(time));
  }

  private onFrame(time: number): void {
    this.frameId = null;
    if (this.disposed) return;
    const previous = this.lastTime ?? time;
    const seconds = clamp((time - previous) / 1000, 0, MAX_FRAME_SECONDS);
    this.lastTime = time;
    const opening = this.target === 1;
    const usePaperSpring = this.mode === 'paper' && this.cachedOrigin !== null;
    const spring = usePaperSpring
      ? (opening ? PAPER_OPEN_SPRING : PAPER_CLOSE_SPRING)
      : (opening ? FALLBACK_OPEN_SPRING : FALLBACK_CLOSE_SPRING);
    const moving = this.advanceSpring(this.target, seconds, spring);
    this.render(this.rawProgress);
    if (moving) this.scheduleFrame();
    else this.finishAtTarget();
  }

  private advanceSpring(target: number, seconds: number, spring: SpringCoefficients): boolean {
    const dt = clamp(seconds, 0, MAX_FRAME_SECONDS);
    const halfDamping = spring.halfDamping;
    const x = this.rawProgress - target;
    const discriminant = spring.discriminant;
    let next: number;
    if (discriminant < 0) {
      const frequency = spring.frequency;
      const a = x;
      const b = (this.velocity + halfDamping * x) / frequency;
      const decay = Math.exp(-halfDamping * dt);
      const cosine = Math.cos(frequency * dt);
      const sine = Math.sin(frequency * dt);
      const z = a * cosine + b * sine;
      next = decay * z;
      this.velocity = decay * ((-a * frequency * sine + b * frequency * cosine) - halfDamping * z);
    } else if (discriminant > 0.00001) {
      const a = (this.velocity - spring.r2 * x) / (spring.r1 - spring.r2);
      const b = x - a;
      const e1 = Math.exp(spring.r1 * dt);
      const e2 = Math.exp(spring.r2 * dt);
      next = a * e1 + b * e2;
      this.velocity = spring.r1 * a * e1 + spring.r2 * b * e2;
    } else {
      const b = this.velocity + halfDamping * x;
      const z = x + b * dt;
      const decay = Math.exp(-halfDamping * dt);
      next = decay * z;
      this.velocity = decay * (b - halfDamping * z);
    }
    this.rawProgress = target + next;
    return !(Math.abs(next) < SETTLE_POSITION && Math.abs(this.velocity) < SETTLE_VELOCITY);
  }

  private finishAtTarget(): void {
    this.cancelFrame();
    this.rawProgress = this.target;
    this.velocity = 0;
    this.render(this.target);
    if (this.target === 1) this.restoreStyles();
    else this.restoreWillChange();
    this.resolveWaiters('finished');
  }

  private finishImmediately(target: number): void {
    this.cancelFrame();
    this.target = target;
    this.rawProgress = target;
    this.velocity = 0;
    this.render(target);
    if (target === 1) this.restoreStyles();
    else this.restoreWillChange();
    this.resolveWaiters('finished');
  }

  private cancelFrame(): void {
    if (this.frameId !== null && typeof window !== 'undefined') window.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastTime = null;
  }

  private resolveWaiters(result: PaperTransitionResult): void {
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach((resolve) => resolve(result));
  }

  private isReducedMotion(): boolean {
    return this.reducedMotionOverride ?? this.mediaQuery?.matches ?? false;
  }

  private detachMotionPreference(): void {
    if (this.mediaQuery === null || this.mediaListener === null) return;
    if (typeof this.mediaQuery.removeEventListener === 'function') this.mediaQuery.removeEventListener('change', this.mediaListener);
    else this.mediaQuery.removeListener?.(this.mediaListener);
  }

  private readOrigin(): PaperRect | null {
    const value = typeof this.originInput === 'function' ? this.originInput() : this.originInput;
    if (value === null) return null;
    if (isElement(value)) {
      if (!value.isConnected) return this.cachedOrigin;
      return copyRect(value.getBoundingClientRect()) ?? this.cachedOrigin;
    }
    return copyRect(value) ?? this.cachedOrigin;
  }

  private captureSurface(): void {
    const rect = this.element.getBoundingClientRect();
    const measurable = copyRect(rect);
    if (measurable !== null) this.surface = measurable;
    else if (typeof window !== 'undefined') {
      this.surface = { left: 0, top: 0, width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
    } else this.surface = { left: 0, top: 0, width: 1, height: 1 };
    this.cachedOrigin = this.readOrigin();
  }

  private render(progress: number): void {
    if (this.disposed) return;
    const p = clamp01(progress);
    const source = this.cachedOrigin;
    const surface = this.surface ?? this.measureSurface();
    this.element.style.transition = 'none';
    this.element.style.pointerEvents = p >= 1 && this.target === 1 ? this.originalStyles.pointerEvents : 'none';

    if (this.mode === 'paper' && source !== null) {
      const geometry = computePaperGeometry(p, source, surface);
      const scaleX = geometry.frame.width / Math.max(surface.width, 1);
      const scaleY = geometry.frame.height / Math.max(surface.height, 1);
      this.element.style.transformOrigin = '0 0';
      this.element.style.transform = `translate3d(${geometry.frame.left}px, ${geometry.frame.top}px, 0) scale(${scaleX}, ${scaleY})`;
      this.element.style.clipPath = p >= 1 ? 'none' : polygonFor(geometry);
      this.element.style.opacity = String(Math.min(1, p * PAPER_TRANSITION_CONFIG.warpOpacityGain));
    } else {
      const localCenterX = source === null ? surface.width / 2 : source.left + source.width / 2 - surface.left;
      const localCenterY = source === null ? surface.height / 2 : source.top + source.height / 2 - surface.top;
      const px = source === null ? 0.5 : clamp(localCenterX / Math.max(surface.width, 1), 0, 1);
      const py = source === null ? 0.5 : clamp(localCenterY / Math.max(surface.height, 1), 0, 1);
      const scale = PAPER_TRANSITION_CONFIG.surfaceScale + (1 - PAPER_TRANSITION_CONFIG.surfaceScale) * p;
      const translationY = (1 - p) * PAPER_TRANSITION_CONFIG.surfaceTravel * (py * 2 - 1);
      this.element.style.transformOrigin = `${px * 100}% ${py * 100}%`;
      this.element.style.transform = `translate3d(0, ${translationY}px, 0) scale(${scale})`;
      this.element.style.clipPath = 'none';
      this.element.style.opacity = String(p);
    }
    this.onProgress?.(p);
  }

  private measureSurface(): PaperRect {
    const rect = copyRect(this.element.getBoundingClientRect());
    return rect ?? { left: 0, top: 0, width: 1, height: 1 };
  }

  private restoreStyles(): void {
    for (const property of OWNED_STYLES) this.element.style[property] = this.originalStyles[property];
  }

  private restoreWillChange(): void {
    this.element.style.willChange = this.originalStyles.willChange;
  }
}

function polygonFor(geometry: PaperGeometry): string {
  const frame = geometry.frame;
  const width = Math.max(frame.width, 1);
  const height = Math.max(frame.height, 1);
  const left: string[] = [];
  const right: string[] = [];
  for (const point of geometry.contour) {
    left.push(`${percent((point.x - point.halfWidth - frame.left) / width)} ${percent((point.y - frame.top) / height)}`);
    right.push(`${percent((point.x + point.halfWidth - frame.left) / width)} ${percent((point.y - frame.top) / height)}`);
  }
  return `polygon(${left.concat(right.reverse()).join(',')})`;
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 10_000) / 100}%`;
}

/**
 * Create a full-page paper controller. Call in a layout effect so initial closed
 * styles are applied before paint. The controller's RAF is started only by an active
 * transition and canceled as soon as it settles; there is no background animation loop.
 */
export function createPaperPageTransitionController(
  element: HTMLElement,
  options: PaperPageTransitionOptions = {},
): PaperPageTransitionController {
  return new PaperPageTransition(element, options);
}
