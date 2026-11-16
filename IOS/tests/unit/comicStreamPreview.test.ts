/**
 * comicStreamPreview.test.ts — 钉死 Android `ComicStreamPreview.kt`（L1-L115）的
 * 渐进式 JPEG 扫描器与门卫逻辑。端口：`src/ui/components/comic/comicStreamPreview.tsx`。
 */
import { describe, expect, it } from 'vitest';
import {
  ComicStreamPreview,
  MAX_PREFIX,
  completeProgressiveScan,
  previewSampleSize,
  type ComicPreviewDecoder,
} from '@ui/components/comic/comicStreamPreview';

/** 构造 marker 段：`FF <marker> <lenHi> <lenLo> [payload]`，长度字段 = payload.length + 2。 */
function seg(marker: number, payload: number[] = []): number[] {
  const len = payload.length + 2
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload]
}

/** 最小渐进式 JPEG：SOI + SOF2 + 一个完整熵编码段 + EOI。 */
function progressiveJpeg(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    ...seg(0xc2, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x11, 0x00]), // SOF2（渐进）
    ...seg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), // SOS
    0x12,
    0x34,
    0x56,
    0x78, // 熵编码数据
    0xff,
    0xd9, // EOI
  ])
}

describe('completeProgressiveScan（L77-L115）', () => {
  it('过短 / 非 SOI → null（L79）', () => {
    expect(completeProgressiveScan(new Uint8Array([0xff]))).toBeNull()
    expect(completeProgressiveScan(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(completeProgressiveScan(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it('基线（SOF0=192 / SOF1=193）→ onBaseline() + null（L102）', () => {
    let hit = false
    const bytes = new Uint8Array([0xff, 0xd8, ...seg(0xc0, [0x08, 0x00, 0x10]), 0xff, 0xd9])
    expect(completeProgressiveScan(bytes, () => { hit = true })).toBeNull()
    expect(hit).toBe(true)
  })

  it('无 SOF2 → null（非渐进，L110）', () => {
    // 只有 SOS 但没有 SOF2
    const bytes = new Uint8Array([0xff, 0xd8, ...seg(0xda, [0x01, 0x00]), 0x11, 0x22, 0xff, 0xd9])
    expect(completeProgressiveScan(bytes)).toBeNull()
  })

  it('无完整熵编码段（completedEnd < 0）→ null（L110）', () => {
    const bytes = new Uint8Array([0xff, 0xd8, ...seg(0xc2, [0x08, 0x00, 0x10]), 0xff, 0xd9])
    expect(completeProgressiveScan(bytes)).toBeNull()
  })

  it('渐进 + 完整熵编码段 → 写回 EOI（L112-L113）', () => {
    const out = completeProgressiveScan(progressiveJpeg())
    expect(out).not.toBeNull()
    const arr = out as Uint8Array
    // 结尾必须是 EOI（0xFF 0xD9）——L112-L113 的两行写回
    expect(arr[arr.length - 2]).toBe(0xff)
    expect(arr[arr.length - 1]).toBe(0xd9)
    // 仍以 SOI 开头
    expect(arr[0]).toBe(0xff)
    expect(arr[1]).toBe(0xd8)
    // completedEnd = 熵编码段首字节索引 28 → 长度 30
    expect(arr.length).toBe(30)
  })

  it('熵编码段之后的标记被丢弃（截断到最后一个完整段，L92/L111）', () => {
    // 在熵编码数据与 EOI 之间插一个 COM（FF FE）段：完整扫描应停在熵编码段末尾
    const withCom = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xc2, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x11, 0x00]),
      ...seg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
      0x12, 0x34, 0x56, 0x78,
      ...seg(0xfe, [0x01, 0x02]), // COM：熵编码段之后
      0xff, 0xd9,
    ])
    const out = completeProgressiveScan(withCom) as Uint8Array
    // COM 段被截掉：completedEnd 仍是熵编码段首字节 28 → 长度 30
    expect(out.length).toBe(30)
    expect(out[28]).toBe(0xff)
    expect(out[29]).toBe(0xd9)
  })

  it('尾部填充零字节不影响截断点（L113）', () => {
    const jpeg = progressiveJpeg()
    const padded = new Uint8Array(jpeg.length + 16)
    padded.set(jpeg, 0)
    const out = completeProgressiveScan(padded) as Uint8Array
    expect(out.length).toBe(30)
    expect(out[out.length - 2]).toBe(0xff)
    expect(out[out.length - 1]).toBe(0xd9)
  })

  it('熵编码段内的 0xFF 填充字节被跳过（L88）', () => {
    // SOS 载荷后是 0xFF 0xFF 0x00 0x9F（stuffed 0xFF）——0x00 是 ZRSTUFF，应跳过而非当作标记
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xc2, [0x08, 0x00, 0x10]),
      ...seg(0xda, [0x01, 0x00]),
      0x12, 0xff, 0xff, 0x00, 0x9f, 0x34,
      0xff, 0xd9,
    ])
    const out = completeProgressiveScan(bytes)
    expect(out).not.toBeNull()
  })

  it('restart marker（208..215）在熵编码段内被跳过（L91）', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xc2, [0x08, 0x00, 0x10]),
      ...seg(0xda, [0x01]),
      0x12, 0x34,
      0xff, 0xd0, // RST0 —— 跳过
      0x56, 0x78,
      0xff, 0xd9,
    ])
    const out = completeProgressiveScan(bytes)
    expect(out).not.toBeNull()
    expect((out as Uint8Array).length).toBeGreaterThan(0)
  })

  it('段长度非法（<2 或越界）→ 提前 break（L106）', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc2, 0x00, 0x01, 0xff, 0xd9])
    expect(completeProgressiveScan(bytes)).toBeNull()
  })

  it('不修改入参（copyOf，L111）', () => {
    const input = progressiveJpeg()
    const before = Array.from(input)
    completeProgressiveScan(input)
    expect(Array.from(input)).toEqual(before)
  })

  it('onBaseline 默认无副作用（L77 默认参数）', () => {
    expect(() => {
      completeProgressiveScan(new Uint8Array([0xff, 0xd8, ...seg(0xc0, [0x08]), 0xff, 0xd9]))
    }).not.toThrow()
  })
})

