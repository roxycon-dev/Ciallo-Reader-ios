/**
 * E8 —— AGSL 自定义着色器的 WebGL2 等价实现。
 *
 * 权威行为来自 Kotlin `ui/components/GlassCard.kt:146-187` 的 `DENT_LIGHT_AGSL`
 * （只读参考，不修改）。该着色器实现「任务书『光源固定修正』」：
 *
 *   > 明暗 = 固定光源 × 倾斜后表面法线（整卡）＋ 坑壁法线扰动（局部），
 *   > 纯数学、无分支无循环；CPU 每帧只传原始角度弧度，不重复算法线。
 *   > 卡片不倾斜、坑外区域明暗退化为 <1% 常量底噪。
 *   > 对称性由公式自带：左右按压的明暗镜像对称，无需方向特判。
 *
 * ## AGSL → GLSL 的映射
 *
 * AGSL（Skia Shading Language）是 GLSL ES 的子集，但**输入取自上游图层**
 * （`inputShader.eval(coord)`），而 WebGL 无此机制。等价做法：
 * 把卡片先渲染到一张纹理（`u_base`），再由片元着色器逐像素采样 —— 语义相同。
 *
 * | AGSL | GLSL ES 3.0 |
 * |---|---|
 * | `uniform shader inputShader` + `inputShader.eval(coord)` | `uniform sampler2D u_base` + `texture(u_base, uv)` |
 * | `uniform float2` | `uniform vec2` |
 * | `half4 main(float2 coord)` | 片元着色器 `main()`，`coord` = `gl_FragCoord.xy` |
 * | `step(1.0, t)` | `step(1.0, t)`（完全一致） |
 * | `float4(float3, float)` 构造 | `vec4(vec3, float)` |
 * | 无分支（靠 `step` / `max`） | 同 —— 本移植**严格保持无分支无循环** |
 *
 * ## 为什么不直接用 CSS
 *
 * 「固定光源 × 倾斜法线」的逐像素计算需要拿到**每个像素的表面法线**，
 * 而 CSS 只能做 2D 渐变 / 3D transform，无法在着色阶段按像素重算光照。
 * 文档里 Kotlin 侧也明确写「不倾斜、坑外区域明暗退化为 <1% 常量底噪」——
 * 也就是说这个效果**本来就是逐像素的**，CSS 近似只能退化成常量。
 */

import type { RectF } from '@core/mangatranslate';

/**
 * GLSL 片元着色器 —— 与 `GlassCard.kt:156-185` 的 `main` 逐句对应。
 *
 * 保留原始注释里的编号（①②③④）以便逐句对拍。
 */
const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_base;        // ≡ AGSL 的 inputShader.eval(coord)
uniform vec2  u_pressCenter;
uniform float u_pressRadius;
uniform float u_pressIntensity;
uniform float u_cardRotationX;   // 弧度（CPU 已换算，见 UNIFORM_DEGREES_NOTE）
uniform float u_cardRotationY;
uniform vec2  u_lightDir;
uniform float u_ambientStrength;

out vec4 outColor;

