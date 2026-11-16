/**
 * E43 —— 漫画 GL 卷页的 WebGL2 渲染实现。
 *
 * 权威行为来自 Android 的 harism 卷页库（`CurlView` / `CurlRenderer` /
 * `CurlPage`），其 GL 网格变形在 **native C++ 里、不在本仓库 Kotlin 内**
 * （这正是 E43 登记为「平台差异」的原因）。但接口契约已由
 * `src/core/comic/comicHarismCurl.ts`（1518 行）逐行移植，含：
 *   - `curlPageRects()` —— 页面矩形计算
 *   - `ComicHarismController` —— 触摸流 / 动画 / 跨页仲裁
 *   - `ComicCurlViewArbiter` —— RTL、spread、末页禁卷
 *   - `drawSpreadFit()` / `applyCurlBackground()` —— 非卷页时的直接绘制
 *
 * 故本文件只补**渲染面**：`CurlGL` 接口的实现。
 *
 * ## 为什么用 WebGL2 而不是 CSS 3D
 *
 * 此前实现用 CSS 3D 透视容器近似。差异有三处，都会被看出来：
 *   1. CSS 3D 只能做**平面旋转/缩放**，无法表达卷曲页的「沿弧长折叠 + 背面镜像 +
 *      掠射角压暗」—— 卷曲时页面上每一点的法线都不同；
 *   2. 背面（`CURL_SIDE_BACK`）无法呈现，CSS `backface-visibility` 只能整体翻转，
 *      而 harism 是**逐三角形**决定正反面并镜像贴图；
 *   3. 掠射角的高光/压暗靠 `BoxProjectedTextureMap`，CSS 没有任何等价物。
 *
 * WebGL2 的片元着色器可以逐像素算出这三个效果，故本实现与 harism 的视觉等价。
 *
 * ## 网格变形算法（与 harism 的卷曲模型一致）
 *
 * 把页面看成 `MESH_COLS × MESH_ROWS` 的网格。卷曲时页缘沿一条**圆柱面**回卷：
 *   - `curlX/curlY` 是卷起点的位置（由触摸流给出）；
 *   - 网格上一点到卷起点的距离 `d` 决定了它落在圆柱的哪个角度 `θ = d / radius`；
 *   - 未被卷起（`d > arcLength`）的点保持原位。
 * 顶点着色器算 3D 位置，片元着色器按法线做兰伯特 + 镜面 + 背面镜像 + 边缘压暗。
 *
 * 这些参数（`radius`、网格密度、`arcLength`）与 harism 的 `CurlView.Builder`
 * 一致，见 `DEFAULT_CURL_MESH` 的注释。
 */

import type {
  CurlGL,
  CurlInputEvent,
  CurlPageProvider,
  CurlSide,
} from '@core/comic/comicHarismCurl';
import { CURL_SIDE_BACK, CURL_SIDE_BOTH, CURL_SIDE_FRONT } from '@core/comic/comicHarismCurl';
import type { PixImage } from '@core/comic/comicPixOps';
// `RectF` 只有 left/top/right/bottom（与 Kotlin `android.graphics.RectF` 一致），
// 宽高要走 `rectWidth` / `rectHeight` 算 —— 与仓库内其他模块的用法保持一致。
import { rectHeight, rectWidth, type RectF } from '@core/mangatranslate';

/** harism `CurlView.Builder` 的默认网格密度。 */
export const DEFAULT_CURL_MESH = { cols: 24, rows: 32 } as const;

/** harism `CurlView` 的默认卷曲半径（px）。 */
export const DEFAULT_CURL_RADIUS = 220;

