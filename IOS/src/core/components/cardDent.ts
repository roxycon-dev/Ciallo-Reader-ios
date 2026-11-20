/**
 * 卡片凹陷着色 + 阅读进度节流 —— `ui/components/CardDentEffect.kt` L10-50 +
 * `ui/ReaderProgressEffect.kt` L15-38 + `ui/OnboardingScreen.kt` L44-90 的移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   CardDentEffect.kt L10-13 `interface CardDentEffect { available; effect(...) }` → `CardDentEffect`
 *   CardDentEffect.kt L15-20 `createCardDentEffect(source, lightX, lightY, ambient)`：
 *            API < 33 直接 null；创建失败（`RuntimeException` / `LinkageError`）也 null
 *                                                                  → `createCardDentEffect`
 *   CardDentEffect.kt L24-50 `CardDentApi33.Impl`：`lightDir` / `ambientStrength` 常量 uniform，
 *            `pressCenter` / `pressRadius` / `pressIntensity` / `cardRotationX/Y` 每帧 uniform；
 *            一旦抛错 `available = false` 并永久返回 null            → `CardDentApi33Effect`
 *   ReaderProgressEffect.kt L16-19 `rememberReaderScrollTopVisible(scroll, enabled)`：
 *            `enabled && value > maxValue * 0.2f`                    → `readerScrollTopVisible`
 *   ReaderProgressEffect.kt L23-38 `ReaderScrollProgressEffect`：`delay(1_500)` 后保存，
 *            `collectLatest` 取消上一次                                → `READER_PROGRESS_DEBOUNCE_MS`
 *   OnboardingScreen.kt L44-55 `OnboardingPage(rawTitle, rawDescription, imageRes, rawLabel, code)`
 *                                                                  → `OnboardingPage`
 *   OnboardingScreen.kt L57+ `onboardingPages`                      → `ONBOARDING_PAGES`
 *   OnboardingScreen.kt L180+ `OnboardingStory`                     → `OnboardingStory`（UI 层）
 */

/** CardDentEffect.kt L10-13。 */
/** `GlassCard.kt` L134 `private const val LIGHT_DIR_X = 0.0f`。 */
export const LIGHT_DIR_X = 0;
/** `GlassCard.kt` L135 `private const val LIGHT_DIR_Y = -0.6f` —— 光从左上方来。 */
export const LIGHT_DIR_Y = -0.6;
/** `GlassCard.kt` L138 `private const val DENT_AMBIENT = 0.8f` —— 凹陷处的环境光下限。 */
export const DENT_AMBIENT = 0.8;
export interface CardDentEffect {
  readonly available: boolean;
  /** L12 `effect(x, y, radius, intensity, rotationX, rotationY)`。 */
  readonly effect: (input: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly intensity: number;
    readonly rotationX: number;
    readonly rotationY: number;
  }) => string | null;
}

/**
 * L15-20 `createCardDentEffect(source, lightX, lightY, ambient)`：
 * Web 侧「有 AGSL」等价于「有 WebGL2」；创建失败一律返回 null（不抛）。
 */
export function createCardDentEffect(input: {
  readonly source: string;
  readonly lightX: number;
  readonly lightY: number;
  readonly ambient: number;
  /** 平台能力：`RuntimeShader` 可用（Web 侧 = WebGL2 可用）。 */
  readonly supportsRuntimeShader: boolean;
}): CardDentEffect | null {
  if (!input.supportsRuntimeShader) return null;
  try {
    return new CardDentApi33Effect(input.source, input.lightX, input.lightY, input.ambient);
  } catch {
    return null;
  }
}

/** L24-50 `CardDentApi33.Impl`：一次失败的 uniform 绑定会让整个效果永久降级。 */
export class CardDentApi33Effect implements CardDentEffect {
  private availableState = true;
  private readonly uniforms: Record<string, readonly number[]>;

  constructor(
    source: string,
    lightX: number,
    lightY: number,
    ambient: number,
  ) {
    if (source.trim() === '') throw new Error('empty shader source');
    this.uniforms = {
      lightDir: [lightX, lightY],
      ambientStrength: [ambient],
    };
  }

  get available(): boolean {
    return this.availableState;
  }

