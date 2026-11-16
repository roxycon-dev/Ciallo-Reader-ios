/**
 * Port of `novel-reader/app/src/test/java/com/example/source/js/JsChapterOrderTest.kt`
 * (17 `@Test` cases, verbatim fixtures and expectations).
 *
 * Every case here is a line-by-line translation of one Kotlin `@Test`; the Kotlin
 * source is the authority for the expected titles/volumes/orders.
 */

import { describe, expect, it } from 'vitest'
import { JsChapterOrder } from '@core/source/js/jsChapterOrder'
import { createComicChapter, type ComicChapter } from '@core/source/comicChapter'

/** Kotlin `private fun ch(title, volume = null, order = 0f)`. */
function ch(title: string, volume: string | null = null, order = 0): ComicChapter {
  return createComicChapter({ id: `book${volume}/${title}`, title, volume, order })
}

/** Kotlin `private fun titles(chapters)`. */
function titles(chapters: readonly ComicChapter[]): string[] {
  return chapters.map((chapter) => chapter.title)
}

describe('JsChapterOrder.normalize', () => {
  // L35-48 lilySweetheartBothSourcesReadFromFirstEpisodeToLatest
  it('both sources read from first episode to latest', () => {
    const firstToLatest = [1, 2, 3, 4, 5, 6].map((it) => ch(`第${it}话`))
    const sources: Array<[string, ComicChapter[]]> = [
      ['copy_manga', firstToLatest],
      ['manhuaren', firstToLatest.slice().reverse()],
    ]
    for (const [source, raw] of sources) {
      const chapters = JsChapterOrder.normalize(raw, source)
      expect(titles(chapters)).toEqual(titles(firstToLatest))
      // Kotlin asserts `navigation.previous/next` per chapter, i.e. that after
      // normalization the id order is strictly first→latest, so neighbours are
      // positional and unique.
      expect(chapters.map((chapter) => chapter.id)).toEqual(
        firstToLatest.map((chapter) => chapter.id),
      )
      chapters.forEach((chapter, index) => {
        expect(chapters.findIndex((item) => item.id === chapter.id)).toBe(index)
      })
      expect(chapters[0]?.id).toBe(firstToLatest[0]?.id)
      expect(chapters[chapters.length - 1]?.id).toBe(firstToLatest[firstToLatest.length - 1]?.id)
    }
  })

  // L50-53 clearAscendingTitlesOverrideManhuarenDefault
  it('clear ascending titles override the manhuaren default', () => {
    const raw = [ch('第1话'), ch('第2话'), ch('第3话')]
    expect(titles(JsChapterOrder.normalize(raw, 'manhuaren'))).toEqual(titles(raw))
  })

  // L55-60 descendingTitlesOverrideCopyMangaDefaultAndWorkForUnknownSources
  it('descending titles override the copy_manga default and work for unknown sources', () => {
    const raw = [ch('Chapter 3'), ch('Chapter 2'), ch('Chapter 1')]
    for (const source of ['copy_manga', 'unknown']) {
      expect(titles(JsChapterOrder.normalize(raw, source))).toEqual(titles(raw.slice().reverse()))
    }
  })

  // L62-67 namedEpisodesUseSourceFallback
  it('named episodes use the source fallback', () => {
    const raw = [ch('终幕'), ch('相遇'), ch('序章')]
    expect(titles(JsChapterOrder.normalize(raw, 'manhuaren'))).toEqual(titles(raw.slice().reverse()))
    expect(titles(JsChapterOrder.normalize(raw, 'copy_manga'))).toEqual(titles(raw))
    expect(titles(JsChapterOrder.normalize(raw, 'unknown'))).toEqual(titles(raw))
  })

  // L69-74 reliableFractionalMetadataTakesPriorityOverTitles
  it('reliable fractional metadata takes priority over titles', () => {
    const raw = [ch('第1话', null, 2), ch('番外', null, 1.5), ch('第3话', null, 0)]
    const sorted = JsChapterOrder.normalize(raw, 'manhuaren')
    expect(sorted).toEqual([raw[2], raw[1], raw[0]])
    expect(sorted.map((chapter) => chapter.order)).toEqual([0, 1.5, 2])
  })

  // L76-82 missingOrInvalidOrderCannotOverrideChapterDirection
  it('missing or invalid order cannot override chapter direction', () => {
    const raw = [ch('第3话', null, 1), ch('第2话'), ch('第1话')]
    expect(titles(JsChapterOrder.normalize(raw, 'copy_manga', false))).toEqual([
      '第1话',
      '第2话',
      '第3话',
    ])
    expect(
      titles(
        JsChapterOrder.normalize(
          raw.map((chapter) => ({ ...chapter, order: Number.NaN })),
          'copy_manga',
        ),
      ),
    ).toEqual(['第1话', '第2话', '第3话'])
  })

  // L84-87 decimalsAndMissingEpisodesAreNotRoundedOrFilled
  it('decimals and missing episodes are not rounded or filled', () => {
    const raw = [ch('12.5'), ch('12'), ch('7'), ch('0')]
    expect(titles(JsChapterOrder.normalize(raw, 'unknown'))).toEqual(['0', '7', '12', '12.5'])
  })

  // L89-95 fullWidthAndChineseNumeralsIdentifyDirection
  it('full width and Chinese numerals identify direction', () => {
    const cases: ComicChapter[][] = [
      [ch('第十二话'), ch('第十一话'), ch('第十话')],
      [ch('第３話'), ch('第２話'), ch('第１話')],
      [ch('ep. 3'), ch('ep. 2'), ch('ep. 1')],
    ]
    for (const raw of cases) {
      expect(titles(JsChapterOrder.normalize(raw, 'unknown'))).toEqual(titles(raw.slice().reverse()))
    }
  })

  // L97-100 unrelatedNumbersAndSpecialsDoNotDetermineDirection
  it('unrelated numbers and specials do not determine direction', () => {
    const raw = [ch('番外第9话'), ch('特别篇第8话'), ch('2026-10-05 公告'), ch('角色2的故事')]
    expect(titles(JsChapterOrder.normalize(raw, 'unknown'))).toEqual(titles(raw))
  })

  // L102-105 inconsistentTitlesAreNotNumericallyResorted
  it('inconsistent titles are not numerically resorted', () => {
    const raw = [ch('第4话'), ch('第1话'), ch('第3话'), ch('第2话')]
    expect(titles(JsChapterOrder.normalize(raw, 'unknown'))).toEqual(titles(raw))
  })

  // L107-111 adjacentPartsAndSpecialPlacementSurviveReversal
  it('adjacent parts and special placement survive reversal', () => {
    const raw = [ch('第3话'), ch('番外'), ch('第2话（上）'), ch('第2话（下）'), ch('第1话'), ch('序章')]
    expect(titles(JsChapterOrder.normalize(raw, 'unknown'))).toEqual([
      '序章',
      '第1话',
      '第2话（上）',
      '第2话（下）',
      '番外',
      '第3话',
    ])
  })

  // L113-119 editionsNormalizeSeparatelyWithoutMovingNamedGroups
  it('editions normalize separately without moving named groups', () => {
    const raw = [
      ch('第3话', '连载'),
      ch('第2话', '连载'),
      ch('第1话', '连载'),
      ch('第1卷', '单行本'),
      ch('第2卷', '单行本'),
      ch('番外2', '番外'),
      ch('番外1', '番外'),
    ]
    const sorted = JsChapterOrder.normalize(raw, 'manhuaren')
    expect(titles(sorted)).toEqual([
      '第1话',
      '第2话',
      '第3话',
      '第1卷',
      '第2卷',
      '番外1',
      '番外2',
    ])
    expect(sorted.map((chapter) => chapter.volume)).toEqual(raw.map((chapter) => chapter.volume))
  })

  // L121-127 explicitlyNumberedVolumesNormalizeBeforeTheirEpisodes
  it('explicitly numbered volumes normalize before their episodes', () => {
    const raw = [
      ch('第2话', '第二卷'),
      ch('第1话', '第二卷'),
      ch('第2话', 'Volume 1'),
      ch('第1话', 'Volume 1'),
    ]
    const sorted = JsChapterOrder.normalize(raw, 'unknown')
    expect(sorted.map((chapter) => chapter.volume)).toEqual([
      'Volume 1',
      'Volume 1',
      '第二卷',
      '第二卷',
    ])
    expect(titles(sorted)).toEqual(['第1话', '第2话', '第1话', '第2话'])
  })

  // L129-135 interleavedGroupsKeepTheirSlots
  it('interleaved groups keep their slots', () => {
    const raw = [
      ch('第3话', 'A'),
      ch('第1话', 'B'),
      ch('第2话', 'A'),
      ch('第2话', 'B'),
      ch('第1话', 'A'),
    ]
    const sorted = JsChapterOrder.normalize(raw, 'unknown')
    expect(sorted.map((chapter) => chapter.volume)).toEqual(raw.map((chapter) => chapter.volume))
    expect(titles(sorted)).toEqual(['第1话', '第1话', '第2话', '第2话', '第3话'])
  })

  // L137-144 equalNumbersAndSmallCataloguesRemainValid
  it('equal numbers and small catalogues remain valid', () => {
    expect(JsChapterOrder.normalize([], 'manhuaren')).toEqual([])
    const single = [ch('单话')]
    expect(JsChapterOrder.normalize(single, 'manhuaren')).toEqual(single)
    const duplicate = [ch('第2话（上）'), ch('第2话（下）')]
    expect(titles(JsChapterOrder.normalize(duplicate, 'manhuaren'))).toEqual(titles(duplicate))
    expect(titles(JsChapterOrder.normalize([ch('第2话'), ch('第1话')], 'unknown'))).toEqual([
      '第1话',
      '第2话',
    ])
  })

  // L146-152 normalizationIsIdempotentAndPreservesIdentityAndExternalLinks
  it('normalization is idempotent and preserves identity and external links', () => {
    const raw = [
      { ...ch('第3话'), external: true, externalUrl: 'https://example.test/3' },
      ch('第2话'),
      ch('第1话'),
    ]
    const sorted = JsChapterOrder.normalize(raw, 'manhuaren')
    // Kotlin compares whole data classes with `order` zeroed out.
    const strip = (list: readonly ComicChapter[]) =>
      new Set(
        list.map(
          (chapter) =>
            `${chapter.id}|${chapter.title}|${chapter.volume}|${chapter.external}|${chapter.externalUrl}`,
        ),
      )
    expect(strip(sorted)).toEqual(strip(raw))
    // The external link survives.
    expect(sorted.find((chapter) => chapter.external === true)?.externalUrl).toBe(
      'https://example.test/3',
    )
    expect(JsChapterOrder.normalize(sorted, 'manhuaren')).toEqual(sorted)
    expect(sorted.map((chapter) => chapter.order)).toEqual([0, 1, 2])
  })
})