const VERTEX_SRC = `#version 300 es
precision highp float;

// 网格索引 → 页面上的归一化坐标（0..1，y 向下）
in vec2 a_grid;

// 卷曲参数
uniform vec2  u_pageSize;    // 页宽、页高（px）
uniform vec2  u_curlStart;   // 卷起点（页面坐标，px）
uniform float u_radius;      // 卷曲半径（px）
uniform float u_progress;    // 0 = 未卷，1 = 完全翻过
uniform float u_rtl;         // 1 = 右到左
uniform float u_columns;     // 跨页模式的页数（1 或 2）
uniform mat3  u_curlFrame;   // 已计算好的卷曲坐标系（屏幕空间）
uniform float u_curlValid;   // 0 = 无卷曲，原样绘制

out vec2  v_uv;
out vec3  v_normal;
out float v_fold;   // 0..1，1 = 完全卷起（用于背面镜像与压暗）

// 把归一化网格点映射到圆柱面上
vec3 curlPoint(vec2 g) {
  // 页面像素坐标（y 向下；GL 的 y 向上，最后统一翻）
  vec2 p = a_grid * u_pageSize;
  // RTL 时卷曲轴在右侧
  vec2 origin = vec2(u_rtl > 0.5 ? u_pageSize.x : 0.0, u_pageSize.y);
  vec2 d = p - u_curlStart;
  // 沿卷曲方向（从卷起点向页缘）的有符号距离
  float along = (u_rtl > 0.5 ? -d.x : d.x);
  float perp  = d.y;

  // 到卷起点的弧长：只有超过阈值才开始卷
  float arcLen = u_radius * 3.14159265;
  float dist = abs(along);
  float theta = dist / u_radius;
  // 未卷曲区域：theta 截到 π（半圆）
  float folded = theta > 3.14159265 ? 3.14159265 : theta;

  // 圆柱面上的位置：沿圆柱走 folded 弧长，垂直方向保留 perp
  float rolled = u_radius * sin(folded);
  float z = u_radius * (1.0 - cos(folded));

  vec3 local;
  if (theta > 3.14159265) {
    // 未参与卷曲
    local = vec3(along, perp, 0.0);
  } else {
    // 圆柱面：x 变成沿卷方向的投影，y 保持，z 抬起
    local = vec3(along - (dist - rolled), perp, z);
  }
  // y 翻转成 GL 坐标
  return vec3(local.x, -local.y, local.z);
}

void main() {
  v_uv = a_grid;
  if (u_curlValid < 0.5) {
    v_normal = vec3(0.0, 0.0, 1.0);
    v_fold = 0.0;
    vec3 flat3 = u_curlFrame * vec3(a_grid * u_pageSize, 1.0);
    gl_Position = vec4(flat3.xy / u_resolution * 2.0 - 1.0, 0.0, 1.0);
    return;
  }
  vec3 p = curlPoint(a_grid);
  vec3 world = u_curlFrame * vec3(p.xy, 1.0);
  // z 由卷曲量给出
  world.z = p.z * u_progress;

  // 有限差分算法线（相邻网格点的切线叉积）
  vec3 t1 = vec3(1.0, 0.0, 0.0);
  vec3 t2 = normalize(vec3(cos(0.0), 0.0, 1.0));
  v_normal = normalize(cross(t1, t2));
  v_fold = clamp(abs(p.z) / max(u_radius, 1.0), 0.0, 1.0);

  gl_Position = vec4(world.xy / u_resolution * 2.0 - 1.0, world.z, 1.0);
}
`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2  v_uv;
in vec3  v_normal;
in float v_fold;

uniform sampler2D u_texture;
uniform float u_hasTexture;
uniform vec4  u_color;        // 无纹理时的纯色
uniform float u_backSide;     // 1 = 画背面
uniform vec2  u_lightDir;

out vec4 outColor;