  effect(input: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly intensity: number;
    readonly rotationX: number;
    readonly rotationY: number;
  }): string | null {
    if (!this.availableState) return null;
    try {
      const next: Record<string, readonly number[]> = {
        ...this.uniforms,
        pressCenter: [input.x, input.y],
        pressRadius: [input.radius],
        pressIntensity: [input.intensity],
        cardRotationX: [input.rotationX],
        cardRotationY: [input.rotationY],
      };
      // 平台层把 uniform 表喂给着色器；Web 侧等价物是 CSS `filter` 的一串参数。
      return Object.entries(next)
        .map(([k, v]) => `${k}(${v.map((n) => String(Number(n.toFixed(4)))).join(',')})`)
        .join(' ');
    } catch {
      this.availableState = false;
      return null;
    }
  }
}

/** ReaderProgressEffect.kt L16-19 `rememberReaderScrollTopVisible(scrollState, enabled)`。 */
export function readerScrollTopVisible(input: {
  readonly value: number;
  readonly maxValue: number;
  readonly enabled: boolean;
}): boolean {
  return input.enabled && input.value > input.maxValue * 0.2;
}

/** ReaderProgressEffect.kt L34 `delay(1_500)`。 */
export const READER_PROGRESS_DEBOUNCE_MS = 1500;

/**
 * L23-38 `ReaderScrollProgressEffect(scrollState, enabled, bookId, chapterIndex, onSave)`：
 * 只观察像素、不重组整页；每次滚动重置 1.5s 定时器。
 */
export function scheduleReaderProgressSave(input: {
  readonly offset: number;
  readonly enabled: boolean;
  readonly onSave: (offset: number) => void;
  readonly delayMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly previous?: unknown;
}): unknown {
  if (!input.enabled) return input.previous ?? null;
  if (input.previous !== undefined && input.clearTimer !== undefined) input.clearTimer(input.previous);
  const wait = input.delayMs ?? READER_PROGRESS_DEBOUNCE_MS;
  const schedule = input.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  return schedule(() => input.onSave(input.offset), wait);
}

/** OnboardingScreen.kt L44-55 `OnboardingPage`。 */
export interface OnboardingPage {
  /** `rawTitle`（未过 `tr()`）。 */
  readonly rawTitle: string;
  readonly rawDescription: string;
  /** `imageRes`（Web 侧是 mascot 资源键）。 */
  readonly imageRes: string;
  readonly rawLabel: string;
  /** 右侧的拉丁序号（`WELCOME` / `LIBRARY` / …）。 */
  readonly code: string;
}

/**
 * L57-90+ `onboardingPages`：**逐条照抄** 5 页的标题/描述/吉祥物/标签/序号。
 * （`MascotSpriteSheet.idleDrawable / moveDrawable / readingDrawable` 对应
 * `mascot_idle` / `mascot_run` / `mascot_reading`。）
 */
export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  {
    rawTitle: '欢迎来到 Ciallo Reader',
    rawDescription: '把喜欢的小说和漫画收进书架，按自己的节奏阅读。',
    imageRes: 'mascot_idle',
    rawLabel: '阅读空间',
    code: 'WELCOME',
  },
  {
    rawTitle: '书库与自定义书源',
    rawDescription: '通过书库搜索在线作品，也可以导入自定义书源，或将本地文件加入书架。',
    imageRes: 'mascot_run',
    rawLabel: '找书与导入',
    code: 'LIBRARY',
  },
  {
    rawTitle: '按你的方式阅读',
    rawDescription: '选择仿真翻页或连续滚动，调整配色、夜间模式和护眼设置。',
    imageRes: 'mascot_reading',
    rawLabel: '阅读外观',
    code: 'READING',
  },
  {
    rawTitle: '和 Roxy 一起阅读',
    rawDescription: '阅读记录、连续天数与成就都会留在本机，随时可以回顾。',
    imageRes: 'mascot_idle',
    rawLabel: '阅读陪伴',
    code: 'ROXY',
  },
  {
    rawTitle: '数据始终属于你',
    rawDescription: '备份、恢复、设备互传都使用你自己控制的文件，不上传任何内容。',
    imageRes: 'mascot_run',
    rawLabel: '数据与备份',
    code: 'DATA',
  },
];

/** L180+ `OnboardingStory`：整页故事的帧序列（UI 层负责渲染）。 */
export interface OnboardingStory {
  readonly pages: readonly OnboardingPage[];
  /** 当前页索引（0..pages.length-1）。 */
  readonly index: number;
}

export function onboardingStory(index = 0): OnboardingStory {
  return { pages: ONBOARDING_PAGES, index: Math.min(Math.max(index, 0), ONBOARDING_PAGES.length - 1) };
}
