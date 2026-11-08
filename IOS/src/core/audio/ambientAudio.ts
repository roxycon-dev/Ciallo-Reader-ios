import { sceneAssetUrl, type ComicScene } from './sceneTypes'
import { getAudioSource, type AudioHandle } from './audioSource'

export interface AmbientAudioHandle {
  isRunning(): boolean
  setVolume(v: number): void
  stop(): void
}

/**
 * Kotlin `ComicSceneEngine.kt:34-165 ComicAmbientAudio` 的移植。
 *
 * E61：原先用 `new Audio(url)` + `HTMLAudioElement` 字段，让 `src/core/**`
 * 依赖 DOM 全局与 DOM 类型。现走 `getAudioSource()` 注入；宿主无音频能力时
 * `create()` 返回 `null`，本类按「该场景没有环境音」返回 `null` handle ——
 * 与 Kotlin `assetOf(scene)` 返回 `null` 的分支一致。
 */
export class AmbientAudio {
  private audio: AudioHandle | null = null
  private running = false
  private volume = 0.4

  start(scene: ComicScene, initialVolume = 0.4): AmbientAudioHandle | null {
    if (scene === 'NONE') return null
    this.stop()
    this.volume = Math.min(1, Math.max(0, initialVolume))
    const url = sceneAssetUrl(scene)
    if (url === null) return null
    // Kotlin: `MediaPlayer()` 在资源损坏时抛 → 这里让端口返回 null 走「跳过」。
    const el = getAudioSource().create(url, { loop: true, volume: this.volume })
    if (el === null) {
      this.running = false
      return null
    }
    el.setLoop(true)
    el.setVolume(this.volume)
    // Android `start()` 失败会抛；Web `play()` 返回 rejected promise（自动播放策略）。
    // 原实现是 `void el.play().catch(() => {})`，语义保持。
    void el.play().catch(() => {})
    this.audio = el
    this.running = true
    return this.handle()
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.audio) {
      this.audio.setVolume(this.volume)
    }
  }

  stop(): void {
    this.running = false
    if (this.audio) {
      this.audio.release()
      this.audio = null
    }
  }

  isRunning(): boolean {
    return this.running
  }

  private handle(): AmbientAudioHandle {
    return {
      isRunning: () => this.running,
      setVolume: (v: number) => this.setVolume(v),
      stop: () => this.stop(),
    }
  }
}

let sharedAmbient: AmbientAudio | null = null

export function getAmbientAudio(): AmbientAudio {
  if (sharedAmbient === null) {
    sharedAmbient = new AmbientAudio()
  }
  return sharedAmbient
}
