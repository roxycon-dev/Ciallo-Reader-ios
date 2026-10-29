// Independent re-derivation of the Kotlin pixel kernels, to diff against the TS port.
// Every constant is copied from the Kotlin source line ranges noted per function.

const O = 0xff000000

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v * 255)))
}
const rnd = (v: number): number => Math.round(v) // kotlin roundToInt == Math.round
const c255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)

// ---------- buildToneLut (Kotlin L603–627) ----------
export function buildToneLut(t: {
  brightness: number; contrast: number; gamma: number; shadow: number
}): number[] {
  const bright = (t.brightness / 100) * 48
  const contrast = 1 + (t.contrast / 100) * 0.6
  const gamma = Math.min(2.2, Math.max(0.5, t.gamma))
  const shadow = t.shadow / 100
  const lut: number[] = []
  for (let i = 0; i <= 255; i++) {
    let v = i / 255
    v = Math.min(1, Math.max(0, v + bright / 255))
    v = Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5))
    v = Math.pow(v, 1 / gamma)
    if (shadow > 0) {
      const w = Math.min(1, Math.max(0, 1 - v))
      v = Math.min(1, Math.max(0, v + shadow * 0.45 * w * w))
    } else if (shadow < 0) {
      const w = Math.min(1, Math.max(0, 1 - v))
      v = Math.min(1, Math.max(0, v * (1 + shadow * 0.45 * w)))
    }
    lut.push(c255(rnd(v * 255)))
  }
  return lut
}

// ---------- ColorMatrix (Kotlin setSaturation / hueMatrix / postConcat) ----------
export function setSaturation(sat: number): Float32Array {
  const lr = 0.213, lg = 0.715, lb = 0.072
  const sr = (1 - sat) * lr, sg = (1 - sat) * lg, sb = (1 - sat) * lb
  const m = new Float32Array(20)
  m[0] = sr + sat; m[1] = sg; m[2] = sb; m[3] = 0
  m[4] = 0; m[5] = sr; m[6] = sg + sat; m[7] = sb; m[8] = 0
  m[9] = 0; m[10] = sr; m[11] = sg; m[12] = sb + sat; m[13] = 0
  m[14] = 0; m[15] = 0; m[16] = 0; m[17] = 0; m[18] = 1; m[19] = 0
  return m
}
export function hueMatrix(deg: number): Float32Array {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad), s = Math.sin(rad)
  const m = new Float32Array(20)
  m[0] = 0.213 + c * 0.787 - s * 0.213
  m[1] = 0.715 - c * 0.715 - s * 0.715
  m[2] = 0.072 - c * 0.072 + s * 0.928
  m[5] = 0.213 - c * 0.213 + s * 0.143
  m[6] = 0.715 + c * 0.285 + s * 0.14
  m[7] = 0.072 - c * 0.072 - s * 0.283
  m[10] = 0.213 - c * 0.213 - s * 0.787
  m[11] = 0.715 - c * 0.715 + s * 0.715
  m[12] = 0.072 + c * 0.928 + s * 0.072
  m[18] = 1
  return m
}
// Kotlin ColorMatrix.postConcat: M' = other * M  (AOSP)
export function postConcat(m: Float32Array, other: Float32Array): Float32Array {
  const out = new Float32Array(20)
  for (let r = 0; r < 4; r++) for (let cc = 0; cc < 5; cc++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += other[r * 5 + k]! * m[k * 5 + cc]!
    out[r * 5 + cc] = s
  }
  return out
}
export function buildFilterMatrix(sat: number, hue: number, bw: boolean): Float32Array {
  const s = bw ? 0 : sat !== 0 ? Math.min(3, Math.max(0, 1 + sat / 100)) : 1
  const m = setSaturation(s)
  return hue !== 0 && !bw ? postConcat(m, hueMatrix(hue)) : m
}

