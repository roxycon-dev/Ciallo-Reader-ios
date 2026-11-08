/**
 * comicStreamPreviewScan.test.ts — 移植 Android
 * `app/src/test/java/com/example/ui/comic/ComicLoadingReliabilityTest.kt` 中
 * `class ComicLoadSupportTest` 的第 4 个测试（`only complete progressive scans are
 * eligible for a network preview`，Kotlin L67-L76）。
 *
 * 被测实现：`src/ui/components/comic/comicStreamPreview.tsx` 的 `completeProgressiveScan`
 * （逐行移植自 `ComicStreamPreview.kt` L77-L115）。
 *
 * fixture：`fixtures/comic/{baseline,progressive}.jpg`
 *   ← `novel-reader/app/src/test/resources/comic/`（单向复制，原目录只读）
 *
 * ⚠️ 该断言是**纯字节级**的（截断前缀 → 返回以 EOI 收尾的完整扫描段），
 *    不需要 JPEG 解码器，因此可以 1:1 移植，不属于「未移植的像素级断言」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { completeProgressiveScan } from '@ui/components/comic/comicStreamPreview'

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'comic')

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)))
}

describe('ComicLoadSupportTest.only complete progressive scans（Kotlin ComicLoadingReliabilityTest.kt L67-L76）', () => {
  it('只有完整的渐进式扫描段才有资格作为网络预览', () => {
    const progressive = readFixture('progressive.jpg')
    const baseline = readFixture('baseline.jpg')
    // 基线 JPEG 的前 32KB 不是完整扫描段 → 拒绝
    expect(completeProgressiveScan(baseline.slice(0, 32768))).toBeNull()
    // 渐进式 JPEG 的前 100 字节连一个熵编码段都没结束 → 拒绝
    expect(completeProgressiveScan(progressive.slice(0, 100))).toBeNull()
    // 渐进式 JPEG 的前 32KB 至少含一个完整扫描段
    const partial = completeProgressiveScan(progressive.slice(0, 32768))
    expect(partial).not.toBeNull()
    const bytes = partial as Uint8Array
    expect(bytes.length).toBeLessThan(progressive.length)
    expect((bytes[bytes.length - 2] as number) & 255).toBe(255)
    expect((bytes[bytes.length - 1] as number) & 255).toBe(217)
  })
})