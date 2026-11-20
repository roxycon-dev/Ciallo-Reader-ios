/**
 * `LiquidSegmentOption` / `LiquidSegmentView` / `LiquidSegmentedSelector` ——
 * `ui/components/LiquidSegmentedSelector.kt`（157 行）+ `ui/components/LiquidSegmentView.kt`（332 行）的 Web 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   Selector.kt L49  `data class LiquidSegmentOption(id, label, badge = 0, favorite = false)` → `LiquidSegmentOption`
 *   Selector.kt L53-157 `LiquidSegmentedSelector(options, selected, onSelect, modifier, height = 48.dp, fontSp = 12f)`
 *     L61-64  `options.isEmpty()` 早退 / `!enhancedMotion` → `OrdinarySegmentedSelector`
 *     L72     `options.map { it.copy(label = tr(it.label)) }`（词表白名单）
 *     L73     `if (rtl) reversed()`
 *     L88-96  按下 → `setDropPressed(true)`，抬手/取消 → `false`
 *     L97-116 横向拖拽：`speed = speed*.6 + amount*1000/dt*.4`，结束取 `endDrag()` 的 id 回调
 *     L128-155 透明文字层：`selectable(role = RadioButton)` + 方向键/Home/End 移动 + `badge > 0` 时 stateDescription
 *   View.kt L21-50     `LiquidSegmentView : View` 的字段（physics / 三张 bitmap / active / released …）
 *   View.kt L57-86     `configure(items, selected, base, accent, ink, secondary, isDark, textSp, reduced, enabled, opticalEffects)`
 *   View.kt L100-170   `rebuildTextures()`：底色 + 上沿内阴影 + 分隔线 + 下沿高光；文字层（label/♥/badge 自动缩排）
 *   View.kt L172-178   `drawHeart()` 的贝塞尔爱心
 *   View.kt L195-217   `drawFallback()`：轨道 → 未选中文字 → 液滴水滴（玻璃渐变 + 1px 白描边）→ 裁进液滴的选中文字
 *   View.kt L219-286   `beginDrag/dragBy/endDrag/setActive/requestFrame/frame/stopFrames/release`
 *   View.kt L288-331   `Optics`：`RuntimeShader(LIQUID_SEGMENT_SHADER)` 的 WebGL2 等价物
 *
 * 平台差异（已登记 E119）
 * ─────────────────────
 *  * AGSL `RuntimeShader` → WebGL2 程序（着色器见 `src/core/glass/liquidSegmentShader.ts`）。
 *    WebGL2 不可用（WKWebView 低电量 / 上下文耗尽）时走 `drawFallback`，与 Kotlin 的
 *    `Build.VERSION.SDK_INT < 33 || !canvas.isHardwareAccelerated` 分支同一语义：**不静默丢功能**。
 *  * `setLayerType(LAYER_TYPE_HARDWARE)` 的「静止时缓存一层」在 Web 侧对应 `css contain: paint`，
 *    这里不挂常驻合成层（`docs/HANDOFF_PROMPT.md` §4 第 3 条的 renderer 崩溃教训）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { enhancedMotion, decorativeEffects } from '@core/glass/renderQuality';
import { LiquidSegmentPhysics } from '@core/glass/liquidSegmentPhysics';
import { LIQUID_SEGMENT_SHADER } from '@core/glass/liquidSegmentShader';
import { tr } from '@core/i18n/locale';
import { useRenderQuality } from './GlassQuality';
import { useMotion } from './feedback/Motion';
import { OrdinarySegmentedSelector } from './OrdinaryControls';
import '../../styles/liquidSegment.css';

/** Selector.kt L49。 */
export interface LiquidSegmentOption {
  readonly id: number;
  readonly label: string;
  readonly badge?: number;
  readonly favorite?: boolean;
}

