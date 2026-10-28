/**
 * E61 —— 音频播放依赖注入（`src/core/**` 去 DOM 全局）。
 *
 * ## 背景
 *
 * `src/core/audio/ambientAudio.ts`（环境音）与 `src/core/audio/pageFlipSound.ts`
 * （翻页音）此前直接用 `new Audio(url)` / `HTMLAudioElement` 类型标注。这让
 * `src/core/**` 依赖 DOM 全局与 DOM 类型（E61），核心层无法在 Node worker /
 * 小程序壳里跑。
 *
 * Android 对照
 * ────────────
 *   环境音：`ComicSceneEngine.kt:70` `MediaPlayer()` 循环播放 assets/m4a
 *   翻页音：`ui/reader/**` 的音效池（同为 MediaPlayer/SoundPool 语义）
 *
 * 两者的 Web 实现都是「一个可循环 / 可重播 / 可设音量的音频句柄」，
 * 所以共用一个注入点，与 `glass/mediaQuerySource.ts` 同一设计。
 *
 * ## 兜底语义
 *
 * 宿主无音频能力时 `create()` 返回 `null`，core 侧按「该场景没有音频」处理 ——
 * 对应 Kotlin `ComicSceneEngine.kt:45 assetOf(scene)` 返回 `null` 的分支，
 * **不抛错**。
 */

/** 音频句柄的最小形状（与 `MediaHandle` 结构兼容）。 */
export interface AudioHandle {
  /** 是否已可播放。翻页音靠它决定「预热是否结束」。 */
  isReady(): boolean;
  play(): Promise<void>;
  pause(): void;
  setLoop(loop: boolean): void;
  setVolume(volume: number): void;
  setPosition(seconds: number): void;
  release(): void;
}

/** 音频工厂的最小形状（与 `MediaPlayerPort` 结构兼容）。 */
export interface AudioSource {
  create(url: string, options?: { loop?: boolean; volume?: number }): AudioHandle | null;
}

/** 兜底：宿主无音频能力 → 恒返回 null（对齐 Kotlin `assetOf` 的 null 分支）。 */
const NO_AUDIO: AudioSource = {
  create: () => null,
};

let source: AudioSource = NO_AUDIO;

/** 装配处注入真实音频实现。传 `null` 恢复兜底（单测用）。 */
export function setAudioSource(next: AudioSource | null): void {
  source = next ?? NO_AUDIO;
}

/** 当前生效的音频源。 */
export function getAudioSource(): AudioSource {
  return source;
}

/** 临时覆盖音频源，返回还原函数。供单测钉住分支。 */
export function withAudioSource(override: AudioSource): () => void {
  const previous = source;
  source = override;
  return () => {
    source = previous;
  };
}