// ---------- unsharpMask (Kotlin L698–728) ----------
export const OVERSHOOT_CLAMP = 16
export function unsharpMask(px: Uint32Array, w: number, h: number, amount: number): Uint32Array {
  if (amount <= 0) return px.slice()
  const k = amount * 1.2
  const out = px.slice()
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x
    const c = px[idx]!
    const ch = (shift: number): number => {
      const v = (c >>> shift) & 0xff
      const a = (px[idx - 1]! >>> shift) & 0xff
      const b = (px[idx + 1]! >>> shift) & 0xff
      const d = (px[idx - w]! >>> shift) & 0xff
      const e = (px[idx + w]! >>> shift) & 0xff
      const hi = Math.max(Math.max(a, b), Math.max(d, e))
      const lo = Math.min(Math.min(a, b), Math.min(d, e))
      const nv = rnd(v + ((v * 4 - a - b - d - e) * k) / 4)
      return c255(Math.min(hi + OVERSHOOT_CLAMP, Math.max(lo - OVERSHOOT_CLAMP, nv)))
    }
    out[idx] = ((c & O) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0
  }
  copyBorder(out, w, h)
  return out
}
export function copyBorder(out: Uint32Array, w: number, h: number): void {
  if (w <= 2 || h <= 2) return
  for (let x = 0; x < w; x++) {
    out[x] = out[x + w]!
    out[(h - 1) * w + x] = out[(h - 2) * w + x]!
  }
  for (let y = 0; y < h; y++) {
    out[y * w] = out[y * w + 1]!
    out[y * w + w - 1] = out[y * w + w - 2]!
  }
}

// ---------- casSharpen (Kotlin L750–790) ----------
export function casSharpen(px: Uint32Array, w: number, h: number, amount: number): Uint32Array {
  const out = px.slice()
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x
    const c = px[idx]!
    const cr = (c >>> 16) & 0xff, cg = (c >>> 8) & 0xff, cb = c & 0xff
    const a = px[idx - 1]!, b = px[idx + 1]!, cc = px[idx - w]!, d = px[idx + w]!
    const ar = (a >>> 16) & 0xff, ag = (a >>> 8) & 0xff, ab = a & 0xff
    const br = (b >>> 16) & 0xff, bg = (b >>> 8) & 0xff, bb = b & 0xff
    const cr2 = (cc >>> 16) & 0xff, cg2 = (cc >>> 8) & 0xff, cb2 = cc & 0xff
    const dr = (d >>> 16) & 0xff, dg = (d >>> 8) & 0xff, db = d & 0xff
    const minR = Math.min(Math.min(ar, br), Math.min(cr2, dr))
    const maxR = Math.max(Math.max(ar, br), Math.max(cr2, dr))
    const minG = Math.min(Math.min(ag, bg), Math.min(cg2, dg))
    const maxG = Math.max(Math.max(ag, bg), Math.max(cg2, dg))
    const minB = Math.min(Math.min(ab, bb), Math.min(cb2, db))
    const maxB = Math.max(Math.max(ab, bb), Math.max(cb2, db))
    const ampR = maxR > minR ? amount * (1 - ((maxR - minR) / 255) * 0.8) : 0
    const ampG = maxG > minG ? amount * (1 - ((maxG - minG) / 255) * 0.8) : 0
    const ampB = maxB > minB ? amount * (1 - ((maxB - minB) / 255) * 0.8) : 0
    const nr = c255(Math.min(maxR + 16, Math.max(minR - 16, rnd(cr + (cr * 2 - minR - maxR) * ampR))))
    const ng = c255(Math.min(maxG + 16, Math.max(minG - 16, rnd(cg + (cg * 2 - minG - maxG) * ampG))))
    const nb = c255(Math.min(maxB + 16, Math.max(minB - 16, rnd(cb + (cb * 2 - minB - maxB) * ampB))))
    out[idx] = ((c & O) | (nr << 16) | (ng << 8) | nb) >>> 0
  }
  copyBorder(out, w, h)
  return out
}