/** View.kt L172-178 的爱心路径（单位与 Kotlin 的 14×14 网格一致）。 */
function heartPath(ctx: CanvasRenderingContext2D, x: number, cy: number, scale: number): void {
  ctx.save();
  ctx.translate(x, cy - 7 * scale);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(7, 13);
  ctx.bezierCurveTo(5, 11, 0, 7, 0, 4);
  ctx.bezierCurveTo(0, -1, 5, -1, 7, 3);
  ctx.bezierCurveTo(9, -1, 14, -1, 14, 4);
  ctx.bezierCurveTo(14, 7, 9, 11, 7, 13);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** View.kt L288-331 `Optics` 的 WebGL2 实现。 */
class Optics {
  private program: WebGLProgram | null = null;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private trackTex: WebGLTexture | null = null;
  private labelTex: WebGLTexture | null = null;
  private lastSelection: boolean | null = null;
  private lastWidth = Number.NaN;
  private lastHeight = Number.NaN;
  private lastDensity = Number.NaN;
  private lastSlot = Number.NaN;
  private lastPalette: string | null = null;
  private lastDark: boolean | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (vs === null || fs === null) return;
    gl.shaderSource(
      vs,
      `#version 300 es
       in vec2 aPos;
       void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
    );
    gl.shaderSource(fs, LIQUID_SEGMENT_SHADER);
    gl.compileShader(vs);
    gl.compileShader(fs);
    const program = gl.createProgram();
    if (program === null) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    this.program = program;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.trackTex = gl.createTexture();
    this.labelTex = gl.createTexture();
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.program === null ? null : this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  private upload(texture: WebGLTexture | null, source: HTMLCanvasElement | null, unit: number): void {
    const gl = this.gl;
    if (texture === null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source !== null) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform1i(this.uniform('uTrack'), 0);
    gl.uniform1i(this.uniform('uLabels'), 1);
  }

  /** View.kt L300-303 `bind(track, glyphs)`。 */
  bind(track: HTMLCanvasElement, glyphs: HTMLCanvasElement, width: number, height: number): void {
    const gl = this.gl;
    this.upload(this.trackTex, track, 0);
    this.upload(this.labelTex, glyphs, 1);
    gl.uniform2f(this.uniform('uInvPx'), 1 / Math.max(width, 1), 1 / Math.max(height, 1));
  }

  /** View.kt L304-329 `draw(canvas, physics, density, accent, ink, secondary, dark, selected)`。 */
  draw(
    physics: LiquidSegmentPhysics,
    density: number,
    accent: readonly [number, number, number],
    ink: readonly [number, number, number],
    secondary: readonly [number, number, number],
    dark: boolean,
    selected: boolean,
    viewport: { width: number; height: number },
  ): void {
    const gl = this.gl;
    if (this.program === null) return;
    gl.useProgram(this.program);
    gl.viewport(0, 0, viewport.width, viewport.height);
    if (this.lastSelection !== selected) {
      gl.uniform1f(this.uniform('selectionActive'), selected ? 1 : 0);
      this.lastSelection = selected;
    }
    if (this.lastWidth !== physics.width || this.lastHeight !== physics.height) {
      gl.uniform2f(this.uniform('resolution'), physics.width, physics.height);
      this.lastWidth = physics.width;
      this.lastHeight = physics.height;
    }
    if (this.lastDensity !== density) {
      gl.uniform1f(this.uniform('density'), density);
      this.lastDensity = density;
    }
    if (this.lastSlot !== physics.slotWidth) {
      gl.uniform1f(this.uniform('slotWidth'), physics.slotWidth);
      this.lastSlot = physics.slotWidth;
    }
    gl.uniform1f(this.uniform('leftEdge'), physics.left.x);
    gl.uniform1f(this.uniform('rightEdge'), physics.right.x);
    gl.uniform1f(this.uniform('velocity'), physics.velocity);
    gl.uniform1f(this.uniform('wobble'), physics.wobble.x);
    gl.uniform1f(this.uniform('press'), physics.press.x);
    const paletteKey = `${String(accent.join(','))}|${String(ink.join(','))}|${String(secondary.join(','))}`;
    if (this.lastPalette !== paletteKey) {
      gl.uniform3f(this.uniform('accent'), accent[0] / 255, accent[1] / 255, accent[2] / 255);
      gl.uniform3f(this.uniform('ink'), ink[0] / 255, ink[1] / 255, ink[2] / 255);
      gl.uniform3f(
        this.uniform('glow'),
        (accent[0] * 0.75 + secondary[0] * 0.25) / 255,
        (accent[1] * 0.75 + secondary[1] * 0.25) / 255,
        (accent[2] * 0.75 + secondary[2] * 0.25) / 255,
      );
      this.lastPalette = paletteKey;
    }
    if (this.lastDark !== dark) {
      gl.uniform1f(this.uniform('lip'), dark ? 0.14 : 0.8);
      this.lastDark = dark;
    }
    physics.satellites.forEach((q, i) => {
      gl.uniform3f(this.uniform(`satellite${String(i)}`), q.x, q.y, q.r);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.trackTex !== null) gl.deleteTexture(this.trackTex);
    if (this.labelTex !== null) gl.deleteTexture(this.labelTex);
    if (this.program !== null) gl.deleteProgram(this.program);
    this.program = null;
  }
}

function readRgb(hex: string): readonly [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** View.kt L21-332 `LiquidSegmentView` 的 Web 版（一个 canvas 节点 + 一个物理实例）。 */
export class LiquidSegmentView {
  readonly physics = new LiquidSegmentPhysics();
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly gl: WebGL2RenderingContext | null;
  private optics: Optics | null = null;
  private trackCanvas: HTMLCanvasElement | null = null;
  private glyphCanvas: HTMLCanvasElement | null = null;
  private options: readonly LiquidSegmentOption[] = [];
  private selectedId = 0;
  private baseColor = '#ffffff';
  private accentColor = '#059669';
  private inkColor = '#808080';
  private secondaryColor = '#808080';
  private dark = false;
  private fontSp = 12;
  private scale = 1;
  private fontScale = 1;
  private active = true;
  private released = false;
  private reduceMotion = false;
  private useOptics = true;
  private pendingFrame = false;
  private previousFrame = 0;
  private rafId = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.gl = canvas.getContext('webgl2');
    if (this.gl !== null) this.optics = new Optics(this.gl);
  }

  private get width(): number {
    return this.canvas.width;
  }

  private get height(): number {
    return this.canvas.height;
  }

  /** View.kt L57-86 `configure(...)`。 */
  configure(
    items: readonly LiquidSegmentOption[],
    selected: number,
    base: string,
    accent: string,
    ink: string,
    secondary: string,
    isDark: boolean,
    textSp: number,
    reduced: boolean,
    enabled: boolean,
    opticalEffects: boolean,
    density = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    fontScale = 1,
  ): void {
    const textureChanged =
      this.options !== items ||
      this.baseColor !== base ||
      this.dark !== isDark ||
      this.fontSp !== textSp ||
      this.scale !== density ||
      this.fontScale !== fontScale ||
      this.useOptics !== opticalEffects;
    const previousCount = this.options.length;
    this.options = items;
    this.baseColor = base;
    this.accentColor = accent;
    this.inkColor = ink;
    this.secondaryColor = secondary;
    this.dark = isDark;
    this.fontSp = textSp;
    this.scale = density;
    this.fontScale = fontScale;
    this.useOptics = opticalEffects;
    const countChanged = previousCount !== items.length;
    const reductionChanged = this.reduceMotion !== reduced;
    this.reduceMotion = reduced;
    if (countChanged || this.physics.count === 0) this.resizePhysics(selected);
    if (textureChanged) this.rebuildTextures();
    if (selected !== this.selectedId || countChanged) {
      this.selectedId = selected;
      if (!this.physics.dragging) this.physics.select(this.indexOf(selected), this.reduceMotion || !this.active);
      this.requestFrame();
    }
    if (reductionChanged && this.reduceMotion) {
      this.physics.settle();
      this.stopFrames();
    }
    this.setActive(enabled);
    this.drawFrame();
  }

  private indexOf(id: number): number {
    const index = this.options.findIndex((o) => o.id === id);
    return index < 0 ? 0 : index;
  }

  private resizePhysics(selected: number = this.selectedId): void {
    if (this.width <= 0 || this.height <= 0) return;
    this.physics.resize(this.width / this.scale, this.height / this.scale, this.options.length, this.indexOf(selected));
  }

  /** View.kt L100-170 `rebuildTextures()`。 */
  private rebuildTextures(): void {
    if (this.width <= 0 || this.height <= 0 || this.options.length === 0 || this.released) return;
    const w = this.width;
    const h = this.height;
    const scale = this.scale;
    if (this.trackCanvas === null || this.trackCanvas.width !== w || this.trackCanvas.height !== h) {
      this.trackCanvas = document.createElement('canvas');
      this.trackCanvas.width = w;
      this.trackCanvas.height = h;
      this.glyphCanvas = document.createElement('canvas');
      this.glyphCanvas.width = w;
      this.glyphCanvas.height = h;
    }
    const track = this.trackCanvas.getContext('2d');
    const glyphs = this.glyphCanvas?.getContext('2d') ?? null;
    if (track === null) return;
    track.clearRect(0, 0, w, h);
    track.save();
    // L113-116 轨道底色 + 竖向渐变
    const baseGradient = track.createLinearGradient(0, 0, 0, h);
    baseGradient.addColorStop(0, this.dark ? 'rgba(0,0,0,0.34)' : 'rgba(130,90,80,0.17)');
    baseGradient.addColorStop(1, this.dark ? 'rgba(255,255,255,0.05)' : 'rgba(130,90,80,0.07)');
    track.fillStyle = this.baseColor;
    track.fillRect(0, 0, w, h);
    track.fillStyle = baseGradient;
    track.beginPath();
    track.roundRect(0, 0, w, h, h / 2);
    track.fill();
    // L118-121 上沿内阴影
    track.save();
    track.beginPath();
    track.roundRect(0, 0, w, h, h / 2);
    track.clip();
    const inset = track.createLinearGradient(0, 0, 0, 8 * scale);
    inset.addColorStop(0, this.dark ? 'rgba(0,0,0,0.40)' : 'rgba(112,35,25,0.22)');
    inset.addColorStop(1, 'rgba(0,0,0,0)');
    track.fillStyle = inset;
    track.fillRect(0, 0, w, 8 * scale);
    // L122-126 分隔线
    track.fillStyle = this.dark ? 'rgba(255,255,255,0.10)' : 'rgba(110,70,60,0.16)';
    for (let i = 1; i < this.options.length; i += 1) {
      const x = (4 + this.physics.slotWidth * i) * scale;
      track.fillRect(x - 0.5 * scale, h * 0.32, scale, h * 0.36);
    }
    // L127-130 下沿高光
    const rim = track.createLinearGradient(0, h * 0.45, 0, h);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, this.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.80)');
    track.strokeStyle = rim;
    track.lineWidth = scale;
    track.beginPath();
    track.roundRect(0.5 * scale, 0.5 * scale, w - scale, h - scale, h / 2);
    track.stroke();
    track.restore();
    track.restore();

    if (glyphs === null) return;
    glyphs.clearRect(0, 0, w, h);
    glyphs.fillStyle = '#ffffff';
    glyphs.textBaseline = 'alphabetic';
    this.options.forEach((option, i) => {
      const fontSize = this.fontSp * this.fontScale * scale;
      glyphs.font = `700 ${String(fontSize)}px -apple-system, "PingFang SC", "Noto Sans SC", sans-serif`;
      const badge = (option.badge ?? 0) > 0 ? String(option.badge) : '';
      const iconWidth = option.favorite === true ? 18 * scale : 0;
      const gap = badge === '' ? 0 : 5 * scale;
      let badgeWidth = 0;
      if (badge !== '') {
        glyphs.font = `700 ${String(10 * this.fontScale * scale)}px -apple-system, "PingFang SC", sans-serif`;
        badgeWidth = glyphs.measureText(badge).width;
      }
      glyphs.font = `700 ${String(fontSize)}px -apple-system, "PingFang SC", "Noto Sans SC", sans-serif`;
      const available = Math.max(this.physics.slotWidth - 10, 1) * scale;
      const labelWidth = glyphs.measureText(tr(option.label)).width;
      const fit = Math.min(available / Math.max(labelWidth + iconWidth + gap + badgeWidth, 1), 1);
      const cx = (4 + this.physics.slotWidth * (i + 0.5)) * scale;
      glyphs.save();
      glyphs.translate(cx, h / 2);
      glyphs.scale(fit, fit);
      let x = -(labelWidth + iconWidth + gap + badgeWidth) / 2;
      if (option.favorite === true) {
        heartPath(glyphs, x, 0, scale);
        x += iconWidth;
      }
      glyphs.textBaseline = 'middle';
      glyphs.fillText(tr(option.label), x, 0);
      if (badge !== '') {
        glyphs.font = `700 ${String(10 * this.fontScale * scale)}px -apple-system, "PingFang SC", sans-serif`;
        glyphs.fillText(badge, x + labelWidth + gap, 0);
      }
      glyphs.restore();
    });

    if (this.useOptics && this.optics !== null && this.glyphCanvas !== null) {
      this.optics.bind(this.trackCanvas, this.glyphCanvas, w, h);
    } else {
      this.optics = null;
    }
  }

  /** View.kt L180-193 `onDraw`：优先 GL，失败退回 2D。 */
  drawFrame(): void {
    if (this.options.length === 0 || this.ctx === null) return;
    const hasSelection = this.physics.dragging || this.options.some((o) => o.id === this.selectedId);
    if (this.optics !== null && this.gl !== null) {
      try {
        this.optics.draw(
          this.physics,
          this.scale,
          readRgb(this.accentColor),
          readRgb(this.inkColor),
          readRgb(this.secondaryColor),
          this.dark,
          hasSelection,
          { width: this.width, height: this.height },
        );
        return;
      } catch {
        // 驱动不兼容：保留可用的原生玻璃控件（与 Kotlin `catch { optics = null }` 同义）。
        this.optics = null;
      }
    }
    this.drawFallback(hasSelection);
  }

  /** View.kt L195-217 `drawFallback()`。 */
  private drawFallback(hasSelection: boolean): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const h = this.height;
    const scale = this.scale;
    ctx.clearRect(0, 0, this.width, h);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, this.width, h, h / 2);
    ctx.clip();
    if (this.trackCanvas !== null) ctx.drawImage(this.trackCanvas, 0, 0);
    if (!hasSelection) {
      if (this.glyphCanvas !== null) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(this.glyphCanvas, 0, 0);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    const l = this.physics.left.x * scale;
    const r = this.physics.right.x * scale;
    const glass = ctx.createLinearGradient(l, 4 * scale, r, h - 4 * scale);
    glass.addColorStop(0, 'rgba(255,255,255,0.40)');
    glass.addColorStop(0.5, this.dark ? 'rgba(0,0,0,0.19)' : 'rgba(0,0,0,0.06)');
    glass.addColorStop(1, 'rgba(255,255,255,0.13)');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.roundRect(l, 4 * scale, r - l, h - 8 * scale, h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.53)';
    ctx.lineWidth = scale;
    ctx.stroke();
    if (this.glyphCanvas !== null) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(this.glyphCanvas, 0, 0);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(l, 0, r - l, h);
      ctx.clip();
      ctx.drawImage(this.glyphCanvas, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /** View.kt L219-233。 */
  beginDrag(): void {
    if (this.released) return;
    this.physics.beginDrag();
    this.requestFrame();
  }

  setDropPressed(value: boolean): void {
    this.physics.press.target = value && !this.reduceMotion ? 1 : 0;
    this.requestFrame();
  }

  dragBy(px: number, velocityPx: number): void {
    this.physics.dragBy(px / this.scale, velocityPx / this.scale, this.reduceMotion);
    this.drawFrame();
    this.requestFrame();
  }

  endDrag(cancelled: boolean): number {
    const index = cancelled ? this.indexOf(this.selectedId) : this.physics.index;
    this.physics.endDrag(index, this.reduceMotion);
    this.requestFrame();
    return this.options[index]?.id ?? this.selectedId;
  }

  /** View.kt L234-242。 */
  setActive(value: boolean): void {
    if (this.active === value) return;
    this.active = value;
    if (!value) {
      this.physics.endDrag(this.indexOf(this.selectedId), true);
      this.stopFrames();
    }
  }

  /** View.kt L243-264。 */
  private requestFrame(): void {
    if (this.released || !this.active || this.reduceMotion || this.pendingFrame) return;
    this.pendingFrame = true;
    this.previousFrame = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.pendingFrame = false;
    if (this.released || !this.active) {
      this.physics.endDrag(this.indexOf(this.selectedId), true);
      return;
    }
    const now = performance.now();
    const dt = this.previousFrame === 0 ? 1 / 60 : (now - this.previousFrame) / 1000;
    this.previousFrame = now;
    const moving = this.physics.step(dt);
    this.drawFrame();
    if (moving) {
      this.pendingFrame = true;
      this.rafId = requestAnimationFrame(this.frame);
    }
  };

  private stopFrames(): void {
    cancelAnimationFrame(this.rafId);
    this.pendingFrame = false;
    this.previousFrame = 0;
  }

  /** View.kt L283-286。 */
  release(): void {
    this.released = true;
    this.stopFrames();
    this.optics?.dispose();
    this.optics = null;
    this.trackCanvas = null;
    this.glyphCanvas = null;
  }
}

export interface LiquidSegmentedSelectorProps {
  readonly options: readonly LiquidSegmentOption[];
  readonly selected: number;
  readonly onSelect: (id: number) => void;
  /** L58 `height: Dp = 48.dp`（px）。 */
  readonly height?: number;
  /** L59 `fontSp: Float = 12f`。 */
  readonly fontSp?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Selector.kt L52-157 `LiquidSegmentedSelector`。 */
export function LiquidSegmentedSelector(props: LiquidSegmentedSelectorProps) {
  const quality = useRenderQuality();
  const { reduceMotion } = useMotion();
  const [dark, setDark] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<LiquidSegmentView | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(props.selected);
  const selectRef = useRef(props.onSelect);
  // 拖动结束的回调要读到「最新」的选中值/回调；渲染期写 ref 会被 react-hooks/refs 判为非法，
  useEffect(() => {
    selectedRef.current = props.selected;
    selectRef.current = props.onSelect;
  }, [props.selected, props.onSelect]);

  const height = props.height ?? 48;
  const fontSp = props.fontSp ?? 12;

  const translated = useMemo(
    () => props.options.map((o) => ({ ...o, label: tr(o.label) })),
    [props.options],
  );

  useEffect(() => {
    const read = (): void => setDark(document.documentElement.getAttribute('data-theme') === 'dark');
    read();
    if (typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const applySize = useCallback((): void => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const view = viewRef.current;
    if (canvas === null || host === null || view === null) return;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const rect = host.getBoundingClientRect();
    const w = Math.max(Math.round(rect.width * dpr), 1);
    const h = Math.max(Math.round(rect.height * dpr), 1);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const view = new LiquidSegmentView(canvas);
    viewRef.current = view;
    applySize();
    return () => {
      view.release();
      viewRef.current = null;
    };
  }, [applySize]);

  useEffect(() => {
    applySize();
    const view = viewRef.current;
    if (view === null) return;
    const styles = getComputedStyle(document.documentElement);
    const base = styles.getPropertyValue('--color-surface').trim() || '#ffffff';
    const accent = styles.getPropertyValue('--color-primary').trim() || '#059669';
    const ink = styles.getPropertyValue('--color-on-light').trim() || '#18191c';
    const secondary = styles.getPropertyValue('--color-secondary').trim() || '#10b981';
    const muted = styles.getPropertyValue('--color-medium-gray').trim() || '#61666d';
    view.configure(
      translated,
      props.selected,
      base,
      accent,
      ink,
      secondary,
      dark,
      fontSp,
      reduceMotion,
      true,
      decorativeEffects(quality),
      typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      1,
    );
    void muted;
  }, [applySize, translated, props.selected, dark, fontSp, reduceMotion, quality]);

  if (props.options.length === 0) return null;
  if (!enhancedMotion(quality)) {
    return (
      <OrdinarySegmentedSelector
        options={props.options}
        selected={props.selected}
        onSelect={props.onSelect}
        height={height}
        fontSp={fontSp}
        {...(props.className === undefined ? null : { className: props.className })}
        {...(props.style === undefined ? null : { style: props.style })}
      />
    );
  }

  const surface = (): LiquidSegmentView | null => viewRef.current;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    surface()?.setDropPressed(true);
  };
  const onPointerUp = (): void => {
    surface()?.setDropPressed(false);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const view = surface();
    if (view === null || event.buttons === 0) return;
    view.dragBy(event.movementX, event.movementX * 60);
  };
  const onPointerDownCapture = (): void => {
    surface()?.beginDrag();
  };
  const finishDrag = (cancelled: boolean): void => {
    const view = surface();
    if (view === null) return;
    const id = view.endDrag(cancelled);
    if (!cancelled && id !== selectedRef.current) selectRef.current(id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
    const last = translated.length - 1;
    const delta =
      event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowLeft' ? -1
      : event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowUp' ? -1
      : event.key === 'Home' ? -translated.length
      : event.key === 'End' ? translated.length
      : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.min(Math.max(index + delta, 0), last);
    const option = translated[next];
    if (option !== undefined && option.id !== selectedRef.current) selectRef.current(option.id);
    const host = hostRef.current;
    const target = host?.querySelectorAll('[data-liquid-segment]')[next];
    if (target instanceof HTMLElement) target.focus();
  };

  return (
    <div
      ref={hostRef}
      className={['liquid-segment', props.className].filter(Boolean).join(' ')}
      style={{ height: `${String(height)}px`, ...props.style }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerUp={() => {
        onPointerUp();
        finishDrag(false);
      }}
      onPointerCancel={() => {
        onPointerUp();
        finishDrag(true);
      }}
      onPointerMove={onPointerMove}
      role="radiogroup"
    >
      <canvas ref={canvasRef} className="liquid-segment__canvas" aria-hidden />
      <div className="liquid-segment__labels">
        {translated.map((option, index) => (
          <button
            key={option.id}
            type="button"
            data-liquid-segment=""
            className="liquid-segment__label"
            role="radio"
            aria-checked={props.selected === option.id}
            {...((option.badge ?? 0) > 0 ? { 'aria-description': `${String(option.badge ?? 0)} 项` } : null)}
            style={{ fontSize: `${String(fontSp)}px` }}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => {
              if (option.id !== selectedRef.current) props.onSelect(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