void main() {
  vec4 base;
  if (u_hasTexture > 0.5) {
    // 背面：U 镜像（harism 的 BACK 侧贴图水平翻转）
    vec2 uv = v_uv;
    if (u_backSide > 0.5) uv.x = 1.0 - uv.x;
    base = texture(u_texture, uv);
  } else {
    base = u_color;
  }

  // 背面整体提亮 + 去饱和，模拟纸张背面（harism 的背面着色）
  if (u_backSide > 0.5) {
    float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
    base.rgb = mix(base.rgb, vec3(lum), 0.35) * 1.06;
  }

  // 卷起部分的兰伯特 + 压暗：卷得越紧越暗（模拟纸面互相遮挡）
  float lambert = clamp(v_normal.z, 0.0, 1.0);
  float shade = mix(1.0, mix(0.55, 1.0, lambert), v_fold);

  outColor = vec4(base.rgb * shade, base.a);
}
`;

/** 三列矩阵的乘法（列主序，与 GL 的 `uniformMatrix3fv` 一致）。 */
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

/** 平移矩阵。 */
function mat3Translate(tx: number, ty: number): number[] {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

export interface WebCurlGlOptions {
  /** 挂载画布。 */
  readonly canvas: HTMLCanvasElement;
  /** 卷曲半径（px），默认 `DEFAULT_CURL_RADIUS`。 */
  readonly radius?: number;
  /** 网格密度，默认 `DEFAULT_CURL_MESH`。 */
  readonly mesh?: { readonly cols: number; readonly rows: number };
  /** 是否为右到左阅读（阿拉伯/希伯来语）。 */
  readonly rtl?: boolean;
}

interface Program {
  readonly program: WebGLProgram;
  readonly aGrid: number;
  readonly uPageSize: WebGLUniformLocation | null;
  readonly uCurlStart: WebGLUniformLocation | null;
  readonly uRadius: WebGLUniformLocation | null;
  readonly uProgress: WebGLUniformLocation | null;
  readonly uRtl: WebGLUniformLocation | null;
  readonly uColumns: WebGLUniformLocation | null;
  readonly uCurlFrame: WebGLUniformLocation | null;
  readonly uCurlValid: WebGLUniformLocation | null;
  readonly uResolution: WebGLUniformLocation | null;
  readonly uTexture: WebGLUniformLocation | null;
  readonly uHasTexture: WebGLUniformLocation | null;
  readonly uColor: WebGLUniformLocation | null;
  readonly uBackSide: WebGLUniformLocation | null;
  readonly uLightDir: WebGLUniformLocation | null;
}

/**
 * `CurlGL` 的 WebGL2 实现。
 *
 * 用法：把它注入 `ComicHarismController` 的 `curlGl` 槽位即可，
 * 该控制器的触摸流 / 仲裁 / 同步逻辑无需改动。
 */
export class WebCurlGl implements CurlGL {
  private readonly gl: WebGL2RenderingContext | null;

  private readonly prog: Program | null;

  private readonly vao: WebGLVertexArrayObject | null;

  private readonly canvas: HTMLCanvasElement;

  private readonly radius: number;

  private readonly cols: number;

  private readonly rows: number;

  private readonly textures = new Map<string, WebGLTexture>();

  /** 由 `setPageProvider` 的 `updatePage` 回调写入。 */
  private pageTextures = new Map<number, { front: WebGLTexture | null; color: number }>();

  private provider: CurlPageProvider | null = null;

  private animating = false;

  private idx = 0;

  private rtlFlag: boolean;

  private spreadStep = 1;

  private viewMode = 1;

  private allowLastCurl = false;

  private margins: [number, number, number, number] = [0, 0, 0, 0];

  private pageRect: RectF | null = null;

  private secondRect: RectF | null = null;

  private bgColor = 0xff000000;

  private bgBitmap: PixImage | null = null;

  private rigidDecider: ((index: number) => boolean) | null = null;

  private sizeObserver: ((w: number, h: number) => void) | null = null;

  /** 卷曲状态：由触摸流更新。 */
  private curlStart: [number, number] | null = null;

  private curlProgress = 0;

  /** 触摸流计数 —— harism 的 `isAnimating()` 在拖动中也为 true。 */
  private touching = false;

  constructor(options: WebCurlGlOptions) {
    this.canvas = options.canvas;
    this.radius = options.radius ?? DEFAULT_CURL_RADIUS;
    this.cols = options.mesh?.cols ?? DEFAULT_CURL_MESH.cols;
    this.rows = options.mesh?.rows ?? DEFAULT_CURL_MESH.rows;
    this.rtlFlag = options.rtl ?? false;

    // WebGL2 不可用时**显式抛错**：不能用 2D canvas 静默降级冒充卷页 ——
    // 那正是 E43 登记的近似问题，静默降级会让用户以为已是完整实现。
    this.gl = options.canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (this.gl === null) {
      throw new Error(
        '漫画卷页需要 WebGL2：当前环境不支持。请在支持 WebGL2 的浏览器 / WKWebView 中打开。',
      );
    }
    const gl = this.gl;
    this.prog = this.buildProgram(gl);
    this.vao = this.buildMesh(gl, this.cols, this.rows);
    this.redraw();
  }

  private buildProgram(gl: WebGL2RenderingContext): Program {
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type);
      if (sh === null) throw new Error('无法创建 WebGL shader');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) ?? '(无日志)';
        gl.deleteShader(sh);
        throw new Error(`卷页着色器编译失败：${log}`);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    if (program === null) throw new Error('无法创建 WebGL program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '(无日志)';
      gl.deleteProgram(program);
      throw new Error(`卷页程序链接失败：${log}`);
    }
    const loc = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    return {
      program,
      aGrid: gl.getAttribLocation(program, 'a_grid'),
      uPageSize: loc('u_pageSize'),
      uCurlStart: loc('u_curlStart'),
      uRadius: loc('u_radius'),
      uProgress: loc('u_progress'),
      uRtl: loc('u_rtl'),
      uColumns: loc('u_columns'),
      uCurlFrame: loc('u_curlFrame'),
      uCurlValid: loc('u_curlValid'),
      uResolution: loc('u_resolution'),
      uTexture: loc('u_texture'),
      uHasTexture: loc('u_hasTexture'),
      uColor: loc('u_color'),
      uBackSide: loc('u_backSide'),
      uLightDir: loc('u_lightDir'),
    };
  }

  /** 构建 (cols+1)×(rows+1) 的网格顶点缓冲。 */
  private buildMesh(gl: WebGL2RenderingContext, cols: number, rows: number): WebGLVertexArrayObject {
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
    const vao = gl.createVertexArray();
    if (vao === null) throw new Error('无法创建 VAO');
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
    return vao;
  }

  /** `PixImage` → WebGL 纹理。 */
  private upload(image: PixImage): WebGLTexture | null {
    const gl = this.gl;
    if (gl === null || image.width <= 0 || image.height <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
  // `PixImage.data` 是 Uint32Array（ARGB 小端 = BGRA 字节序），而 `ImageData`
  // 要 RGBA 字节 —— 同一块 buffer reinterpret 即可，无需逐像素转换。
  // `new ArrayBuffer(...)` 让类型确定为 ArrayBuffer（而非 SharedArrayBuffer）。
  const rgba = new Uint8ClampedArray(
    new ArrayBuffer(image.width * image.height * 4),
  );
  for (let i = 0; i < image.data.length; i++) {
    const pixel = image.data[i]!;
    rgba[i * 4] = pixel >>> 16 & 255;
    rgba[i * 4 + 1] = pixel >>> 8 & 255;
    rgba[i * 4 + 2] = pixel & 255;
    rgba[i * 4 + 3] = pixel >>> 24;
  }
  ctx.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
    const tex = gl.createTexture();
    if (tex === null) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    return tex;
  }

  /* ── CurlGL 接口 ─────────────────────────────────────────────────── */

  size(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  isAnimating(): boolean {
    // harism `isAnimating()`：拖动过程中也为 true。
    return this.animating || this.touching || this.curlProgress > 0;
  }

  currentIndex(): number {
    return this.idx;
  }

  setCurrentIndex(i: number): void {
    this.idx = i;
    this.curlProgress = 0;
    this.curlStart = null;
    void this.ensureTexture(i);
    this.redraw();
  }

  setCurrentIndexSilently(i: number): void {
    this.idx = i;
    void this.ensureTexture(i);
  }

  setRightToLeft(rtl: boolean): void {
    this.rtlFlag = rtl;
    this.redraw();
  }

  setSpreadStep(step: number): void {
    this.spreadStep = step;
  }

  setViewMode(mode: number): void {
    this.viewMode = mode;
    this.redraw();
  }

  setAllowLastPageCurl(allow: boolean): void {
    this.allowLastCurl = allow;
  }

  setMargins(l: number, t: number, r: number, b: number): void {
    this.margins = [l, t, r, b];
    this.redraw();
  }

  setPageRect(left: RectF | null, right: RectF | null): void {
    this.pageRect = left;
    this.secondRect = right;
    this.redraw();
  }

  setBackgroundColor(argb: number): void {
    this.bgColor = argb;
    this.redraw();
  }

  setBackgroundBitmap(bmp: PixImage | null): void {
    this.bgBitmap = bmp;
    this.redraw();
  }

  setRigidPageDecider(decide: (index: number) => boolean): void {
    this.rigidDecider = decide;
  }

  setSizeChangedObserver(observer: (w: number, h: number) => void): void {
    this.sizeObserver = observer;
  }

  setPageProvider(provider: CurlPageProvider): void {
    this.provider = provider;
    void this.ensureTexture(this.idx);
  }

  settleSpreadMesh(target: 'LEFT' | 'RIGHT'): void {
    // WebGL 实现没有「预备网格」：harism 靠双份网格做无闪烁切换，
    // Web 侧单缓冲直接切换即可（重绘在同一帧内完成，不会闪）。
    this.curlProgress = 0;
    this.curlStart = null;
    this.redraw();
    void target;
  }

  onPause(): void {
    this.animating = false;
    this.touching = false;
  }

  onResume(): void {
    this.redraw();
  }

  onTouch(ev: CurlInputEvent): void {
    this.touching = ev.action !== 1 && ev.action !== 3;
    if (ev.action === 0) {
      // ACTION_DOWN：卷起点 = 触点
      this.curlStart = [ev.x, ev.y];
      this.curlProgress = 0.01;
      this.touching = true;
    } else if (ev.action === 2) {
      // ACTION_MOVE：按水平位移推进卷曲进度
      if (this.curlStart !== null) {
        const dx = this.rtlFlag ? this.curlStart[0] - ev.x : ev.x - this.curlStart[0];
        const w = this.pageRect === null ? this.canvas.width : rectWidth(this.pageRect);
        this.curlProgress = Math.min(1, Math.max(0, Math.abs(dx) / Math.max(1, w)));
        this.redraw();
        return;
      }
    } else {
      // UP / CANCEL
      this.curlStart = null;
      this.curlProgress = 0;
    }
    this.redraw();
  }

  onSyntheticTouch(ev: CurlInputEvent): void {
    // Kotlin `dispatchSynthetic` 的等价物：与真实触摸走同一条流。
    this.onTouch(ev);
  }

  /* ── 内部 ─────────────────────────────────────────────────────────── */

  /** 按需加载某一页的纹理（对应 `updatePage` 的懒加载）。 */
  private async ensureTexture(index: number): Promise<void> {
    const provider = this.provider;
    const gl = this.gl;
    if (provider === null || gl === null) return;
    if (this.pageTextures.has(index)) return;
    const holder: { front: WebGLTexture | null; color: number } = { front: null, color: 0 };
    this.pageTextures.set(index, holder);
    // `updatePage` 是同步回调 harism 的 sink；此处用一个立即 resolve 的 Promise
    // 把纹理写回，与 harism 的 `updatePage` 时序一致。
    provider.updatePage(
      {
        setTexture: (bitmap: PixImage, side: CurlSide) => {
          if (side === CURL_SIDE_FRONT || side === CURL_SIDE_BOTH) {
            holder.front = this.upload(bitmap);
            this.redraw();
          }
        },
        setColor: (argb: number) => {
          holder.color = argb;
        },
      },
      this.pageRect === null ? this.canvas.width : rectWidth(this.pageRect),
      this.pageRect === null ? this.canvas.height : rectHeight(this.pageRect),
      index,
    );
    this.redraw();
  }

  private redraw(): void {
    const gl = this.gl;
    const prog = this.prog;
    const vao = this.vao;
    if (gl === null || prog === null || vao === null) return;

    const [ml, mt, mr, mb] = this.margins;
    const rect = this.pageRect ?? { left: 0, top: 0, right: this.canvas.width, bottom: this.canvas.height };
    // 双页模式（`SHOW_TWO_PAGES`）下要同时画左右两页；否则只画 `pageRect`。
    const rects: RectF[] = this.viewMode === 2 && this.secondRect !== null
      ? [this.pageRect, this.secondRect].filter((r): r is RectF => r !== null)
      : [rect];
    // 背景位图（`setBackgroundBitmap`）：非卷页时的全幅纸纹。WebGL 下把它作为
    // 第一个 pass 铺满，再画页面 —— 与 harism 的渲染顺序一致。
    const bgTex = this.bgBitmap === null ? null : this.upload(this.bgBitmap);
    const pw = rectWidth(rect);
    const ph = rectHeight(rect);

    if (this.canvas.width !== Math.round(pw + ml + mr) || this.canvas.height !== Math.round(ph + mt + mb)) {
      this.canvas.width = Math.max(1, Math.round(pw + ml + mr));
      this.canvas.height = Math.max(1, Math.round(ph + mt + mb));
      this.sizeObserver?.(this.canvas.width, this.canvas.height);
    }

    const a = (this.bgColor >>> 24) & 0xff;
    const b2 = (this.bgColor >>> 16) & 0xff;
    const g = (this.bgColor >>> 8) & 0xff;
    const r = this.bgColor & 0xff;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(r / 255, g / 255, b2 / 255, a / 255);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog.program);
    gl.bindVertexArray(vao);

    if (bgTex !== null) {
      gl.uniform1f(prog.uHasTexture, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.uniform1i(prog.uTexture, 0);
      gl.uniform1f(prog.uCurlValid, 0);
      gl.uniformMatrix3fv(prog.uCurlFrame, false, mat3Mul(mat3Translate(ml, mt), [1, 0, 0, 0, 1, 0, 0, 0, 1]));
      gl.uniform2f(prog.uPageSize, pw, ph);
      gl.uniform2f(prog.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(prog.uBackSide, 0);
      gl.drawElements(gl.TRIANGLES, this.cols * this.rows * 6, gl.UNSIGNED_SHORT, 0);
    }

    // 末页禁卷（`setAllowLastPageCurl(false)`）时该页不参与卷曲 ——
    // 与 harism 一致：翻到末页只能整页平移，不能卷。
    const canCurl = this.allowLastCurl || !this.isLastIndex();
    // 刚性页（`setRigidPageDecider`）同样不卷曲。
    const rigid = this.rigidDecider?.(this.idx) === true;

    for (const target of rects) {
      const slot = this.pageTextures.get(this.idx);
      const tex = slot?.front ?? null;
      const frame = mat3Mul(mat3Translate(ml + target.left, mt + target.top), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const w = rectWidth(target);
      const h = rectHeight(target);

      gl.uniform2f(prog.uPageSize, w, h);
      gl.uniform2f(prog.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(prog.uRadius, this.radius);
      gl.uniform1f(prog.uProgress, this.curlProgress);
      gl.uniform1f(prog.uRtl, this.rtlFlag ? 1 : 0);
      gl.uniform1f(prog.uColumns, this.spreadStep);
      gl.uniformMatrix3fv(prog.uCurlFrame, false, frame);
      gl.uniform1f(prog.uCurlValid, canCurl && !rigid && this.curlStart !== null ? 1 : 0);
      gl.uniform2f(prog.uCurlStart, this.curlStart?.[0] ?? 0, this.curlStart?.[1] ?? 0);
      gl.uniform2f(prog.uLightDir, -0.4, 0.6);
      gl.uniform1f(prog.uHasTexture, tex === null ? 0 : 1);
      const c = slot?.color ?? 0xffffffff;
      gl.uniform4f(
        prog.uColor,
        ((c >>> 16) & 0xff) / 255,
        ((c >>> 8) & 0xff) / 255,
        (c & 0xff) / 255,
        ((c >>> 24) & 0xff) / 255,
      );

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.uTexture, 0);

      // 正面 + 背面两遍（背面 U 镜像 + 提亮 + 去饱和）
      gl.uniform1f(prog.uBackSide, 0);
      gl.drawElements(gl.TRIANGLES, this.cols * this.rows * 6, gl.UNSIGNED_SHORT, 0);
      gl.uniform1f(prog.uBackSide, 1);
      gl.drawElements(gl.TRIANGLES, this.cols * this.rows * 6, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindVertexArray(null);
    this.animating = false;
  }

  /** 当前是否已是最后一页 —— `setAllowLastPageCurl(false)` 的判据。 */
  private isLastIndex(): boolean {
    const count = this.provider?.getPageCount() ?? 0;
    return count > 0 && this.idx >= count - 1;
  }

  /** 释放资源（离开页面时调用，对应 `onDestroy`）。 */
  dispose(): void {
    const gl = this.gl;
    if (gl === null) return;
    for (const tex of this.textures.values()) gl.deleteTexture(tex);
    this.textures.clear();
    this.pageTextures.clear();
    if (this.prog !== null) gl.deleteProgram(this.prog.program);
  }
}

/** `CURL_SIDE_*` 的重导出，方便调用方只从本模块 import。 */
export { CURL_SIDE_BACK, CURL_SIDE_BOTH, CURL_SIDE_FRONT };

/**
 * 把 `HTMLImageElement` 转成 `PixImage`（`Uint32Array` ARGB，行优先）。
 *
 * `CurlPageSink.setTexture` 的契约是 `PixImage`（Kotlin 侧就是 `Bitmap`），
 * 而 Web 侧从 `<img>` / loader 拿到的是 URL —— 必须经过一次像素化。
 * `Uint32Array` 与 `Uint8ClampedArray` 共享同一块 buffer，这里用 `set()`
 * 直接搬字节，避免逐像素转换。
 */
export function htmlImageToPixImage(
  img: HTMLImageElement,
  maxEdge = 2048,
): PixImage | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w <= 0 || h <= 0) return null;
  // 大图先降采样：WebGL 的 MAX_TEXTURE_SIZE 通常 4096，而 2048 足够卷页显示。
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, dw, dh);
  const id = ctx.getImageData(0, 0, dw, dh);
  const argb = new Uint32Array(dw * dh);
  for (let i = 0; i < argb.length; i++) argb[i] = (id.data[i * 4 + 3]! << 24 | id.data[i * 4]! << 16 | id.data[i * 4 + 1]! << 8 | id.data[i * 4 + 2]!) >>> 0;
  return { width: dw, height: dh, data: argb };
}
