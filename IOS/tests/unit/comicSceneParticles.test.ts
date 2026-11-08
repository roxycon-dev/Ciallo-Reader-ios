import { describe, expect, it } from 'vitest'

import type { ComicScene } from '../../src/core/audio/sceneTypes'
import {
  alphaFrac,
  ComicSceneFxDriver,
  ComicSceneFxEngine,
  createSeededRandom,
  evenStops,
  lerpArgb,
  type FxRandom,
  type FrameTicker,
  SCENE_ORDINAL,
  SCENE_PARTICLE_COUNT,
  type SceneCanvas,
  type SceneCommand,
  clampFrameDt,
  sakuraSwayDeg,
  SAKURA_PETAL_SHAPES,
  waveY,
  withAlpha,
} from '../../src/core/comic/comicSceneFx'

/* ── test doubles ────────────────────────────────────────────────────────────────── */

function recordingCanvas(w: number, h: number): SceneCanvas & { commands: SceneCommand[] } {
  const commands: SceneCommand[] = []
  return {
    commands,
    size: () => ({ width: w, height: h }),
    emit: (c) => {
      commands.push(c)
    },
  }
}

/** Deterministic, replayable noise stream so spawn values can be asserted. */
function scriptedRandom(values: number[]): FxRandom & { calls: number } {
  let i = 0
  return {
    calls: 0,
    nextFloat(): number {
      const v = values[i % values.length]!
      i++
      return v
    },
  }
}

const W = 1000
const H = 2000

function engineFor(scene: ComicScene, rnd?: FxRandom): ComicSceneFxEngine {
  const e = new ComicSceneFxEngine(scene, rnd)
  e.ensureSpawn(W, H)
  return e
}

/* ── scene ordinals + spawn budgets (Kotlin L145–209) ────────────────────────────── */

describe('SCENE_ORDINAL', () => {
  it('mirrors the Kotlin ComicScene declaration order exactly', () => {
    expect(Object.keys(SCENE_ORDINAL)).toEqual([
      'NONE',
      'RAIN',
      'SNOW',
      'SAKURA',
      'FIREFLY',
      'OCEAN',
      'CAMPFIRE',
      'NIGHT',
    ])
    expect(SCENE_ORDINAL.NONE).toBe(0)
    expect(SCENE_ORDINAL.RAIN).toBe(1)
    expect(SCENE_ORDINAL.SNOW).toBe(2)
    expect(SCENE_ORDINAL.SAKURA).toBe(3)
    expect(SCENE_ORDINAL.FIREFLY).toBe(4)
    expect(SCENE_ORDINAL.OCEAN).toBe(5)
    expect(SCENE_ORDINAL.CAMPFIRE).toBe(6)
    expect(SCENE_ORDINAL.NIGHT).toBe(7)
  })
})

