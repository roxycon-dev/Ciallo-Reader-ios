/**
 * E61 护栏 —— `src/core/**` 不得依赖 DOM 全局。
 *
 * 这个文件锁两件事：
 *
 * 1. **架构断言**：`src/core/**` 的源码里不出现 `window.` / `document.` /
 *    `localStorage` / `navigator.` / `new Audio` / `HTMLAudioElement`。
 *    ESLint 的 `no-restricted-globals` 已在 CI 拦一层，这里再兜一层 ——
 *    因为 ESLint 规则可能被误改，而这条铁律是**移植项目的地基**。
 *
 * 2. **行为断言**：在**非 DOM 宿主**（`window` / `document` 被删掉）下，
 *    依赖注入的兜底分支能正常工作、不抛错。这才是 E61 的实际收益 ——
 *    core 能在 Node worker / 小程序壳里跑。
 *
 * 允许的例外（与 ESLint 配置一致）：
 *   - `typeof window === 'undefined'` 这类**存在性探测**（不是成员访问）
 *   - 注入给 WebView 的**脚本文本串**里的 DOM API（如 `jsSourceRepo.ts`）
 *
 * Android authority: 无 —— 这是本项目自建的 `src/core/**` 分层约定，
 * 对应 Kotlin 侧「平台能力走注入、不在核心逻辑里直连 android.*」。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CORE_DIR = 'src/core';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/**
 * 逐行剥掉注释，只留可执行代码。
 *
 * 关键坑（第一版就踩了）：**块注释状态必须跨行延续**。
 * JSDoc 的每一行都以星号开头，例如某行写的是
 * 「E61：原先直接调 window.matchMedia」——
 * 如果只看单行、找不到块注释结束标记就认为注释完了，
 * 那么后续所有星号开头的行都会被当成**代码** → 92 处假违规。
 * 同理双斜杠之后的内容、以及字符串字面量里的内容，都不是「引用」。
 *
 * ⚠️ 写这段注释时不要把块注释结束标记本身放进注释文本里 ——
 * 那会提前闭合注释（第一版就这么炸过一次，报 Unterminated regular expression）。
 */
function codeLines(text: string): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let inBlock = false;
  const lines = text.split('\n');
  for (let idx = 0; idx < lines.length; idx += 1) {
    // `noUncheckedIndexedAccess` 下 split 结果是 `string | undefined`。
    // 循环上界已保证不越界，这里显式兜底空串而不是用非空断言 ——
    // 断言只是把类型系统的提醒按掉，兜底让越界时真的按空行处理。
    const raw = lines[idx] ?? '';
    let line = '';
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const close = raw.indexOf('*/', i);
        if (close === -1) {
          i = raw.length;
        } else {
          i = close + 2;
          inBlock = false;
        }
        continue;
      }
      const open = raw.indexOf('/*', i);
      const lineComment = raw.indexOf('//', i);
      if (lineComment !== -1 && (open === -1 || lineComment < open)) {
        i = raw.length;
        break;
      }
      if (open !== -1) {
        line += raw.slice(i, open);
        i = open + 2;
        inBlock = true;
        continue;
      }
      line += raw.slice(i);
      i = raw.length;
    }
    out.push({ line: idx + 1, code: blankStrings(line) });
  }
  return out;
}

/** 把字符串字面量整体挖空（模板串里可能嵌引号，粗略处理即可）。 */
function blankStrings(code: string): string {
  // 用 charCode 而不是正则字面量：反引号在正则字面量里必须转义，极易写错。
  const patterns = [
    new RegExp("'(?:\\\\.|[^'\\\\])*'", 'g'),
    new RegExp('"(?:\\\\.|[^"\\\\])*"', 'g'),
    new RegExp(String.fromCharCode(96) + '(?:\\\\.|[^' + String.fromCharCode(92) + String.fromCharCode(96) + '])*' + String.fromCharCode(96), 'g'),
  ];
  const replacement = String.fromCharCode(34, 34);
  let out = code;
  for (const re of patterns) out = out.replace(re, replacement);
  return out;
}

