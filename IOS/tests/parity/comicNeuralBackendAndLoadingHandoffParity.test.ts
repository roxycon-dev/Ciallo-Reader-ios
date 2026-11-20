/**
 * comicNeuralBackendAndLoadingHandoffParity.test.ts
 *   ├ `ui/comic/ComicNeuralBackend.kt`（77 行）→ `@core/comic/comicNeuralBackend`
 *   └ `ui/wenku/WenkuLoadingHandoff.kt`（77 行）→ `@ui/components/wenku/WenkuLoadingHandoff`
 *
 * 两个文件的共同点是「**grep 命中但实现不在**」：
 *
 *   · `ComicNeuralBackend` 在端口里只有两句注释（`anime4KCnn.ts` L15 / L273
 *     「always null on this port」），那个 object 从来没被实现过。
 *   · `WenkuLoadingHandoff` 的实现是完整的，但**没有一条测试读 Kotlin 原文** ——
 *     320ms / `ease` / 两段互补裁切 / `contentKey` 只作用于内容层，四件事全靠注释自证。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ComicNeuralBackend,
  NEURAL_CANCEL_MESSAGE,
  NEURAL_CHANNELS,
  NEURAL_INPUT_NAME,
  NEURAL_LOG_MESSAGE,
  NEURAL_LOG_TAG,
  NEURAL_SESSION_OPTIONS,
  nchwToRgba,
  neuralAssetName,
  neuralTensorShape,
  rgbaToNchw,
  type NeuralSession,
} from '@core/comic/comicNeuralBackend';
import {
  WENKU_HANDOFF_CONTENT_CLIP,
  WENKU_HANDOFF_ERASE_MS,
  WENKU_HANDOFF_FADE_EPSILON,
  WENKU_HANDOFF_FADE_MS,
  WENKU_HANDOFF_SKELETON_CLIP,
  WENKU_SKELETON_ALPHA_DARK,
  WENKU_SKELETON_ALPHA_LIGHT,
  WENKU_SKELETON_RADIUS_PX,
} from '@ui/components/wenku/WenkuLoadingHandoff';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const NEURAL_KT = 'ui/comic/ComicNeuralBackend.kt';
const HANDOFF_KT = 'ui/wenku/WenkuLoadingHandoff.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① ComicNeuralBackend.kt L41-49 RGBA ↔ NCHW
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicNeuralBackend.kt L41-49 RGBA ↔ NCHW 的两次搬运', () => {
  const src = kt(NEURAL_KT);

  it('L41-42 `nchw[ch * area + i] = rgba[i * 4 + ch]`（交错 → 平面）', () => {
    expect(src).toContain('val nchw = FloatArray(rgba.size)');
    expect(src).toContain('for (i in 0 until area) for (ch in 0..3) nchw[ch * area + i] = rgba[i * 4 + ch]');
    // 2×2 图，每像素 RGBA 递增 ⇒ 4 个平面各 4 个分量
    const rgba = new Float32Array([
      1, 2, 3, 4, // 像素 0
      5, 6, 7, 8, // 像素 1
      9, 10, 11, 12, // 像素 2
      13, 14, 15, 16, // 像素 3
    ]);
    expect([...rgbaToNchw(rgba, 2, 2)]).toEqual([
      // R 平面
      1, 5, 9, 13,
      // G 平面
      2, 6, 10, 14,
      // B 平面
      3, 7, 11, 15,
      // A 平面
      4, 8, 12, 16,
    ]);
  });

  it('L47-49 `packed[i * 4 + ch] = nchw[ch * area + i]`（平面 → 交错）', () => {
    expect(src).toContain('output.floatBuffer.get(nchw)');
    expect(src).toContain('for (i in 0 until area) for (ch in 0..3) packed[i * 4 + ch] = nchw[ch * area + i]');
    const plane = new Float32Array([
      // R
      1, 5, 9, 13,
      // G
      2, 6, 10, 14,
      // B
      3, 7, 11, 15,
      // A
      4, 8, 12, 16,
    ]);
    expect([...nchwToRgba(plane, 2, 2)]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it('两次搬运互为逆运算（非方图，验证 area 用的是 w*h）', () => {
    const rgba = new Float32Array(3 * 2 * 4).map((_, i) => i);
    const roundTrip = nchwToRgba(rgbaToNchw(rgba, 3, 2), 3, 2);
    expect([...roundTrip]).toEqual([...rgba]);
  });

  it('L43 `longArrayOf(1, 4, height, width)` —— 4 通道、H 在 W 之前', () => {
    expect(src).toContain('longArrayOf(1, 4, height.toLong(), width.toLong())');
    expect(NEURAL_CHANNELS).toBe(4);
    expect(neuralTensorShape(640, 480)).toEqual([1, 4, 480, 640]);
    // 写反成 [1,4,width,height] 在方图上测不出来 —— 用非方图钉住
    expect(neuralTensorShape(2, 3)).toEqual([1, 4, 3, 2]);
  });

  it('L44 输入名是 `"rgba"`（不是 "input" / "images"）', () => {
    expect(src).toContain('session.run(mapOf("rgba" to tensor))');
    expect(NEURAL_INPUT_NAME).toBe('rgba');
  });

  it('L30 模型资源名是 `comic_enhancement/$model-s.onnx`', () => {
    expect(src).toContain('context.assets.open("comic_enhancement/$model-s.onnx")');
    expect(neuralAssetName('restore')).toBe('comic_enhancement/restore-s.onnx');
    expect(neuralAssetName('upscale')).toBe('comic_enhancement/upscale-s.onnx');
  });
});

describe('ComicNeuralBackend.kt L31-38 会话选项五项', () => {
  const src = kt(NEURAL_KT);

  it('2 / 1 / BASIC_OPT / 两个 false', () => {
    expect(src).toContain('options.setIntraOpNumThreads(2)');
    expect(src).toContain('options.setInterOpNumThreads(1)');
    expect(src).toContain('options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.BASIC_OPT)');
    expect(src).toContain('options.setMemoryPatternOptimization(false)');
    expect(src).toContain('options.setCPUArenaAllocator(false)');
    expect(NEURAL_SESSION_OPTIONS).toEqual({
      intraOpThreads: 2,
      interOpThreads: 1,
      optimizationLevel: 'BASIC_OPT',
      memoryPatternOptimization: false,
      cpuArenaAllocator: false,
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② ComicNeuralBackend.kt L21-64 的四道门与三条 catch
   ══════════════════════════════════════════════════════════════════════════════ */