void main() {
    // 帧缓冲 y 向上、AGSL 的 coord y 向下 → 这里用 1-v_uv 反转，
    // 使 pressCenter / 压痕方向与 Android 完全一致。
    vec2 coord = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    vec4 base = texture(u_base, v_uv);

    // ① 整卡倾斜后的表面法线：Z 轴单位法线绕 X / Y 旋转（小角模型）。
    //    符号与 Compose 旋转矩阵严格对齐：rotationX>0 = 顶缘向屏幕里倒 → 法线向屏幕上方
    //    （−y）偏，故 X 分量取负 sin；rotationY>0 = 右缘向里倒 → 法线 +x，取正 sin
    vec3 tiltNormal = normalize(vec3(
        sin(u_cardRotationY),
        -sin(u_cardRotationX),
        cos(u_cardRotationX) * cos(u_cardRotationY)
    ));

    // ② 压痕局部法线扰动：径向距离 t，坑壁斜率 sin(t·π)×intensity×0.6；
    //    step 做坑外裁剪，保持无分支
    vec2 rel = (coord - u_pressCenter) / max(u_pressRadius, 1.0);
    float t = length(rel);
    float inside = 1.0 - step(1.0, t);
    float wall = sin(t * 3.14159265) * u_pressIntensity * 0.6 * inside;
    vec2 radialDir = rel / max(t, 0.0001);
    vec3 surfaceNormal = normalize(tiltNormal + vec3(radialDir * wall, 0.0));

    // ③ Lambert：固定光源 × 表面法线
    vec3 L = normalize(vec3(u_lightDir.x, u_lightDir.y, 0.7));
    float lighting = max(dot(surfaceNormal, L), 0.0);

    // ④ 明暗合成（任务书系数）：全局倾斜 ×0.08、局部坑壁 ×0.6，环境光底压缩抬底
    float shade = 1.0 - lighting;
    float darken = clamp(shade * 0.08 + max(1.0 - t, 0.0) * shade * 0.6, 0.0, 0.35);
    float lit = 1.0 - darken * (1.0 - u_ambientStrength);
    outColor = vec4(base.rgb * lit, base.a);
}
`;

const VERTEX_SRC = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  // 全屏三角形：顶点 (-1,-1) (3,-1) (-1,3)
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = (p + 1.0) * 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

/**
 * 角度单位说明。
 *
 * AGSL 的 `sin()` 直接吃弧度；Compose 侧传进来的是**度**（`cardRotationX` 等
 * 字段名暗示），转换发生在 Kotlin 调用点。Web 侧统一在 `setRotationDegrees`
 * 里换算成弧度，与 Kotlin 的换算时机一致。
 */
const DEG_TO_RAD = Math.PI / 180;

export interface DentLightUniforms {
  /** 压痕中心（卡片坐标系 px，与 AGSL 的 `coord` 同一坐标系）。 */
  readonly pressCenterX: number;
  readonly pressCenterY: number;
  /** 压痕半径 px。 */
  readonly pressRadius: number;
  /** 按压强度 0..1。 */
  readonly pressIntensity: number;
  /** 卡片绕 X 轴旋转角（度）。 */
  readonly rotationXDeg: number;
  /** 卡片绕 Y 轴旋转角（度）。 */
  readonly rotationYDeg: number;
  /** 固定光源方向。 */
  readonly lightDirX: number;
  readonly lightDirY: number;
  /** 环境光强度 0..1（越大压暗越弱）。 */
  readonly ambientStrength: number;
}

/** Kotlin 侧 `ambientStrength` 的默认值（压缩抬底用）。 */
export const DEFAULT_AMBIENT_STRENGTH = 0.35;

/**
 * `DENT_LIGHT_AGSL` 的 WebGL2 运行时。
 *
 * 用法（与 Kotlin 的 `RenderEffect.createRuntimeShaderEffect` 等价）：
 *   1. 把卡片本身画进 `baseTexture`（可以是任意 canvas / ImageBitmap）；
 *   2. 调用 `render(quadTarget)`，它把 `baseTexture` 逐像素乘上明暗后画到目标。
 *
 * 为保持「CPU 每帧只传原始角度弧度，不重复算法线」的契约，`setUniforms` 只存值，
 * 真正的法线计算在 `render` 时的 GPU 上完成。
 */
export class DentLightRenderer {
  private readonly gl: WebGL2RenderingContext;

  private readonly program: WebGLProgram | null;

  private readonly vao: WebGLVertexArrayObject | null;

  private readonly baseTexture: WebGLTexture | null;

  private readonly framebuffer: WebGLFramebuffer | null;

  private u: {
    readonly base: WebGLUniformLocation | null;
    readonly pressCenter: WebGLUniformLocation | null;
    readonly pressRadius: WebGLUniformLocation | null;
    readonly pressIntensity: WebGLUniformLocation | null;
    readonly rotX: WebGLUniformLocation | null;
    readonly rotY: WebGLUniformLocation | null;
    readonly lightDir: WebGLUniformLocation | null;
    readonly ambient: WebGLUniformLocation | null;
    readonly resolution: WebGLUniformLocation | null;
  };

  private uniforms: DentLightUniforms = {
    pressCenterX: 0,
    pressCenterY: 0,
    pressRadius: 1,
    pressIntensity: 0,
    rotationXDeg: 0,
    rotationYDeg: 0,
    lightDirX: -0.4,
    lightDirY: 0.6,
    ambientStrength: DEFAULT_AMBIENT_STRENGTH,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
    if (gl === null) {
      throw new Error(
        '玻璃卡凹陷光照需要 WebGL2（等价于 Android 的 AGSL RuntimeShader）：当前环境不支持。',
      );
    }
    this.gl = gl;
    this.program = this.buildProgram(gl);
    const vao = gl.createVertexArray();
    if (vao === null) throw new Error('无法创建 VAO');
    this.vao = vao;
    const tex = gl.createTexture();
    if (tex === null) throw new Error('无法创建纹理');
    this.baseTexture = tex;
    const fbo = gl.createFramebuffer();
    if (fbo === null) throw new Error('无法创建 FBO');
    this.framebuffer = fbo;

    // `buildProgram` 要么返回 program、要么抛错，故此处 program 必非 null。
    const program = this.program as WebGLProgram;
    const loc = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    this.u = {
      base: loc('u_base'),
      pressCenter: loc('u_pressCenter'),
      pressRadius: loc('u_pressRadius'),
      pressIntensity: loc('u_pressIntensity'),
      rotX: loc('u_cardRotationX'),
      rotY: loc('u_cardRotationY'),
      lightDir: loc('u_lightDir'),
      ambient: loc('u_ambientStrength'),
      resolution: loc('u_resolution'),
    };
  }

  private buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type);
      if (sh === null) throw new Error('无法创建 shader');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) ?? '(无日志)';
        gl.deleteShader(sh);
        throw new Error(`凹陷光照着色器编译失败：${log}`);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    if (program === null) throw new Error('无法创建 program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '(无日志)';
      gl.deleteProgram(program);
      throw new Error(`凹陷光照程序链接失败：${log}`);
    }
    return program;
  }

  /** 只更新 uniform 值 —— 对应 Kotlin「按压期间仅更新 uniform」。 */
  setUniforms(next: Partial<DentLightUniforms>): void {
    this.uniforms = { ...this.uniforms, ...next };
  }

  /** 当前 uniform 的只读快照（测试用）。 */
  getUniforms(): Readonly<DentLightUniforms> {
    return this.uniforms;
  }

  /**
   * 把 `source` 的每个像素乘上明暗，画到 `targetRect`。
   *
   * @param source 卡片本身（HTMLCanvasElement / ImageBitmap / HTMLImageElement ——
   *   与 WebGL 的  一致；SVG 元素不能直接上传纹理）
   * @param targetRect 目标位置（CSS px，原点左上 —— 与 AGSL 的 coord 一致）
   */
  render(source: TexImageSource, targetRect: RectF): void {
    const gl = this.gl;
    const program = this.program;
    const vao = this.vao;
    const tex = this.baseTexture;
    const fbo = this.framebuffer;
    if (program === null || vao === null || tex === null || fbo === null) return;

    // ── 1. 把卡片渲染进 baseTexture ──
    const w = Math.max(1, Math.round(targetRect.right - targetRect.left));
    const h = Math.max(1, Math.round(targetRect.bottom - targetRect.top));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // ── 2. 全屏三角形 + 明暗片元着色器 ──
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u.base, 0);
    gl.uniform2f(this.u.resolution, w, h);
    gl.uniform2f(this.u.pressCenter, this.uniforms.pressCenterX, this.uniforms.pressCenterY);
    gl.uniform1f(this.u.pressRadius, Math.max(1, this.uniforms.pressRadius));
    gl.uniform1f(this.u.pressIntensity, this.uniforms.pressIntensity);
    // 度 → 弧度（与 Kotlin 调用点的换算时机一致）
    gl.uniform1f(this.u.rotX, this.uniforms.rotationXDeg * DEG_TO_RAD);
    gl.uniform1f(this.u.rotY, this.uniforms.rotationYDeg * DEG_TO_RAD);
    gl.uniform2f(this.u.lightDir, this.uniforms.lightDirX, this.uniforms.lightDirY);
    gl.uniform1f(this.u.ambient, this.uniforms.ambientStrength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.program !== null) gl.deleteProgram(this.program);
    if (this.baseTexture !== null) gl.deleteTexture(this.baseTexture);
    if (this.framebuffer !== null) gl.deleteFramebuffer(this.framebuffer);
    if (this.vao !== null) gl.deleteVertexArray(this.vao);
  }
}