const FORBIDDEN: { pattern: RegExp; name: string }[] = [
  { pattern: /\bwindow\s*\./, name: 'window.' },
  { pattern: /\bdocument\s*\./, name: 'document.' },
  { pattern: /\blocalStorage\b/, name: 'localStorage' },
  { pattern: /\bsessionStorage\b/, name: 'sessionStorage' },
  { pattern: /\bnavigator\s*\./, name: 'navigator.' },
  { pattern: /\bnew\s+Audio\b/, name: 'new Audio' },
  { pattern: /\bHTMLAudioElement\b/, name: 'HTMLAudioElement' },
  { pattern: /\bHTMLElement\b/, name: 'HTMLElement' },
  { pattern: /\bmatchMedia\b/, name: 'matchMedia' },
];

/**
 * 允许 `typeof window` 这种存在性探测。
 * 判据：命中处若紧跟 `=== 'undefined'` / `!== 'undefined'` / `== null` 等，
 * 说明是在问「宿主有没有」，不是在用宿主能力。
 */
function isExistenceProbe(code: string, at: number): boolean {
  const after = code.slice(at);
  return /^\s*[?!]?\s*={1,3}\s*'undefined'/.test(after) || /^\s*={1,3}\s*null/.test(after);
}

/**
 * 豁免名单：`src/core/**` 里合法出现 DOM API 的文件。
 *
 * 这三个文件里的 `document.querySelector` / `document.title` 全部位于
 * **多行模板字符串**中 —— 它们是要用 `WKWebView.evaluateJavaScript` /
 * `webView.evaluateJavascript` **注入到目标页面里执行**的脚本文本，
 * 不是本进程访问自己的 DOM。
 *
 * `docs/PARITY_EXCEPTIONS.md` E61 原文已登记这一豁免（**4 个文件**）：
 * 「`core/source/js/jsSourceRepo.ts`、`zLibraryWebViewHelper.ts`、
 * `cfWebViewSolver.ts`、`library/zLibraryNativeSession.ts` 里的
 * `document.querySelector` 都在**注入给 WebView 的脚本文本串**里，不算违规」。
 *
 * 为什么必须按**文件**豁免而不是按行：这些脚本串是**跨行模板字符串**
 * （例如 `zLibraryWebViewHelper.ts` 的 `DIAMWALL_GATE_CLICK_JS` 从第 127 行
 * 开引号、第 130 行才出现 `document.querySelector`），而上面的 `codeLines()`
 * 是**逐行**处理的 —— 第 130 行看不到开头的反引号，无法判定自己在串内。
 * 想要行级精确就得实现「跨行字符串状态机」，但那会让剥离器本身变成第二个
 * 需要被测试的解析器。按文件豁免更保守：这几个文件将来若真在代码里访问 DOM，
 * 会因为「不再只是串」而被 ESLint 的 `no-restricted-globals` 抓到（该规则
 * 同样按标识符匹配，串内文本对它不可见）—— 届时再移出名单即可。
 */
const EXEMPT_FILES = new Set([
  join('src', 'core', 'source', 'js', 'jsSourceRepo.ts'),
  join('src', 'core', 'source', 'js', 'cfWebViewSolver.ts'),
  join('src', 'core', 'source', 'zlibrary', 'zLibraryWebViewHelper.ts'),
  join('src', 'core', 'library', 'zLibraryNativeSession.ts'),
]);

