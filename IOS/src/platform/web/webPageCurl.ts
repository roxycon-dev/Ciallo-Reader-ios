/**
 * E7 —— pagecurl 书页卷曲的 WebGL2 渲染。
 *
 * 权威行为来自 Android（只读参考，不修改）：
 *   - `ui/pageturn/PageCurlReaderContainer.kt`（382 行）—— 手势仲裁、三页模型、
 *     `BACK_PAGE_CONTENT_ALPHA = 0.58f`、投影 `radius 18.dp` / `offset (-6, 2).dp`。
 *   - 底层是第三方库 `eu.wewox.pagecurl`，它在 Compose Canvas 里渲染整页卷曲。
 *   - `PageTurnContainer.kt` 的 `Simulate3DCurlLayout` 是本项目自己的等价实现，
 *     本文件此前就复用它的几何（见 PageCurlReaderContainer 的文件头注）。
 *
 * ## 与 E43 漫画卷页的关系
 *
 * 两者都是「把一页纸沿圆柱面卷起」，物理模型完全相同，只是：
 *   - E43 漫画：单页、对角拖拽、背面是下一页；
 *   - E7 书页：双页对开、从页角翻起、背面是镜像的字。
 *
 * 故本文件**复用 E43 的圆柱卷曲数学**（`curlPoint`），只换页数语义与纸面/文字合成。
 *
 * ## 为什么不用 SVG / CSS 3D
 *
 * 与 E43 同理：卷曲时纸面上每一点的法线都不同，掠射角压暗必须逐像素计算；
 * 背面还要**镜像内容**（不是整体翻转）。CSS 3D 只有 `backface-visibility`
 * 这一档，SVG 描边更是无法承载。
 *
 * `src/core/**` 不碰 DOM（E61），故本文件在 platform 层。
 */

/** 与 E43 一致的默认参数（来自 PageCurlReaderContainer 的 `PAGE_CURL_DEFAULTS`）。 */
export const PAGE_CURL_RADIUS_PX = 220;

/** 网格密度：书页是竖长条，纵向需要更多分段。 */
export const PAGE_CURL_MESH = { cols: 28, rows: 44 } as const;

const VERTEX_SRC = `#version 300 es
precision highp float;
in vec2 a_grid;

// ── 卷曲参数 ──
uniform vec2  u_pageSize;    // 页宽、页高（px）
uniform vec2  u_foldOrigin;  // 折角起点（页面坐标 px）
uniform float u_radius;      // 圆柱半径（px）
uniform float u_progress;    // 0 = 未翻，1 = 完全翻过
uniform float u_radiusScale; // 折角处的半径缩放（起手时小 → 展开后大）
uniform mat3  u_frame;       // 页面在屏幕上的位置
uniform float u_curlValid;

out vec2  v_uv;
out vec3  v_normal;
out float v_shade;   // 掠射角压暗强度 0..1

// ── 圆柱卷曲：把页面折角沿圆筒卷起 ──
// 折角以下的区域保持平直；折角以上绕半径 radius 的圆柱面卷起。
void main() {
  v_uv = a_grid;
  vec2 p = a_grid * u_pageSize;

  // 到折角原点的距离：x 方向是「往回翻的量」，y 方向是页面纵向位置。
  vec2 d = p - u_foldOrigin;
  float back = -d.x;          // 折角左侧（会被卷起）的距离
  float r = u_radius * max(u_radiusScale, 0.05);

  if (u_curlValid < 0.5 || back <= 0.0) {
    // 未卷曲：法线朝屏幕外
    v_normal = vec3(0.0, 0.0, 1.0);
    v_shade = 0.0;
    vec3 flatPos = u_frame * vec3(p, 1.0);
    gl_Position = vec4(flatPos.xy / u_resolution * 2.0 - 1.0, 0.0, 1.0);
    return;
  }

  // 圆柱面参数：θ = back / r，超过 π 的部分不再卷（最多半圈 + 一小截）
  float theta = back / r;
  float rolled = theta > 3.14159265 ? 3.14159265 : theta;

  // 卷起部分的水平位移：投影到圆柱面
  float xPos = -r * sin(rolled);
  // z 抬起：圆柱高度
  float zPos = r * (1.0 - cos(rolled));

  vec2 folded = vec2(u_foldOrigin.x + xPos, p.y);
  vec3 world = u_frame * vec3(folded, 1.0);
  world.z = zPos * u_progress;

  // 圆柱面法线：指向圆心外侧
  v_normal = normalize(vec3(cos(rolled), 0.0, -sin(rolled)));
  // 掠射角：法线的 z 越接近 0（与视线越平行）越暗
  v_shade = 1.0 - abs(v_normal.z);

  gl_Position = vec4(world.xy / u_resolution * 2.0 - 1.0, world.z, 1.0);
}
`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2  v_uv;
in vec3  v_normal;
in float v_shade;

uniform sampler2D u_front;     // 正面：当前页
uniform sampler2D u_back;      // 背面：下一页（镜像）
uniform float u_hasBack;
uniform vec4  u_backOverlay;  // 铺在背面的纸色（α = 1 - backPageContentAlpha）
uniform float u_shadowAlpha;