/** 一个把输入原样返回的会话（推理是恒等 ⇒ 输出的 NCHW 与输入相同）。 */
function echoSession(closed: { count: number }): NeuralSession {
  return {
    run(input: Float32Array): Float32Array {
      return input.slice();
    },
    close(): void {
      closed.count += 1;
    },
  };
}

describe('ComicNeuralBackend.kt L21-64 run 的门与降级', () => {
  const src = kt(NEURAL_KT);
  const rgba = new Float32Array([1, 2, 3, 4]);

  it('L22 没 `configure` 过 → null（且不建会话）', async () => {
    expect(src).toContain('val context = applicationContext ?: return null');
    let opened = 0;
    const backend = new ComicNeuralBackend({
      openSession: () => {
        opened += 1;
        return echoSession({ count: 0 });
      },
    });
    expect(await backend.run('restore', rgba, 1, 1)).toBeNull();
    expect(opened).toBe(0);
    expect(backend.usedNative).toBe(false);
  });

  it('L24 取消（`isInterrupted`）要**抛出**，不能降级', async () => {
    expect(src).toContain('if (Thread.currentThread().isInterrupted) throw InterruptedException("CNN cancelled")');
    expect(NEURAL_CANCEL_MESSAGE).toBe('CNN cancelled');
    const backend = new ComicNeuralBackend({ openSession: () => echoSession({ count: 0 }) });
    backend.configure();
    await expect(backend.run('restore', rgba, 1, 1, { aborted: true })).rejects.toThrow(NEURAL_CANCEL_MESSAGE);
    // 取消**不**把后端标成不可用 —— 下一次还能跑
    expect(backend.isUnavailable).toBe(false);
  });

  it('L50 `usedNative = true` 只在成功路径上', async () => {
    expect(src).toContain('usedNative = true');
    const backend = new ComicNeuralBackend({ openSession: () => echoSession({ count: 0 }) });
    backend.configure();
    const out = await backend.run('restore', rgba, 1, 1);
    expect(out).not.toBeNull();
    expect([...(out as Float32Array)]).toEqual([1, 2, 3, 4]);
    expect(backend.usedNative).toBe(true);
  });

  it('L56-58 `Exception` → `disable()` + null，并且**之后永不再试**', async () => {
    expect(src).toContain('} catch (error: Exception) {');
    expect(src).toContain('disable(error)');
    let opened = 0;
    const warnings: string[] = [];
    const backend = new ComicNeuralBackend({
      openSession: () => {
        opened += 1;
        throw new Error('onnx missing');
      },
      warn: (tag, message) => warnings.push(`${tag}|${message}`),
    });
    backend.configure();
    expect(await backend.run('restore', rgba, 1, 1)).toBeNull();
    expect(backend.isUnavailable).toBe(true);
    expect(backend.usedNative).toBe(false);
    expect(warnings).toEqual([`${NEURAL_LOG_TAG}|${NEURAL_LOG_MESSAGE}`]);
    // 第二次：`unavailable` 门直接返回，不再碰 openSession
    expect(await backend.run('restore', rgba, 1, 1)).toBeNull();
    expect(opened).toBe(1);
  });

  it('L59-61 `LinkageError` 也降级（JNI 加载失败时是 Error 不是 Exception）', async () => {
    expect(src).toContain('} catch (error: LinkageError) {');
    const backend = new ComicNeuralBackend({ openSession: () => echoSession({ count: 0 }) });
    backend.configure();
    // 注入一个非 Error 的抛出物，模拟 LinkageError 走同一条 disable 分支
    const broken = new ComicNeuralBackend({
      openSession: () => ({
        run(): Float32Array {
          throw new TypeError('UnsatisfiedLinkError');
        },
        close(): void {},
      }),
    });
    broken.configure();
    expect(await broken.run('restore', rgba, 1, 1)).toBeNull();
    expect(broken.isUnavailable).toBe(true);
    void backend;
  });

  it('L71-76 `disable` 的四个动作：置不可用 / 逐个 close / 清表 / 记日志', async () => {
    expect(src).toContain('sessions.values.forEach { runCatching { it.close() } }');
    expect(src).toContain('sessions.clear()');
    expect(src).toContain('Log.w("ComicEnhance", "Native CNN unavailable; using Kotlin reference", error)');
    expect(NEURAL_LOG_TAG).toBe('ComicEnhance');
    expect(NEURAL_LOG_MESSAGE).toBe('Native CNN unavailable; using Kotlin reference');
    const closed = { count: 0 };
    const backend = new ComicNeuralBackend({ openSession: () => echoSession(closed) });
    backend.configure();
    await backend.run('restore', rgba, 1, 1); // 建会话
    await backend.release();
    expect(closed.count).toBe(1);
  });

  it('L66-69 `release()` 关掉并清空，但**不**把后端标成不可用', async () => {
    expect(src).toContain('fun release() = synchronized(lock) {');
    const closed = { count: 0 };
    const backend = new ComicNeuralBackend({ openSession: () => echoSession(closed) });
    backend.configure();
    await backend.run('restore', rgba, 1, 1);
    await backend.release();
    expect(closed.count).toBe(1);
    expect(backend.isUnavailable).toBe(false);
    // release 后还能再跑（会重建会话）
    expect(await backend.run('restore', rgba, 1, 1)).not.toBeNull();
    expect(closed.count).toBe(1);
  });

  it('`grep` 命中但实现不在：旧端口只有两句注释', () => {
    const old = repoText('src/core/comic/anime4KCnn.ts');
    // 旧注释仍然保留（它说明的是 anime4k 自己的路径），但真身已经存在
    expect(old).toContain('ComicNeuralBackend');
    expect(repoText('src/core/comic/comicNeuralBackend.ts')).toContain('export class ComicNeuralBackend');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ WenkuLoadingHandoff.kt L17-47 擦除的时长与缓动
   ══════════════════════════════════════════════════════════════════════════════ */

describe('WenkuLoadingHandoff.kt L35-47 擦除时钟', () => {
  const src = kt(HANDOFF_KT);

  it('L45 `tween(durationMillis = 320, easing = LinearEasing)` —— 时钟**线性**', () => {
    expect(src).toContain('progress.animateTo(1f, tween(durationMillis = 320, easing = LinearEasing))');
    expect(WENKU_HANDOFF_ERASE_MS).toBe(320);
    // 线性：进度 = t / 320，不是 ease(t)
    const tsx = repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx');
    expect(tsx).toContain('const next = elapsed >= WENKU_HANDOFF_ERASE_MS ? 1 : elapsed / WENKU_HANDOFF_ERASE_MS;');
  });

  it('L53 / L67 才过 `WenkuMotion.ease.transform(...)`（缓动在**裁切**这一步）', () => {
    expect(src).toContain('val p = WenkuMotion.ease.transform(progress.value.coerceIn(0f, 1f))');
    // 两处（内容 + 骨架）都各自算一次 p
    expect((src.match(/WenkuMotion\.ease\.transform\(progress\.value\.coerceIn\(0f, 1f\)\)/g) ?? []).length).toBe(2);
    expect(repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx')).toContain('const p = easeCurve(raw > 1 ? 1 : raw < 0 ? 0 : raw);');
  });

  it('L38-47 三个分支：`!loaded` → 0、`!animate` → 1、否则从 0 跑到 1', () => {
    expect(src).toContain('if (!loaded) {');
    expect(src).toContain('progress.snapTo(0f)');
    expect(src).toContain('} else if (!animate) {');
    expect(src).toContain('progress.snapTo(1f)');
    const tsx = repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx');
    expect(tsx).toContain('const snap: number | null = !props.loaded ? 0 : !animate ? 1 : null;');
  });

  it('L35 `animate = decorativeMotion && LocalWenkuDecorativeMotion.current`', () => {
    expect(src).toContain('val animate = rememberWenkuAccessibility().decorativeMotion && LocalWenkuDecorativeMotion.current');
    expect(repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx')).toContain(
      "const animate = !reduceMotion && quality !== 'MINIMAL';",
    );
  });

  it('L37 `showSkeleton = progress < 1f`（骨架在揭示完成前一直在）', () => {
    expect(src).toContain('val showSkeleton by remember(progress) { derivedStateOf { progress.value < 1f } }');
    expect(repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx')).toContain('const showSkeleton = raw < 1;');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ WenkuLoadingHandoff.kt L49-75 两段互补的裁切
   ══════════════════════════════════════════════════════════════════════════════ */

describe('WenkuLoadingHandoff.kt L49-75 两段互补裁切', () => {
  const src = kt(HANDOFF_KT);

  it('L54 内容裁 `bottom = h * p`（从顶向下揭示）', () => {
    expect(src).toContain('clipRect(left = 0f, top = 0f, right = size.width, bottom = size.height * p) {');
    expect(WENKU_HANDOFF_CONTENT_CLIP).toBe('inset(0 0 calc(100% - var(--handoff-p) * 100%) 0)');
  });

  it('L68 骨架裁 `top = h * p, bottom = h`（与内容上下互补）', () => {
    expect(src).toContain('clipRect(top = size.height * p, bottom = size.height) {');
    expect(WENKU_HANDOFF_SKELETON_CLIP).toBe('inset(calc(var(--handoff-p) * 100%) 0 0 0)');
    // 两段相加正好是整高：内容 [0, p]，骨架 [p, 1]
    expect(WENKU_HANDOFF_CONTENT_CLIP).toContain('calc(100% - var(--handoff-p) * 100%)');
    expect(WENKU_HANDOFF_SKELETON_CLIP).toContain('inset(calc(var(--handoff-p) * 100%) 0 0 0)');
  });

  it('L62 `if (showSkeleton)` 才渲染骨架层（揭示完成后整层卸载）', () => {
    expect(src).toContain('if (showSkeleton) {');
    const tsx = repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx');
    expect(tsx).toContain('{showSkeleton ? (');
    expect(tsx).toContain('data-handoff-layer="skeleton"');
    expect(tsx).toContain('data-handoff-layer="content"');
  });

  it('L65 `matchParentSize()` —— 骨架拉伸到内容撑开的高度', () => {
    expect(src).toContain('.matchParentSize()');
    expect(repoText('src/styles/wenku.css')).toContain('.wenku-handoff__skeleton');
  });

  it('L49 `Box(modifier.fillMaxWidth())` —— 高度由 content 决定', () => {
    expect(src).toContain('Box(modifier.fillMaxWidth()) {');
    expect(repoText('src/styles/wenku.css')).toContain('.wenku-handoff');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ WenkuLoadingHandoff.kt 之外的三个常量（骨架块来自 WenkuMotion.kt）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('WenkuMotion.kt L567-601 的交接/骨架常量（同一组件的另一半）', () => {
  const motion = kt('ui/wenku/WenkuMotion.kt');

  it('L591 `tween(if (a11y.reduceMotion) 0 else 120, easing = WenkuMotion.ease)`', () => {
    expect(motion).toContain('120');
    expect(WENKU_HANDOFF_FADE_MS).toBe(120);
  });

  it('L594 `skeletonAlpha.value > 0.01f`', () => {
    expect(motion).toContain('0.01f');
    expect(WENKU_HANDOFF_FADE_EPSILON).toBe(0.01);
  });

  it('L570-575 骨架块的两个 alpha：暗 0.0825 / 亮 0.0625，半径 4dp', () => {
    expect(WENKU_SKELETON_ALPHA_DARK).toBe(0.0825);
    expect(WENKU_SKELETON_ALPHA_LIGHT).toBe(0.0625);
    expect(WENKU_SKELETON_RADIUS_PX).toBe(4);
    const tsx = repoText('src/ui/components/wenku/WenkuLoadingHandoff.tsx');
    expect(tsx).toContain('const alpha = dark ? WENKU_SKELETON_ALPHA_DARK : WENKU_SKELETON_ALPHA_LIGHT;');
    // 纯静态：骨架的样式里不许出现 keyframes
    expect(tsx).not.toContain('@keyframes');
  });
});