describe('E61：src/core/** 架构断言', () => {
  const files = walk(CORE_DIR);

  it('至少扫到 100 个 core 文件（防止路径写错导致空跑通过）', () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
  });

  it('没有任何 core 文件直接引用 DOM 全局（WebView 注入脚本名单除外）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (EXEMPT_FILES.has(file)) continue;
      for (const { line, code } of codeLines(readFileSync(file, 'utf8'))) {
        for (const { pattern, name } of FORBIDDEN) {
          const m = pattern.exec(code);
          if (m === null) continue;
          if (name === 'window.' || name === 'document.') {
            if (isExistenceProbe(code, m.index)) continue;
          }
          offenders.push(`${file}:${line}  ${name}  →  ${code.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('豁免名单里的文件确实存在于 core（防止名单写错路径而空跑）', () => {
    for (const name of EXEMPT_FILES) {
      expect(files).toContain(name);
    }
  });

  it('webRegionDecoder 不在 core 里（E68 的 Web 实现已归位到 platform）', () => {
    // 它 100% 依赖 document.createElement('canvas')，留在 core 就是 E61 违规。
    const still = files.filter((f) => f.includes('webRegionDecoder'));
    expect(still).toEqual([]);
  });
});

/* ══════════════ 非 DOM 宿主下的兜底行为 ══════════════ */

import { AmbientAudio, getAmbientAudio } from '@core/audio/ambientAudio';
import { PageFlipSound, getPageFlipSound } from '@core/audio/pageFlipSound';
import { setAudioSource, withAudioSource, type AudioHandle } from '@core/audio/audioSource';
import { prefersReducedTransparency, filmGrainDataUrl, resetFilmGrainCache } from '@core/glass/liquidGlass';
import { systemReduceMotion } from '@core/glass/motion';
import { withMediaQuery } from '@core/glass/mediaQuerySource';
import { withBitmapSource } from '@core/glass/bitmapSource';
import { currentWindowWidthClass, isLandscapeViewport, setViewportSource } from '@core/glass/adaptiveSpec';
import {
  clearMemoryKeyValueStore,
  withKeyValueStore,
} from '@core/god/keyValueStore';
import { getGodRankingStyle, setGodRankingStyle, GOD_RANKING_STYLES } from '@core/god/godRankingSettings';

/** 可编程的假音频句柄，记录所有调用以便断言交互。 */
function fakeAudio(log: string[]): AudioHandle {
  return {
    isReady: () => true,
    play: () => {
      log.push('play');
      return Promise.resolve();
    },
    pause: () => log.push('pause'),
    setLoop: (v) => log.push(`loop=${v}`),
    setVolume: (v) => log.push(`volume=${v}`),
    setPosition: (v) => log.push(`pos=${v}`),
    release: () => log.push('release'),
  };
}

describe('E61：注入源可控（不依赖 jsdom）', () => {
  afterEach(() => {
    setAudioSource(null);
    setViewportSource(null);
    clearMemoryKeyValueStore();
  });

  it('媒体查询：未注入时全部降级为 false（对齐 Android 读 flag 失败）', () => {
    setViewportSource(null);
    expect(systemReduceMotion()).toBe(false);
    expect(prefersReducedTransparency()).toBe(false);
  });

  it('媒体查询：注入 reduce-motion 后 systemReduceMotion 为 true', () => {
    const restore = withMediaQuery({
      matches: (q) => q.includes('prefers-reduced-motion'),
    });
    try {
      expect(systemReduceMotion()).toBe(true);
      // 另一个查询未命中，不受影响
      expect(prefersReducedTransparency()).toBe(false);
    } finally {
      restore();
    }
  });

  it('媒体查询：prefers-contrast: more 也触发 reduced-transparency', () => {
    const restore = withMediaQuery({ matches: (q) => q.includes('prefers-contrast') });
    try {
      expect(prefersReducedTransparency()).toBe(true);
    } finally {
      restore();
    }
  });

  it('视口：未注入时 width=0 → COMPACT 且非横屏', () => {
    setViewportSource(null);
    expect(currentWindowWidthClass()).toBe('COMPACT');
    expect(isLandscapeViewport()).toBe(false);
  });

  it('视口：注入 900x500 → EXPANDED + 横屏', () => {
    setViewportSource({ width: () => 900, height: () => 500 });
    expect(currentWindowWidthClass()).toBe('EXPANDED');
    expect(isLandscapeViewport()).toBe(true);
  });

  it('视口：600x1000 → MEDIUM 断点且为竖屏', () => {
    // 600dp 是 MEDIUM 的下边界（>= 600）；1000 > 600 所以是竖屏。
    setViewportSource({ width: () => 600, height: () => 1000 });
    expect(currentWindowWidthClass()).toBe('MEDIUM');
    expect(isLandscapeViewport()).toBe(false);
  });

  it('视口：599x1000 → COMPACT（断点下边界之下一档）', () => {
    setViewportSource({ width: () => 599, height: () => 1000 });
    expect(currentWindowWidthClass()).toBe('COMPACT');
  });

  it('视口：端口方法必须带括号调用（防「函数对象按字典序比较」回归）', () => {
    // 回归背景：`isLandscapeViewport()` 曾写成 `vp.width > vp.height`（漏括号），
    // 于是比较的是两个**函数对象** —— JS 隐式转字符串后按字典序比：
    // `"() => 600" > "() => 1000"` 为 `true`（第 8 位 `'6' > '1'`），
    // 结果与真实宽高完全无关，恒为 true。
    //
    // 影响面：目前**没有生产调用方** —— `AdaptiveSpec.tsx` 的
    // `useIsLandscapeViewport()` 读的是自己的 `readViewport()`（用数值 `w > h`，
    // 是对的），core 这个函数只被 re-export。所以它是一颗「导出的 API 陷阱」：
    // 将来谁直接调它就会静默恒真。正因如此更要在这里锁死。
    setViewportSource({ width: () => 600, height: () => 1000 });
    expect(isLandscapeViewport()).toBe(false);
    // 宽高相等也不算横屏（Android 的 `screenWidthDp > screenHeightDp` 是严格大于）
    setViewportSource({ width: () => 800, height: () => 800 });
    expect(isLandscapeViewport()).toBe(false);
    setViewportSource({ width: () => 1000, height: () => 600 });
    expect(isLandscapeViewport()).toBe(true);
    // 字典序恰好与数值序相反的两个值：函数比较会判成 true，数值比较才正确
    setViewportSource({ width: () => 500, height: () => 1000 });
    expect(isLandscapeViewport()).toBe(false);
  });

  it('离屏位图：未注入时 filmGrainDataUrl 返回空串（不抛错）', () => {
    resetFilmGrainCache();
    expect(filmGrainDataUrl()).toBe('');
  });

  it('离屏位图：注入后按 alpha 烘焙进 A 通道', () => {
    resetFilmGrainCache();
    const captured: { size: number; pixels: Map<string, number[]> } = {
      size: 0,
      pixels: new Map(),
    };
    const restore = withBitmapSource({
      createDataUrl(size, fill) {
        captured.size = size;
        fill((x, y, r, g, b, a) => {
          captured.pixels.set(`${x},${y}`, [r, g, b, a]);
        });
        return 'data:image/png;base64,AAAA';
      },
    });
    try {
      const url = filmGrainDataUrl(0.5);
      expect(url).toBe('data:image/png;base64,AAAA');
      expect(captured.size).toBe(64);
      // 64×64 全填
      expect(captured.pixels.size).toBe(64 * 64);
      // alpha=0.5 → 128
      const first = captured.pixels.get('0,0');
      expect(first?.[3]).toBe(128);
      // 灰度：R=G=B，值域 100..156（128 + [-28,27]）
      expect(first?.[0]).toBe(first?.[1]);
      expect(first?.[1]).toBe(first?.[2]);
      expect(first?.[0]).toBeGreaterThanOrEqual(100);
      expect(first?.[0]).toBeLessThanOrEqual(156);
    } finally {
      restore();
      resetFilmGrainCache();
    }
  });

  it('离屏位图：结果被 memoize（第二次不重算）', () => {
    resetFilmGrainCache();
    let calls = 0;
    const restore = withBitmapSource({
      createDataUrl() {
        calls += 1;
        return 'data:image/png;base64,CACHE';
      },
    });
    try {
      expect(filmGrainDataUrl()).toBe('data:image/png;base64,CACHE');
      expect(filmGrainDataUrl()).toBe('data:image/png;base64,CACHE');
      expect(calls).toBe(1);
    } finally {
      restore();
      resetFilmGrainCache();
    }
  });

  it('离屏位图：resetFilmGrainCache 后重新生成', () => {
    resetFilmGrainCache();
    let calls = 0;
    const restore = withBitmapSource({
      createDataUrl() {
        calls += 1;
        return `data:image/png;base64,V${calls}`;
      },
    });
    try {
      expect(filmGrainDataUrl()).toBe('data:image/png;base64,V1');
      resetFilmGrainCache();
      expect(filmGrainDataUrl()).toBe('data:image/png;base64,V2');
    } finally {
      restore();
      resetFilmGrainCache();
    }
  });

  it('音频：未注入时环境音返回 null（对齐 Kotlin assetOf 的 null 分支）', () => {
    setAudioSource(null);
    const audio = new AmbientAudio();
    // NONE 场景本就返回 null
    expect(audio.start('NONE')).toBeNull();
    expect(audio.isRunning()).toBe(false);
  });

  it('音频：注入后 start 走 loop/volume/play 并可 stop', () => {
    const log: string[] = [];
    const restore = withAudioSource({
      create: (_url, options) => {
        log.push(`create(loop=${options?.loop === true},volume=${options?.volume})`);
        return fakeAudio(log);
      },
    });
    try {
      const audio = new AmbientAudio();
      const handle = audio.start('RAIN');
      if (handle === null) {
        // 该场景没有资源（sceneAssetUrl 返回 null）—— 那就不该有任何 audio 调用
        expect(log).toEqual([]);
        return;
      }
      expect(log).toContain('create(loop=true,volume=0.4)');
      expect(log).toContain('loop=true');
      expect(log).toContain('volume=0.4');
      expect(log).toContain('play');
      expect(audio.isRunning()).toBe(true);
      handle.stop();
      expect(log).toContain('release');
      expect(audio.isRunning()).toBe(false);
    } finally {
      restore();
    }
  });

  it('音频：翻页音构造 MAX_STREAMS 个流，每次播放重置播放头', () => {
    const created: string[] = [];
    const log: string[] = [];
    const restore = withAudioSource({
      create(url) {
        created.push(url);
        return fakeAudio(log);
      },
    });
    try {
      const sound = new PageFlipSound();
      expect(created).toHaveLength(2);
      expect(created[0]).toBe('/audio/page_flip.m4a');
      sound.play();
      expect(log).toContain('pos=0');
      expect(log).toContain('play');
      sound.release();
      expect(log.filter((l) => l === 'release')).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('音频：未注入时翻页音池为空，play 不抛错', () => {
    setAudioSource(null);
    const sound = new PageFlipSound();
    expect(() => sound.play()).not.toThrow();
    sound.release();
  });

  it('单例访问器不抛错（未注入时）', () => {
    setAudioSource(null);
    expect(() => getAmbientAudio()).not.toThrow();
    expect(() => getPageFlipSound()).not.toThrow();
  });

  it('神回设置：走注入的键值存储，跨实例可读回', () => {
    const store = new Map<string, string>();
    const restore = withKeyValueStore({
      get: (k) => store.get(k) ?? null,
      set: (k, v) => {
        store.set(k, v);
      },
      remove: (k) => {
        store.delete(k);
      },
    });
    try {
      const first = GOD_RANKING_STYLES[1];
      expect(first).toBeDefined();
      setGodRankingStyle(first!.code);
      expect(store.get('god_moment_prefs')).toContain(first!.code);
      expect(getGodRankingStyle()).toBe(first!.code);
    } finally {
      restore();
    }
  });

  it('神回设置：存储损坏时回落默认值（guarded 语义保留）', () => {
    const restore = withKeyValueStore({
      get: () => '{not json',
      set: () => {},
      remove: () => {},
    });
    try {
      expect(getGodRankingStyle()).toBe('podium');
    } finally {
      restore();
    }
  });

  it('神回设置：存储抛异常时也回落默认值（磁盘满/隐私模式）', () => {
    const restore = withKeyValueStore({
      get: () => {
        throw new Error('QuotaExceededError');
      },
      set: () => {
        throw new Error('QuotaExceededError');
      },
      remove: () => {},
    });
    try {
      expect(() => setGodRankingStyle('vinyl')).not.toThrow();
      expect(getGodRankingStyle()).toBe('podium');
    } finally {
      restore();
    }
  });
});
