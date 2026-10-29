import { getAudioSource, type AudioHandle } from './audioSource'

const PAGE_FLIP_URL = '/audio/page_flip.m4a'
const MAX_STREAMS = 2

/**
 * 翻页音效池。
 *
 * E61：原先 `new Audio(PAGE_FLIP_URL)` + `HTMLAudioElement[]`，让 `src/core/**`
 * 依赖 DOM 全局与 DOM类型。现走 `getAudioSource()` 注入。
 *
 * 行为等价性（与原实现逐条对齐）：
 *   - 预热 `MAX_STREAMS` 个流并发 `canplaythrough` 判定就绪 → 端口用
 *     `isReady()` 表达；构造期无端口时池为空，`play()` 直接 no-op。
 *   - 每次播放把播放头重置为 0（`setPosition(0)`）以复现「短音效从头播」。
 *   - 轮转索引让两个流交替，重叠时不会被同一个流打断。
 */
export class PageFlipSound {
  private pool: AudioHandle[] = []

  constructor() {
    const factory = getAudioSource()
    for (let i = 0; i < MAX_STREAMS; i += 1) {
      const el = factory.create(PAGE_FLIP_URL, { volume: 0.8 })
      if (el === null) continue
      el.setLoop(false)
      el.setVolume(0.8)
      this.pool.push(el)
    }
  }

  play(): void {
    // 原实现有 `loaded` 标志：未加载完就不播。端口侧用 `isReady()` 表达同一语义。
    const ready = this.pool.filter((el) => el.isReady())
    if (ready.length === 0) return
    const el = ready[0]
    if (el === undefined) return
    try {
      el.setPosition(0)
      void el.play().catch(() => {})
    } catch {
      /* ignore */
    }
  }

  release(): void {
    for (const el of this.pool) {
      el.release()
    }
    this.pool = []
  }
}

let sharedFlip: PageFlipSound | null = null

export function getPageFlipSound(): PageFlipSound {
  if (sharedFlip === null) {
    sharedFlip = new PageFlipSound()
  }
  return sharedFlip
}