// ---------- lanczos3 + packArgb (Kotlin L1131–1146) ----------
export function lanczos3(x: number): number {
  const v = Math.abs(x)
  if (v < 1e-6) return 1
  if (v >= 3) return 0
  const pix = Math.PI * v
  return (3 * Math.sin(pix) * Math.sin(pix / 3)) / (pix * pix)
}
export function packArgb(a: number, r: number, g: number, b: number, wsum: number): number {
  if (wsum === 0) return O
  const nr = c255(rnd(r / wsum)), ng = c255(rnd(g / wsum))
  const nb = c255(rnd(b / wsum)), na = c255(rnd(a / wsum))
  return ((na << 24) | (nr << 16) | (ng << 8) | nb) >>> 0
}
export function lanczosScaleTo(
  px: Uint32Array, sw: number, sh: number, nw: number, nh: number,
): Uint32Array {
  if (nw === sw && nh === sh) return px.slice()
  const scaleX = nw / sw, scaleY = nh / sh
  const mid = new Uint32Array(nw * sh)
  for (let y = 0; y < sh; y++) {
    const rowOff = y * sw
    for (let x = 0; x < nw; x++) {
      const sx = x / scaleX
      const center = Math.trunc(sx)
      let r = 0, g = 0, b = 0, a = 0, wsum = 0
      for (let t = -3; t <= 3; t++) {
        const sxx = Math.min(sw - 1, Math.max(0, center + t))
        const wgt = lanczos3(sx - sxx)
        if (wgt === 0) continue
        const p = px[rowOff + sxx]!
        r += ((p >>> 16) & 0xff) * wgt
        g += ((p >>> 8) & 0xff) * wgt
        b += (p & 0xff) * wgt
        a += ((p >>> 24) & 0xff) * wgt
        wsum += wgt
      }
      mid[y * nw + x] = packArgb(a, r, g, b, wsum)
    }
  }
  const out = new Uint32Array(nw * nh)
  for (let y = 0; y < nh; y++) {
    const sy = y / scaleY
    const center = Math.trunc(sy)
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0
      for (let t = -3; t <= 3; t++) {
        const syy = Math.min(sh - 1, Math.max(0, center + t))
        const wgt = lanczos3(sy - syy)
        if (wgt === 0) continue
        const p = mid[syy * nw + x]!
        r += ((p >>> 16) & 0xff) * wgt
        g += ((p >>> 8) & 0xff) * wgt
        b += (p & 0xff) * wgt
        a += ((p >>> 24) & 0xff) * wgt
        wsum += wgt
      }
      out[y * nw + x] = packArgb(a, r, g, b, wsum)
    }
  }
  return out
}

// ---------- bilateralLite (Kotlin L1018–1054) ----------
export function bilateralLite(
  px: Uint32Array, w: number, h: number, radius: number, sigmaColor: number,
): Uint32Array {
  if (radius <= 0) return px.slice()
  const out = px.slice()
  const sigma2 = 2 * sigmaColor * sigmaColor
  const r = w * h > 2_000_000 ? 1 : radius
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    const idx = y * w + x
    const c = px[idx]!
    const cr = (c >>> 16) & 0xff, cg = (c >>> 8) & 0xff, cb = c & 0xff
    let sw = 0, sr = 0, sg = 0, sb = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const p = px[idx + dy * w + dx]!
      const pr = (p >>> 16) & 0xff, pg = (p >>> 8) & 0xff, pb = p & 0xff
      const dist2 = (pr - cr) * (pr - cr) + (pg - cg) * (pg - cg) + (pb - cb) * (pb - cb)
      const wgt = Math.exp(-dist2 / sigma2)
      sw += wgt; sr += pr * wgt; sg += pg * wgt; sb += pb * wgt
    }
    if (sw > 0) {
      const nr = c255(rnd(sr / sw)), ng = c255(rnd(sg / sw)), nb = c255(rnd(sb / sw))
      out[idx] = ((c & O) | (nr << 16) | (ng << 8) | nb) >>> 0
    }
  }
  return out
}

