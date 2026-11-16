/**
 * comicTranslationConfig.test.ts — 逐条移植 Android
 * `app/src/test/java/com/example/ui/comic/ComicTranslationConfigTest.kt`（4 个 @Test）。
 *
 * 被测实现：`src/core/comic/comicReaderConfig.ts`
 *   - comicReaderConfigFromJson  ← Kotlin `ComicReaderConfig.fromJson`
 *   - comicReaderConfigToJson    ← Kotlin `ComicReaderConfig.toJson`
 *   - createComicReaderConfig    ← Kotlin `ComicReaderConfig(具名参数)`
 */
import { describe, expect, it } from 'vitest'

import {
  createComicReaderConfig,
  comicReaderConfigFromJson,
  comicReaderConfigToJson,
} from '@core/comic/comicReaderConfig'

describe('ComicTranslationConfigTest（Android ComicTranslationConfigTest.kt，4 个测试）', () => {
  it('legacy json without translation fields defaults off — 旧 JSON 无翻译字段→默认关闭（Kotlin L18-L25）', () => {
    // Kotlin L20: JSONObject("""{"mode":"SINGLE","direction":"RTL","pageAnim":"SLIDE"}""")
    const legacy = { mode: 'SINGLE', direction: 'RTL', pageAnim: 'SLIDE' }
    const config = comicReaderConfigFromJson(legacy)
    expect(config.translationEnabled).toBe(false)
    expect(config.translationLang).toBe('auto')
    expect(config.translationTextScale).toBeCloseTo(1.0, 4)
  })

  it('translation fields round trip — 翻译字段 JSON 往返一致（Kotlin L27-L38）', () => {
    const config = createComicReaderConfig({
      translationEnabled: true,
      translationLang: 'ja',
      translationTextScale: 1.25,
    })
    const restored = comicReaderConfigFromJson(comicReaderConfigToJson(config))
    expect(restored.translationEnabled).toBe(true)
    expect(restored.translationLang).toBe('ja')
    expect(restored.translationTextScale).toBeCloseTo(1.25, 4)
  })

  it('translation text scale clamped to valid range — 译文字号钳到有效区间（Kotlin L40-L46）', () => {
    const json = comicReaderConfigToJson(createComicReaderConfig({ translationTextScale: 9 }))
    expect(comicReaderConfigFromJson(json).translationTextScale).toBeCloseTo(1.4, 4)
    const json2 = comicReaderConfigToJson(createComicReaderConfig({ translationTextScale: 0.1 }))
    expect(comicReaderConfigFromJson(json2).translationTextScale).toBeCloseTo(0.8, 4)
  })

  it('unknown language value falls back to auto — 未知语言回落 auto（Kotlin L48-L52）', () => {
    expect(comicReaderConfigFromJson({ translationLang: 'fr' }).translationLang).toBe('auto')
  })
})