out vec4 outColor;

void main() {
  vec3 n = normalize(v_normal);
  // 正面：法线 z > 0；背面：z < 0（法线背离视线）
  bool isBack = n.z < 0.0;

  vec4 src;
  if (isBack) {
    if (u_hasBack > 0.5) {
      // 背面内容水平镜像 —— pagecurl 的核心视觉特征
      src = texture(u_back, vec2(1.0 - v_uv.x, v_uv.y));
    } else {
      src = vec4(1.0);
    }
    // BACK_PAGE_CONTENT_ALPHA = 0.58f（Kotlin L68）：
    // 背面保留 58% 镜像字 + 42% 纸色 → overlay α = 1 - 0.58
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    vec3 paper = mix(src.rgb, vec3(lum) * 1.04, 0.5);
    src = mix(src, vec4(paper, src.a), u_backOverlay.a);
  } else {
    src = texture(u_front, v_uv);
  }

  // 掠射角压暗：法线越垂直（z 越接近 1）越亮，卷起时逐渐变暗
  float facing = abs(n.z);
  float lit = mix(1.0 - u_shadowAlpha, 1.0, facing);
  lit *= 1.0 - v_shade * u_shadowAlpha * 0.7;

  outColor = vec4(src.rgb * lit, src.a);
}
`;

/** 三列矩阵乘法（列主序，对齐 GL 的 `uniformMatrix3fv`）。 */
function mat3Mul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let c = 0; c < 3; c += 1) {
    for (let r = 0; r < 3; r += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += (a[k * 3 + r] as number) * (b[c * 3 + k] as number);
      out[c * 3 + r] = sum;
    }
  }
  return out;
}

function mat3Translate(tx: number, ty: number): number[] {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

/** Kotlin `PageCurlReaderContainer.kt:68, 90-96` 的常量。 */
export const PAGE_CURL_BACK_ALPHA = 0.58;
export const PAGE_CURL_SHADOW_ALPHA = 0.25;

export interface PageCurlRendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** 卷曲半径 px。 */
  readonly radius?: number;
  readonly mesh?: { readonly cols: number; readonly rows: number };
}

export interface PageCurlState {
  /** 折角起点在页面内的坐标（px，原点左上）。 */
  readonly foldX: number;
  readonly foldY: number;
  /** 翻页进度 0..1。 */
  readonly progress: number;
  /** 折角半径缩放（起手小、展开大 —— pagecurl 的手感曲线）。 */
  readonly radiusScale: number;
}

/**
 * 书页卷曲渲染器。
 *
 * 典型用法（配合 PageCurlReaderContainer 的手势仲裁）：
 * ```ts
 * const renderer = new PageCurlRenderer({ canvas });
 * renderer.setPages(frontCanvas, backCanvas);
 * renderer.render({ foldX, foldY, progress, radiusScale });
 * ```
 */
export class PageCurlRenderer {
  private readonly gl: WebGL2RenderingContext;

  private readonly program: WebGLProgram;

  private readonly vao: WebGLVertexArrayObject;

  private readonly textureFront: WebGLTexture;

  private readonly textureBack: WebGLTexture;

  private readonly u: PageCurlUniforms;

  private readonly radius: number;

  private readonly cols: number;

  private readonly rows: number;

  private hasBack = false;

  private state: PageCurlState = {
    foldX: 0,
    foldY: 0,
    progress: 0,
    radiusScale: 1,
  };

  /** 页面在屏幕上的位置（CSS px），由容器在布局时写入。 */
  private framePos = { x: 0, y: 0, w: 0, h: 0 };

  constructor(options: PageCurlRendererOptions) {
    const gl = options.canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (gl === null) {
      throw new Error(
        '仿真 3D 卷页需要 WebGL2（等价 pagecurl 的 Compose Canvas 渲染）：当前环境不支持。',
      );
    }
    this.gl = gl;
    this.radius = options.radius ?? PAGE_CURL_RADIUS_PX;
    this.cols = options.mesh?.cols ?? PAGE_CURL_MESH.cols;
    this.rows = options.mesh?.rows ?? PAGE_CURL_MESH.rows;
    this.program = buildProgram(gl, VERTEX_SRC, FRAGMENT_SRC);

    // uniform 位置在 program link 后一次性取好，`render` 里直接复用
    // （每帧 `getUniformLocation` 是同步 GPU 调用，热路径上必须避免）。
    const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(this.program, name);
    this.u = {
      frame: at('u_frame'),
      pageSize: at('u_pageSize'),
      resolution: at('u_resolution'),
      foldOrigin: at('u_foldOrigin'),
      radius: at('u_radius'),
      progress: at('u_progress'),
      radiusScale: at('u_radiusScale'),
      curlValid: at('u_curlValid'),
      hasBack: at('u_hasBack'),
      backOverlay: at('u_backOverlay'),
      shadowAlpha: at('u_shadowAlpha'),
      front: at('u_front'),
      back: at('u_back'),
    };

    const vao = gl.createVertexArray();
    if (vao === null) throw new Error('无法创建 VAO');
    this.vao = vao;
    this.textureFront = createTexture(gl);
    this.textureBack = createTexture(gl);
    buildMesh(gl, vao, this.cols, this.rows);
  }

  /** 上传正面（当前页）内容。 */
  setFront(source: TexImageSource): void {
    uploadTexture(this.gl, this.textureFront, source);
  }

  /** 上传背面（下一页）内容；传 `null` 表示无背面（第一页）。 */
  setBack(source: TexImageSource | null): void {
    this.hasBack = source !== null;
    if (source !== null) uploadTexture(this.gl, this.textureBack, source);
  }

  /** 设置页面在屏幕上的位置。 */
  setFrame(x: number, y: number, w: number, h: number): void {
    this.framePos = { x, y, w, h };
  }

  /** 更新卷曲状态。 */
  setState(next: PageCurlState): void {
    this.state = next;
  }

  /** 渲染一帧。 */
  render(): void {
    const gl = this.gl;
    const { x, y, w, h } = this.framePos;
    const cw = Math.max(1, Math.round(w));
    const chh = Math.max(1, Math.round(h));
    if (this.gl.canvas.width !== cw || this.gl.canvas.height !== chh) {
      this.gl.canvas.width = cw;
      this.gl.canvas.height = chh;
    }

    gl.viewport(0, 0, cw, chh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // GL 的 y 向上、页面坐标 y 向下。页面矩形在 CSS 里的左上角是 (x, y)、
    // 右下角是 (x + w, y + h)；映射到 GL 需要 `y_gl = canvasH - y_css`，
    // 再加一次纵向翻转让页面的第 0 行落在顶部。
    const frame = mat3Mul(mat3Translate(x, chh - y), [1, 0, 0, 0, -1, 0, 0, 0, 1]);

    gl.uniformMatrix3fv(this.u.frame, false, frame);
    gl.uniform2f(this.u.pageSize, w, h);
    gl.uniform2f(this.u.resolution, cw, chh);
    // foldY 同样是页面坐标（向下），要一并翻成 GL 的向上坐标。
    gl.uniform2f(this.u.foldOrigin, this.state.foldX, h - this.state.foldY);
    gl.uniform1f(this.u.radius, this.radius);
    gl.uniform1f(this.u.progress, this.state.progress);
    gl.uniform1f(this.u.radiusScale, this.state.radiusScale);
    gl.uniform1f(this.u.curlValid, this.state.progress > 0.001 ? 1 : 0);
    gl.uniform1f(this.u.hasBack, this.hasBack ? 1 : 0);
    gl.uniform4f(this.u.backOverlay, 1, 1, 1, 1 - PAGE_CURL_BACK_ALPHA);
    gl.uniform1f(this.u.shadowAlpha, PAGE_CURL_SHADOW_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textureFront);
    gl.uniform1i(this.u.front, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hasBack ? this.textureBack : this.textureFront);
    gl.uniform1i(this.u.back, 1);

    gl.drawElements(gl.TRIANGLES, this.cols * this.rows * 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.textureFront);
    gl.deleteTexture(this.textureBack);
  }
}

interface PageCurlUniforms {
  readonly frame: WebGLUniformLocation | null;
  readonly pageSize: WebGLUniformLocation | null;
  readonly resolution: WebGLUniformLocation | null;
  readonly foldOrigin: WebGLUniformLocation | null;
  readonly radius: WebGLUniformLocation | null;
  readonly progress: WebGLUniformLocation | null;
  readonly radiusScale: WebGLUniformLocation | null;
  readonly curlValid: WebGLUniformLocation | null;
  readonly hasBack: WebGLUniformLocation | null;
  readonly backOverlay: WebGLUniformLocation | null;
  readonly shadowAlpha: WebGLUniformLocation | null;
  readonly front: WebGLUniformLocation | null;
  readonly back: WebGLUniformLocation | null;
}

function buildProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type);
    if (sh === null) throw new Error('无法创建 shader');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? '(无日志)';
      gl.deleteShader(sh);
      throw new Error(`卷页着色器编译失败：${log}`);
    }
    return sh;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  if (program === null) throw new Error('无法创建 program');
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(无日志)';
    gl.deleteProgram(program);
    throw new Error(`卷页程序链接失败：${log}`);
  }
  return program;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture();
  if (t === null) throw new Error('无法创建纹理');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // 1×1 占位，避免首帧上传前采样到未初始化的纹理
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  return t;
}

function uploadTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, source: TexImageSource): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

function buildMesh(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  cols: number,
  rows: number,
): void {
  const verts: number[] = [];
  const at = (c: number, r: number): number => {
    verts.push(c / cols, r / rows);
    return verts.length / 2 - 1;
  };
  const index: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i0 = at(c, r);
      const i1 = at(c + 1, r);
      const i2 = at(c, r + 1);
      const i3 = at(c + 1, r + 1);
      index.push(i0, i2, i1, i1, i2, i3);
    }
  }
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  if (vbo === null) throw new Error('无法创建 VBO');
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  if (ibo === null) throw new Error('无法创建 IBO');
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}