describe('previewSampleSize（L56-L57）', () => {
  it('短边小于 720 → sample=1', () => {
    expect(previewSampleSize(720, 720)).toBe(1)
    expect(previewSampleSize(400, 600)).toBe(1)
  })

  it('超过 720 → ×2 递进', () => {
    expect(previewSampleSize(721, 721)).toBe(2)
    expect(previewSampleSize(1440, 1440)).toBe(2)
    expect(previewSampleSize(2881, 2881)).toBe(8)
    expect(previewSampleSize(6000, 4000)).toBe(16)
  })

  it('取长边判定（L57 maxOf）', () => {
    expect(previewSampleSize(200, 3000)).toBe(8)
  })
})

describe('ComicStreamPreview.offer / close（L31-L49）', () => {
  const stubDecoder: ComicPreviewDecoder = {
    bounds: async () => ({ width: 100, height: 100 }),
    decode: async () => ({ src: 'blob:thumb', width: 100, height: 100 }),
    orientation: async () => 1,
  }

  it('非 JPEG SOI → rejected，后续 offer 全部忽略（L33-L36）', async () => {
    const published: string[] = []
    const preview = new ComicStreamPreview({
      publish: (img) => published.push(img.src),
      decoder: stubDecoder,
    })
    preview.offer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    // 再喂真 JPEG 也应被 rejected 拦下
    preview.offer(progressiveJpeg())
    await Promise.resolve()
    await Promise.resolve()
    expect(published).toEqual([])
  })

  it('缓冲不足 nextBytes（16KB）→ 忽略（L32）', async () => {
    const published: string[] = []
    const preview = new ComicStreamPreview({
      publish: (img) => published.push(img.src),
      decoder: stubDecoder,
    })
    preview.offer(new Uint8Array(1024))
    await Promise.resolve()
    expect(published).toEqual([])
  })

  it('缓冲足够且是渐进 JPEG → 发布缩略图（L38-L46）', async () => {
    const published: string[] = []
    const preview = new ComicStreamPreview({
      publish: (img) => published.push(img.src),
      decoder: stubDecoder,
    })
    const buf = progressiveJpeg()
    // 补齐到 16KB 以上（前缀仍是同一段 JPEG）
    const padded = new Uint8Array(20 * 1024)
    padded.set(buf, 0)
    preview.offer(padded)
    await new Promise((r) => setTimeout(r, 0))
    expect(published).toEqual(['blob:thumb'])
  })

  it('close() 之后不再发布（L44 closed 检查）', async () => {
    const published: string[] = []
    const preview = new ComicStreamPreview({
      publish: (img) => published.push(img.src),
      decoder: stubDecoder,
    })
    const padded = new Uint8Array(20 * 1024)
    padded.set(progressiveJpeg(), 0)
    preview.offer(padded)
    preview.close()
    await new Promise((r) => setTimeout(r, 0))
    expect(published).toEqual([])
  })

  it('解码抛错被吞掉（正常整图路径接管，L45）', async () => {
    const published: string[] = []
    const throwing: ComicPreviewDecoder = {
      bounds: async () => {
        throw new Error('unsupported')
      },
      decode: async () => null,
      orientation: async () => 1,
    }
    const preview = new ComicStreamPreview({
      publish: (img) => published.push(img.src),
      decoder: throwing,
    })
    const padded = new Uint8Array(20 * 1024)
    padded.set(progressiveJpeg(), 0)
    preview.offer(padded)
    await new Promise((r) => setTimeout(r, 0))
    expect(published).toEqual([])
  })

  it('bounds 非法（<=0）→ 不发布（L55）', async () => {
    const published: string[] = []
    const bad: ComicPreviewDecoder = {
      bounds: async () => ({ width: 0, height: 100 }),
      decode: async () => ({ src: 'blob:x', width: 1, height: 1 }),
      orientation: async () => 1,
    }
    const preview = new ComicStreamPreview({ publish: (i) => published.push(i.src), decoder: bad })
    const padded = new Uint8Array(20 * 1024)
    padded.set(progressiveJpeg(), 0)
    preview.offer(padded)
    await new Promise((r) => setTimeout(r, 0))
    expect(published).toEqual([])
  })
})

describe('常量（L23）', () => {
  it('MAX_PREFIX = 2MB', () => {
    expect(MAX_PREFIX).toBe(2 * 1024 * 1024)
  })
})