// ---------- anime4kLines (Kotlin L801–893) ----------
export const ANIME4K_FLAT_DENOISE = 0.12
export function anime4kLines(
  px: Uint32Array, w: number, h: number, strength: number, kExtra: number,
): Uint32Array {
  if (w < 4 || h < 4) return px.slice()
  const lumaCap = 191, threshold = 4
  const k = 0.35 + 0.85 * strength + kExtra
  const flatDenoise = ANIME4K_FLAT_DENOISE * strength
  const lum = new Int32Array(w * h)
  for (let i = 0; i < px.length; i++) {
    const p = px[i]!
    lum[i] = Math.trunc((((p >>> 16) & 0xff) * 299 + ((p >>> 8) & 0xff) * 587 + (p & 0xff) * 114) / 1000)
  }
  const tmp = new Int32Array(w * h), bufA = new Int32Array(w * h), bg = new Int32Array(w * h)
  const hPass = (s: Int32Array, d: Int32Array, max: boolean) => {
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        const a = s[row + Math.max(0, x - 1)]!, b = s[row + x]!, c2 = s[row + Math.min(w - 1, x + 1)]!
        d[row + x] = max ? Math.max(a, Math.max(b, c2)) : Math.min(a, Math.min(b, c2))
      }
    }
  }
  const vPass = (s: Int32Array, d: Int32Array, max: boolean) => {
    for (let y = 0; y < h; y++) {
      const rU = Math.max(0, y - 1) * w, rC = y * w, rD = Math.min(h - 1, y + 1) * w
      for (let x = 0; x < w; x++) {
        const a = s[rU + x]!, b = s[rC + x]!, c2 = s[rD + x]!
        d[y * w + x] = max ? Math.max(a, Math.max(b, c2)) : Math.min(a, Math.min(b, c2))
      }
    }
  }
  hPass(lum, tmp, true); vPass(tmp, bufA, true)
  hPass(bufA, tmp, true); vPass(tmp, bufA, true)
  hPass(bufA, tmp, false); vPass(tmp, bg, false)
  hPass(bg, tmp, false); vPass(tmp, bg, false)
  const out = px.slice()
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x
    const l = lum[idx]!
    const background = Math.min(bg[idx]!, lumaCap)
    const diff = background - l
    let delta = 0
    if (diff > threshold) delta = -Math.min(diff, 72) * k
    else {
      const mean = (lum[idx - 1]! + lum[idx + 1]! + lum[idx - w]! + lum[idx + w]!) / 4
      delta = (mean - l) * flatDenoise
    }
    if (delta === 0) continue
    const c = px[idx]!
    const ch = (shift: number): number => c255(rnd(((c >>> shift) & 0xff) + delta))
    out[idx] = ((c & O) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0
  }
  copyBorder(out, w, h)
  return out
}

// ---------- casSharpenEdges (Kotlin L941–970) ----------
const lumOf = (p: number): number =>
  Math.trunc(((((p >>> 16) & 0xff) * 299) + (((p >>> 8) & 0xff) * 587) + ((p & 0xff) * 114)) / 1000)
export function casSharpenEdges(
  orig: Uint32Array, sharped: Uint32Array, w: number, h: number,
  amount: number, edgeRange: number,
): Uint32Array {
  if (amount <= 0 || w < 4 || h < 4) return orig.slice()
  const out = orig.slice()
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const c = lumOf(orig[i]!)
    let hit = false
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(lumOf(orig[i + dy * w + dx]!) - c) >= edgeRange) { hit = true; break }
    }
    if (hit) out[i] = sharped[i]!
  }
  return out
}