describe('particle spawn counts', () => {
  const all: ComicScene[] = [
    'NONE',
    'RAIN',
    'SNOW',
    'SAKURA',
    'FIREFLY',
    'OCEAN',
    'CAMPFIRE',
    'NIGHT',
  ]

  it('per-scene budgets match the Kotlin `when (scene)` table', () => {
    expect(SCENE_PARTICLE_COUNT).toEqual({
      NONE: 0,
      RAIN: 130,
      SNOW: 90,
      SAKURA: 44,
      FIREFLY: 26,
      OCEAN: 16,
      CAMPFIRE: 34,
      NIGHT: 46,
    })
  })

  it('every scene spawns exactly its budget', () => {
    for (const scene of all) {
      const e = engineFor(scene)
      expect(e.particles.length).toBe(SCENE_PARTICLE_COUNT[scene])
      expect(e.ripples.length).toBe(0)
    }
  })

  it('NONE spawns nothing', () => {
    const e = engineFor('NONE')
    expect(e.particles).toHaveLength(0)
    e.draw(recordingCanvas(W, H), 'NONE')
    expect(e.particles).toHaveLength(0)
  })

  it('spawn positions stay inside the viewport', () => {
    for (const scene of all) {
      const e = engineFor(scene)
      for (const p of e.particles) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(W)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(H)
      }
    }
  })

  it('RAIN/SNOW use three deterministic depth layers, others use the RNG', () => {
    const rain = engineFor('RAIN')
    // (it % 3) / 2 * 0.8 + 0.2 — float rounding differs from Kotlin's, so compare loosely
    rain.particles.slice(0, 6).forEach((p, i) => {
      expect(p.depth).toBeCloseTo([0.2, 0.6, 1.0][i % 3]!, 10)
    })
    for (const p of rain.particles) expect([0.2, 0.6, 1.0]).toContain(Number(p.depth.toFixed(6)))

    const rnd = scriptedRandom([0.5])
    const snow = engineFor('SNOW', rnd)
    snow.particles.slice(0, 3).forEach((p, i) => {
      expect(p.depth).toBeCloseTo([0.2, 0.6, 1.0][i]!, 10)
    })

    const ocean = engineFor('OCEAN', scriptedRandom([0.25, 0.75]))
    // non-RAIN/SNOW scenes draw the depth straight from the RNG stream
    for (const p of ocean.particles) expect([0.25, 0.75]).toContain(p.depth)
  })

  it('maxLife is scene-specific and life starts randomized inside it', () => {
    const sakura = engineFor('SAKURA', scriptedRandom([0, 0.5]))
    for (const p of sakura.particles) {
      expect(p.maxLife).toBeGreaterThanOrEqual(14)
      expect(p.maxLife).toBeLessThanOrEqual(22)
    }
    const campfire = engineFor('CAMPFIRE', scriptedRandom([0, 0.5]))
    for (const p of campfire.particles) {
      expect(p.maxLife).toBeGreaterThanOrEqual(1.2)
      expect(p.maxLife).toBeLessThanOrEqual(2.6)
    }
    const firefly = engineFor('FIREFLY', scriptedRandom([0, 0.5]))
    for (const p of firefly.particles) {
      expect(p.maxLife).toBeGreaterThanOrEqual(8)
      expect(p.maxLife).toBeLessThanOrEqual(16)
    }
    const rain = engineFor('RAIN', scriptedRandom([0, 0.5]))
    for (const p of rain.particles) expect(p.maxLife).toBe(30)
  })

  it('initial life is a fraction of maxLife (alphaFrac ∈ [0,1])', () => {
    for (const scene of ['RAIN', 'SNOW', 'SAKURA', 'FIREFLY', 'OCEAN', 'CAMPFIRE', 'NIGHT'] as const) {
      const e = engineFor(scene, scriptedRandom([0.3, 0.7]))
      for (const p of e.particles) {
        expect(alphaFrac(p)).toBeGreaterThanOrEqual(0)
        expect(alphaFrac(p)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('ensureSpawn is idempotent for the same viewport and reseeds on a resize', () => {
    const e = new ComicSceneFxEngine('RAIN', scriptedRandom([0.1, 0.2]))
    e.ensureSpawn(W, H)
    const first = e.particles.map((p) => p.x)
    e.ensureSpawn(W, H)
    expect(e.particles.map((p) => p.x)).toEqual(first)
    e.ensureSpawn(W + 40, H)
    expect(e.particles.length).toBe(130)
  })
})

/* ── seeded RNG determinism ─────────────────────────────────────────────────────── */

describe('createSeededRandom', () => {
  it('same seed → identical stream (the determinism Kotlin relied on)', () => {
    const a = createSeededRandom(13)
    const b = createSeededRandom(13)
    for (let i = 0; i < 64; i++) expect(a.nextFloat()).toBe(b.nextFloat())
  })

  it('different seeds → different streams', () => {
    const a = createSeededRandom(13)
    const b = createSeededRandom(14)
    const sa = Array.from({ length: 16 }, () => a.nextFloat())
    const sb = Array.from({ length: 16 }, () => b.nextFloat())
    expect(sa).not.toEqual(sb)
  })

  it('stays inside [0,1) and is roughly uniform', () => {
    const r = createSeededRandom(SCENE_ORDINAL.RAIN * 7919 + 13)
    let sum = 0
    const n = 4096
    let belowHalf = 0
    for (let i = 0; i < n; i++) {
      const v = r.nextFloat()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      sum += v
      if (v < 0.5) belowHalf++
    }
    expect(sum / n).toBeCloseTo(0.5, 1)
    expect(belowHalf / n).toBeCloseTo(0.5, 1)
  })

  it('the engine seed expression is scene.ordinal * 7919 + 13', () => {
    const a = new ComicSceneFxEngine('SNOW')
    const b = new ComicSceneFxEngine('SNOW', createSeededRandom(SCENE_ORDINAL.SNOW * 7919 + 13))
    a.ensureSpawn(W, H)
    b.ensureSpawn(W, H)
    expect(a.particles.map((p) => [p.x, p.y, p.seed])).toEqual(
      b.particles.map((p) => [p.x, p.y, p.seed]),
    )
  })

  it('different scenes derive different seeds', () => {
    const rain = new ComicSceneFxEngine('RAIN')
    const snow = new ComicSceneFxEngine('SNOW')
    rain.ensureSpawn(W, H)
    snow.ensureSpawn(W, H)
    const rs = rain.particles.map((p) => p.seed)
    const ss = snow.particles.map((p) => p.seed)
    expect(rs.slice(0, 20)).not.toEqual(ss.slice(0, 20))
  })
})

/* ── per-scene integration (Kotlin L212–361) ─────────────────────────────────────── */

describe('scene integration', () => {
  it('rain accelerates to the depth-dependent terminal velocity and wraps', () => {
    const e = engineFor('RAIN', scriptedRandom([0.5]))
    e.particles.forEach((p) => {
      p.depth = 1
      p.y = 10
      p.vy = 0
    })
    for (let i = 0; i < 200; i++) e.step(0.016, 1)
    for (const p of e.particles) {
      // term = 420 + 640 * depth = 1060 at depth 1, and a wrapped particle was reset
      expect(p.vy).toBeLessThanOrEqual(1060 + 1e-6)
      expect(p.y).toBeLessThanOrEqual(H + 1e-6)
    }
    expect(e.ripples.length).toBeLessThanOrEqual(22)
  })

  it('snow stays slow (terminal 24..94) and re-enters from the top', () => {
    const e = engineFor('SNOW', scriptedRandom([0.5]))
    e.particles.forEach((p) => {
      p.depth = 1
      p.y = H - 1
      p.vy = 0
    })
    e.step(0.016, 1)
    for (const p of e.particles) expect(p.vy).toBeLessThanOrEqual(94 + 1e-6)
    e.step(0.5, 1.5)
    for (const p of e.particles) expect(p.y).toBeLessThanOrEqual(H + 20 + 1e-6)
  })

  it('sakura dies and respawns at the top of the screen', () => {
    const e = engineFor('SAKURA', scriptedRandom([0.5]))
    const p = e.particles[0]!
    p.life = p.maxLife
    p.y = 100
    e.step(0.016, 1)
    expect(p.life).toBe(0)
    // respawned at y = -24, then integrated by one dt at vy = 26 + 44*depth
    expect(p.y).toBeCloseTo(-24 + (26 + 44 * p.depth) * 0.016, 9)
  })

  it('firefly speed is clamped to 46 px/s', () => {
    const e = engineFor('FIREFLY', scriptedRandom([1]))
    for (let i = 0; i < 400; i++) e.step(0.05, i * 0.05)
    for (const p of e.particles) {
      expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(46 + 1e-6)
    }
  })

  it('campfire embers launch upward and the light gravity decelerates them', () => {
    const e = engineFor('CAMPFIRE', scriptedRandom([0.5]))
    const p = e.particles[0]!
    p.life = p.maxLife + 0.001 // life > maxLife triggers the relaunch branch
    e.step(0.016, 1)
    // vy = -(110 + rnd*120) * (0.6 + depth) then +46*dt
    expect(p.vy).toBeLessThan(0)
    const v0 = p.vy
    const y0 = p.y
    // the ember stays inside the 1.2..2.6 s life budget, so we only observe the
    // deceleration toward the apex — `p.vy += 46 * dt` every frame
    for (let i = 0; i < 20; i++) e.step(0.016, 1 + i * 0.016)
    expect(p.vy).toBeGreaterThan(v0)
    expect(p.y).toBeLessThan(y0)
  })

  it('drift (OCEAN/NIGHT) rises for OCEAN and sinks for NIGHT', () => {
    const ocean = engineFor('OCEAN', scriptedRandom([0.5]))
    const op = ocean.particles[0]!
    op.y = H / 2
    op.depth = 1
    const y0 = op.y
    ocean.step(0.5, 1)
    expect(op.y).toBeLessThan(y0) // OCEAN: -6 * depth * dt * 8 → upward

    const night = engineFor('NIGHT', scriptedRandom([0.5]))
    const np = night.particles[0]!
    np.y = H / 2
    np.depth = 1
    const ny0 = np.y
    night.step(0.5, 1)
    expect(np.y).toBeGreaterThan(ny0) // NIGHT: +3 * depth * dt * 2 → downward
  })

  it('wind is a pure function of absolute time', () => {
    const e = engineFor('SNOW', scriptedRandom([0.5]))
    const a = engineFor('SNOW', scriptedRandom([0.5]))
    e.step(0.016, 3.5)
    a.step(0.016, 3.5)
    expect(e.particles.map((p) => p.vx)).toEqual(a.particles.map((p) => p.vx))
  })
})

/* ── draw command emission ───────────────────────────────────────────────────────── */

describe('draw commands', () => {
  it('RAIN emits one gradient line per particle (plus any ripples)', () => {
    const e = engineFor('RAIN', scriptedRandom([0.5]))
    for (let i = 0; i < 3; i++) e.step(0.016, 1 + i * 0.016) // give the streaks velocity
    const c = recordingCanvas(W, H)
    e.draw(c, 'RAIN')
    const lines = c.commands.filter((x) => x.kind === 'line')
    expect(lines).toHaveLength(130)
    const first = lines[0]
    if (first !== undefined && first.kind === 'line') {
      expect(first.brush).not.toBeNull()
      expect(first.brush?.stops).toHaveLength(4)
      expect(first.strokeWidth).toBeGreaterThan(0)
      expect(Math.hypot(first.x2 - first.x1, first.y2 - first.y1)).toBeGreaterThan(0)
    }
  })

  it('SNOW near particles get two circles, far ones one', () => {
    const e = engineFor('SNOW', scriptedRandom([0.5]))
    e.particles.forEach((p, i) => {
      p.depth = i % 2 === 0 ? 0.9 : 0.2 // > 0.6 is "near"
      p.seed = 0.5
    })
    const c = recordingCanvas(W, H)
    e.draw(c, 'SNOW')
    const circles = c.commands.filter((x) => x.kind === 'circle')
    // 45 near × 2 + 45 far × 1
    expect(circles).toHaveLength(45 * 2 + 45)
  })

  it('SAKURA emits translated+rotated petals', () => {
    const e = engineFor('SAKURA', scriptedRandom([0.5]))
    const c = recordingCanvas(W, H)
    e.draw(c, 'SAKURA')
    const paths = c.commands.filter((x) => x.kind === 'path')
    expect(paths).toHaveLength(44)
    for (const p of paths) {
      if (p.kind === 'path') {
        expect(p.translateX).toBeDefined()
        expect(p.translateY).toBeDefined()
        expect(p.rotateDeg).toBeDefined()
        expect(p.commands).toHaveLength(4)
      }
    }
  })

  it('FIREFLY emits additive glow pairs', () => {
    const e = engineFor('FIREFLY', scriptedRandom([0.5]))
    const c = recordingCanvas(W, H)
    e.draw(c, 'FIREFLY')
    const circles = c.commands.filter((x) => x.kind === 'circle')
    expect(circles).toHaveLength(26 * 2)
    for (const cc of circles) {
      if (cc.kind === 'circle') expect(cc.blend).toBe('Plus')
    }
  })

  it('CAMPFIRE emits 3 flame paths + a glow + 2 circles per ember', () => {
    const e = engineFor('CAMPFIRE', scriptedRandom([0.5]))
    const c = recordingCanvas(W, H)
    e.draw(c, 'CAMPFIRE')
    const paths = c.commands.filter((x) => x.kind === 'path')
    expect(paths).toHaveLength(3)
    for (const p of paths) if (p.kind === 'path') expect(p.commands).toHaveLength(4)
    const circles = c.commands.filter((x) => x.kind === 'circle')
    expect(circles).toHaveLength(1 + 34 * 2)
  })

  it('OCEAN emits a sky rect + 4 wave layers + one circle per foam particle', () => {
    const e = engineFor('OCEAN', scriptedRandom([0.5]))
    const c = recordingCanvas(W, H)
    e.draw(c, 'OCEAN')
    expect(c.commands.filter((x) => x.kind === 'rect')).toHaveLength(1)
    expect(c.commands.filter((x) => x.kind === 'path')).toHaveLength(4)
    expect(c.commands.filter((x) => x.kind === 'circle')).toHaveLength(16)
  })

  it('NIGHT emits a night rect, stars (some with cross rays) and 3 cloud ovals', () => {
    const e = engineFor('NIGHT', scriptedRandom([0.99]))
    for (const p of e.particles) p.seed = 0.99 // all "stars", all with rays
    const c = recordingCanvas(W, H)
    e.draw(c, 'NIGHT')
    expect(c.commands.filter((x) => x.kind === 'rect')).toHaveLength(1)
    expect(c.commands.filter((x) => x.kind === 'oval')).toHaveLength(3)
    const circles = c.commands.filter((x) => x.kind === 'circle')
    const lines = c.commands.filter((x) => x.kind === 'line')
    expect(circles).toHaveLength(46)
    expect(lines).toHaveLength(46 * 2) // two cross rays per bright star
  })

  it('NIGHT routes low-seed particles to the firefly glow branch', () => {
    const e = engineFor('NIGHT', scriptedRandom([0.2]))
    for (const p of e.particles) p.seed = 0.2 // 0.12 < seed <= 0.28
    const c = recordingCanvas(W, H)
    e.draw(c, 'NIGHT')
    expect(c.commands.filter((x) => x.kind === 'circle')).toHaveLength(46)
    expect(c.commands.filter((x) => x.kind === 'line')).toHaveLength(0)
  })
})

/* ── wave field + sakura sway math ──────────────────────────────────────────────── */

describe('waveY', () => {
  it('equals baseline + primary + secondary harmonic', () => {
    const x = 123
    const baseline = 100
    const freq = 0.01
    const ampl = 20
    const phase = 0.7
    const expected =
      baseline +
      Math.sin(x * freq + phase) * ampl +
      Math.sin(x * freq * 2.7 + phase * 1.7) * ampl * 0.35
    expect(waveY(x, baseline, freq, ampl, phase)).toBeCloseTo(expected, 12)
  })

  it('amplitude 0 collapses onto the baseline', () => {
    expect(waveY(500, 97, 0.02, 0, 1.23)).toBe(97)
  })

  it('remains bounded by baseline ± 1.35 * amplitude', () => {
    for (let x = 0; x < 1200; x += 37) {
      const v = waveY(x, 500, 0.01, 20, 0.3)
      expect(Math.abs(v - 500)).toBeLessThanOrEqual(1.35 * 20 + 1e-9)
    }
  })
})

describe('sakuraSwayDeg', () => {
  it('equals 8 + 16·sin(ph) + 7·sin(2ph + 0.9)', () => {
    const t = 3
    const period = 2.5
    const seed = 0.37
    const ph = 2 * Math.PI * (t / period + seed)
    expect(sakuraSwayDeg(t, period, seed)).toBeCloseTo(8 + 16 * Math.sin(ph) + 7 * Math.sin(2 * ph + 0.9), 12)
  })

  it('stays inside the fitted [8−23, 8+23] envelope', () => {
    for (let t = 0; t < 8; t += 0.05) {
      const d = sakuraSwayDeg(t, 2 + 0.5, 0.6)
      expect(d).toBeGreaterThanOrEqual(-15 - 1e-9)
      expect(d).toBeLessThanOrEqual(31 + 1e-9)
    }
  })

  it('seed shifts the phase (per-petal variation)', () => {
    expect(sakuraSwayDeg(1, 3, 0)).not.toBeCloseTo(sakuraSwayDeg(1, 3, 0.5), 6)
  })
})

describe('SAKURA_PETAL_SHAPES', () => {
  it('pre-generates 24 size variants with the same cubic command sequence', () => {
    expect(SAKURA_PETAL_SHAPES).toHaveLength(24)
    for (const shape of SAKURA_PETAL_SHAPES) {
      expect(shape.map((c) => c.op)).toEqual(['moveTo', 'cubicTo', 'cubicTo', 'close'])
    }
    // rx grows from 4.6 to 7.775 across the 24 variants
    const first = SAKURA_PETAL_SHAPES[0]![0]!.args[0] as number
    const last = SAKURA_PETAL_SHAPES[23]![0]!.args[0] as number
    expect(first).toBeCloseTo(-4.6, 9)
    expect(last).toBeCloseTo(-(4.6 + (23 / 24) * 3.2), 9)
  })
})

/* ── colour helpers ──────────────────────────────────────────────────────────────── */

describe('colour helpers', () => {
  it('withAlpha replaces only the alpha byte', () => {
    expect(withAlpha(0xff123456, 1)).toBe(0xff123456)
    expect(withAlpha(0xff123456, 0)).toBe(0x00123456)
    expect(withAlpha(0xff000000, 0.5)).toBe(0x80000000)
  })

  it('lerpArgb interpolates every channel', () => {
    expect(lerpArgb(0xff000000, 0xffffffff, 0)).toBe(0xff000000)
    expect(lerpArgb(0xff000000, 0xffffffff, 1)).toBe(0xffffffff)
    expect(lerpArgb(0xff000000, 0xffffffff, 0.5)).toBe(0xff808080)
    // Wave Field: front → back over the layer ramp
    // r (126+26)/2 = 76 = 0x4c, g (201+35)/2 = 118 = 0x76, b round(180.5) = 181 = 0xb5
    expect(lerpArgb(0xff7ec9eb, 0xff1a237e, 0.5)).toBe(0xff4c76b5)
  })

  it('evenStops distributes list gradients evenly', () => {
    expect(evenStops([0xff000000, 0xffffffff]).map((s) => s.position)).toEqual([0, 1])
    expect(evenStops([0xff000000, 0xff888888, 0xffffffff]).map((s) => s.position)).toEqual([
      0, 0.5, 1,
    ])
  })
})

/* ── frame driver (Kotlin L112–142) ─────────────────────────────────────────────── */

describe('ComicSceneFxDriver', () => {
  function seededRain(): ComicSceneFxEngine {
    return engineFor('RAIN', scriptedRandom([0.5]))
  }

  it('clamps dt into [0.001, 0.1] and converts ns → s', () => {
    expect(clampFrameDt(16_666_666)).toBeCloseTo(0.016666666, 9)
    expect(clampFrameDt(1e12)).toBe(0.1) // 1000 s gap → clamped
    expect(clampFrameDt(1e-9)).toBe(0.001) // 1 ns gap → clamped
    expect(clampFrameDt(0.1 * 1_000_000_000)).toBe(0.1)
    expect(clampFrameDt(0.001 * 1_000_000_000)).toBe(0.001)

    // a 1000-second stall advances the simulation by exactly the 0.1 s budget
    const a = seededRain()
    const b = seededRain()
    a.step(clampFrameDt(1e12), 1)
    b.step(0.1, 1)
    expect(a.particles.map((p) => [p.x, p.y, p.vy])).toEqual(b.particles.map((p) => [p.x, p.y, p.vy]))

    const c = seededRain()
    const tiny = seededRain()
    c.step(clampFrameDt(1e-9), 1)
    tiny.step(0.001, 1)
    expect(c.particles.map((p) => [p.x, p.y, p.vy])).toEqual(tiny.particles.map((p) => [p.x, p.y, p.vy]))
  })

  it('skips the very first frame (last === 0) and stamps the tick afterwards', () => {
    const d = new ComicSceneFxDriver('RAIN', { next: () => Promise.resolve(null) })
    d.frame(1_000_000)
    expect(d.tick()).toBe(0) // first frame only seeds `last`
    d.frame(2_000_000)
    expect(d.tick()).toBe(2_000_000)
  })

  it('rebuilds the engine when the scene changes (scene-seeded particles)', () => {
    const d = new ComicSceneFxDriver('RAIN', { next: () => Promise.resolve(null) })
    const c = recordingCanvas(W, H)
    d.draw(c)
    d.setScene('SNOW')
    expect(d.currentScene()).toBe('SNOW')
    d.draw(recordingCanvas(W, H))
    expect(d.currentScene()).toBe('SNOW')
  })

  it('the frame loop stops when the ticker resolves null', async () => {
    const frames: (number | null)[] = [1_000_000, 2_000_000, null]
    const ticker: FrameTicker = { next: () => Promise.resolve(frames.shift() ?? null) }
    const c = recordingCanvas(W, H)
    const d = new ComicSceneFxDriver('RAIN', ticker, scriptedRandom([0.5]))
    await d.run(c)
    expect(d.tick()).toBe(2_000_000)
  })
})