// ---------- Anime4K depth-to-space (Kotlin L165–212) ----------
export function anime4kUpscale2xPixels(
  plane: Float32Array, w: number, h: number, conv: Float32Array, strength: number,
): Uint32Array {
  const d = strength >= 0.999 ? 1 : strength
  const ow = w * 2, oh = h * 2
  const px = new Uint32Array(ow * oh)
  for (let oy = 0; oy < oh; oy++) {
    const cy = oy >>> 1
    const fy = (oy + 0.5) / 2 - 0.5
    const sy0 = Math.trunc(fy)
    const sy1 = Math.min(sy0 + 1, h - 1)
    const wy = fy - sy0
    const sy0c = Math.max(0, sy0)
    for (let ox = 0; ox < ow; ox++) {
      const cx = ox >>> 1
      const fx = (ox + 0.5) / 2 - 0.5
      const sx0 = Math.trunc(fx)
      const sx1 = Math.min(sx0 + 1, w - 1)
      const wx = fx - sx0
      const sx0c = Math.max(0, sx0)
      const bil = (ch: number): number => {
        const i00 = (sy0c * w + sx0c) * 4 + ch
        const i01 = (sy0c * w + sx1) * 4 + ch
        const i10 = (sy1 * w + sx0c) * 4 + ch
        const i11 = (sy1 * w + sx1) * 4 + ch
        const top = plane[i00]! + (plane[i01]! - plane[i00]!) * wx
        const bot = plane[i10]! + (plane[i11]! - plane[i10]!) * wx
        return top + (bot - top) * wy
      }
      const ci = (cy * w + cx) * 4 + ((oy & 1) * 2 + (ox & 1))
      const residual = conv[ci]! * d
      px[oy * ow + ox] = ((O | (clamp255(bil(0) + residual) << 16) |
        (clamp255(bil(1) + residual) << 8) | clamp255(bil(2) + residual)) >>> 0)
    }
  }
  return px
}
export function anime4kRestorePixels(
  plane: Float32Array, out: Float32Array, strength: number,
): Uint32Array {
  const n = plane.length / 4
  const px = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const d = 0.6 * (strength >= 0.999 ? 1 : strength)
    px[i] = ((O | (clamp255(plane[o]! + out[o]! * d) << 16) |
      (clamp255(plane[o + 1]! + out[o + 1]! * d) << 8) |
      clamp255(plane[o + 2]! + out[o + 2]! * d)) >>> 0)
  }
  return px
}
export function bitmapToPlane(px: Uint32Array, n: number): Float32Array {
  const plane = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const p = px[i]!, o = i * 4
    plane[o] = ((p >>> 16) & 0xff) / 255
    plane[o + 1] = ((p >>> 8) & 0xff) / 255
    plane[o + 2] = (p & 0xff) / 255
    plane[o + 3] = 1
  }
  return plane
}
export function convLayerRef(
  bias: Float32Array, groups: { tex: number; act: number; ox: number; oy: number; w: Float32Array }[],
  src0: Float32Array, src1: Float32Array, w: number, h: number,
): Float32Array {
  const out = new Float32Array(w * h * 4)
  const v = new Float32Array(4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r0 = bias[0]!, r1 = bias[1]!, r2 = bias[2]!, r3 = bias[3]!
    for (const g of groups) {
      const tex = g.tex === 0 ? src0 : src1
      const cx = Math.min(w - 1, Math.max(0, x + g.ox))
      const cy = Math.min(h - 1, Math.max(0, y + g.oy))
      const i = (cy * w + cx) * 4
      if (g.act === 1) for (let k = 0; k < 4; k++) v[k] = Math.max(0, tex[i + k]!)
      else if (g.act === 2) for (let k = 0; k < 4; k++) v[k] = Math.max(0, -tex[i + k]!)
      else for (let k = 0; k < 4; k++) v[k] = tex[i + k]!
      const wq = g.w
      r0 += wq[0]! * v[0]! + wq[4]! * v[1]! + wq[8]! * v[2]! + wq[12]! * v[3]!
      r1 += wq[1]! * v[0]! + wq[5]! * v[1]! + wq[9]! * v[2]! + wq[13]! * v[3]!
      r2 += wq[2]! * v[0]! + wq[6]! * v[1]! + wq[10]! * v[2]! + wq[14]! * v[3]!
      r3 += wq[3]! * v[0]! + wq[7]! * v[1]! + wq[11]! * v[2]! + wq[15]! * v[3]!
    }
    const o = (y * w + x) * 4
    out[o] = r0; out[o + 1] = r1; out[o + 2] = r2; out[o + 3] = r3
  }
  return out
}