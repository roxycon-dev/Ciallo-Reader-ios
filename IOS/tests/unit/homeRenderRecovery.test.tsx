import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAUSE_DEPTH_LIMIT,
  ENTRY_WINDOW_MS,
  HOME_RENDER_RECOVERY_NOTICE_KEY,
  RENDER_QUALITY_DEFAULT,
  RENDER_QUALITY_KEY,
  RENDER_QUALITY_MINIMAL,
  arm,
  consumeNotice,
  disarm,
  isRenderFailure,
  onUncaught,
  resetRenderRecoveryForTest,
  type RenderRecoverySettings,
} from '@core/app/homeRenderRecovery';
import { RenderRecoveryBoundary } from '@ui/shell/RenderRecoveryBoundary';
import { StartupGate } from '@ui/shell/StartupGate';
import { hideToast, Toast } from '@ui/toast';

/**
 * E108 单测 —— 逐条对齐 `HomeRenderRecovery.kt` 的行为：
 * 窗口、栈帧判定、8 层 cause、只从 HIGH/MAX 降级、notice 一次性消费、token 匹配。
 */

/* ── 内存版 SettingsRepository ───────────────────────────────────────────── */

class FakeSettings implements RenderRecoverySettings {
  readonly ints = new Map<string, number>();
  readonly booleans = new Map<string, boolean>();
  readonly writes: string[] = [];

  async getInt(key: string, defaultValue = 0): Promise<number> {
    return this.ints.get(key) ?? defaultValue;
  }

  async setInt(key: string, value: number): Promise<void> {
    this.ints.set(key, value);
    this.writes.push(`int:${key}=${value}`);
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    return this.booleans.get(key) ?? defaultValue;
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    this.booleans.set(key, value);
    this.writes.push(`bool:${key}=${String(value)}`);
  }

  async remove(key: string): Promise<void> {
    this.booleans.delete(key);
    this.ints.delete(key);
    this.writes.push(`remove:${key}`);
  }
}

/* ── 构造带指定栈帧的 Error（V8 格式） ────────────────────────────────────── */

function errorWithFrames(message: string, frames: readonly string[]): Error {
  const error = new Error(message);
  error.stack = [`Error: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join('\n');
  return error;
}

const GLASS_FRAME = 'GlassCard (src/ui/components/GlassCard.tsx:42:7)';

/** 真实 V8 栈（不走手工赋值），验证帧解析对真实格式同样成立。 */
function throwFromGlassCard(): Error {
  function GlassCard(): never {
    throw new Error('glass card blew up');
  }
  try {
    GlassCard();
  } catch (failure) {
    return failure as Error;
  }
}

/* ── 环境 ───────────────────────────────────────────────────────────────── */

beforeEach(() => {
  resetRenderRecoveryForTest();
});

afterEach(() => {
  resetRenderRecoveryForTest();
});

describe('isRenderFailure — Android isRenderFailure（Kotlin L41-61）', () => {
  it('recognises all six Kotlin frame branches in their Web form', () => {
    const perBranch: ReadonlyArray<readonly [string, string]> = [
      // 1. android.graphics.* → Canvas / WebGL
      ['android.graphics.*', 'drawImage (CanvasRenderingContext2D.getContext)'],
      // 2. androidx.compose.ui.graphics.* → 绘制上下文
      ['androidx.compose.ui.graphics.*', 'renderEffect (webgl)'],
      // 3. androidx.compose.ui.node.* + measure/layout/draw/place → 布局观察者
      ['androidx.compose.ui.node.* measure/layout', 'onResize (ResizeObserver)'],
      // 4. ui.components.GlassCard / LiquidSegmentView / LiquidSliderView / PullOutRender
      ['ui.components.GlassCard', GLASS_FRAME],
      ['ui.components.LiquidSliderView', 'LiquidSlider (src/ui/components/LiquidGlassControls.tsx:9:3)'],
      ['ui.components.PullOutRender', 'PullOut (src/ui/components/reader/TouchZoneEditor.tsx:6:2)'],
      // 5. com.kashif_e.backdrop.*
      ['com.kashif_e.backdrop.*', 'backdropFilter (src/core/glass/liquidGlass.ts:88:5)'],
      // 6. dev.liquidglass.*
      ['dev.liquidglass.*', 'LiquidGlassSurface (src/core/glass/liquidGlass.ts:41:9)'],
    ];
    for (const [label, frame] of perBranch) {
      expect(isRenderFailure(errorWithFrames(label, [frame])), label).toBe(true);
    }
    // 真实 V8 栈（函数名就叫 GlassCard）
    expect(isRenderFailure(throwFromGlassCard())).toBe(true);
  });

  it('ignores business stacks, stack-overflow RangeErrors and raw thrown values', () => {
    const business = errorWithFrames('loadLibrary failed', [
      'loadLibrary (src/ui/state/appStore.ts:704:3)',
      'bootstrapLibrary (src/ui/state/appStore.ts:690:1)',
    ]);
    expect(isRenderFailure(business)).toBe(false);
    // 消息里出现关键词不算：Kotlin 只看 stackTrace 帧，不看 message / name。
    expect(isRenderFailure(errorWithFrames('GlassCard is undefined', ['run (src/core/app/boot.ts:1:1)']))).toBe(
      false,
    );
    expect(isRenderFailure(new RangeError('Maximum call stack size exceeded'))).toBe(false);
    expect(isRenderFailure('GlassCard')).toBe(false);
    expect(isRenderFailure(null)).toBe(false);
  });

  it('walks at most 8 causes, exactly like repeat(8)', () => {
    const withDepth = (depth: number): Error => {
      let current = errorWithFrames('leaf', [GLASS_FRAME]);
      for (let level = 0; level < depth; level += 1) {
        const wrapper = new Error(`wrapper ${level}`, { cause: current });
        wrapper.stack = `Error: wrapper ${level}\n    at layer${level} (src/core/app/chain.ts:${level}:1)`;
        current = wrapper;
      }
      return current;
    };
    expect(CAUSE_DEPTH_LIMIT).toBe(8);
    expect(isRenderFailure(withDepth(7))).toBe(true);
    expect(isRenderFailure(withDepth(8))).toBe(false);
  });
});

describe('onUncaught — Kotlin onUncaught（Kotlin L23-32）', () => {
  it('downgrades to minimal and raises the notice for a GlassCard failure inside the window', async () => {
    const settings = new FakeSettings();
    settings.ints.set(RENDER_QUALITY_KEY, RENDER_QUALITY_DEFAULT);
    const now = () => 1_000;
    const token = arm({ now });
    expect(token).toBeGreaterThan(0);

    await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), { settings, now });

    expect(settings.ints.get(RENDER_QUALITY_KEY)).toBe(RENDER_QUALITY_MINIMAL);
    expect(settings.booleans.get(HOME_RENDER_RECOVERY_NOTICE_KEY)).toBe(true);

    // Kotlin L31 `activeToken = 0L`：本窗口只降一次，第二次异常不再写。
    await onUncaught(errorWithFrames('boom again', [GLASS_FRAME]), { settings, now });
    expect(settings.writes).toEqual([
      `int:${RENDER_QUALITY_KEY}=${RENDER_QUALITY_MINIMAL}`,
      `bool:${HOME_RENDER_RECOVERY_NOTICE_KEY}=true`,
    ]);
  });

  it('ignores failures outside the 20 s entry window, but accepts exactly ENTRY_WINDOW_MS', async () => {
    const startedAt = 5_000;
    const now = () => startedAt;
    const settings = new FakeSettings();

    arm({ now });
    await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), {
      settings,
      now: () => startedAt + ENTRY_WINDOW_MS + 1,
    });
    expect(settings.writes).toEqual([]);

    // Kotlin `elapsed !in 0..ENTRY_WINDOW_MS`：端点算窗口内。
    arm({ now });
    await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), {
      settings,
      now: () => startedAt + ENTRY_WINDOW_MS,
    });
    expect(settings.ints.get(RENDER_QUALITY_KEY)).toBe(RENDER_QUALITY_MINIMAL);
  });

  it('ignores a plain business Error even inside the window', async () => {
    const settings = new FakeSettings();
    const now = () => 1_000;
    arm({ now });
    const business = errorWithFrames('db locked', [
      'saveProgress (src/core/library/bookRepository.ts:120:5)',
      'flush (src/core/library/bookRepository.ts:94:3)',
    ]);
    await onUncaught(business, { settings, now });
    expect(settings.writes).toEqual([]);
  });

  it('ignores a stack-overflow RangeError even when the frames look like render frames', async () => {
    const settings = new FakeSettings();
    const now = () => 1_000;
    arm({ now });
    const overflow = new RangeError('Maximum call stack size exceeded');
    overflow.stack = [
      'RangeError: Maximum call stack size exceeded',
      '    at GlassCard (src/ui/components/GlassCard.tsx:42:7)',
      '    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:1:1)',
    ].join('\n');
    await onUncaught(overflow, { settings, now });
    expect(settings.writes).toEqual([]);
  });

  it('never downgrades twice: MINIMAL / LOW / MID already disqualify (only HIGH/MAX may fall)', async () => {
    for (const currentQuality of [RENDER_QUALITY_MINIMAL, 0, 1]) {
      resetRenderRecoveryForTest();
      const settings = new FakeSettings();
      settings.ints.set(RENDER_QUALITY_KEY, currentQuality);
      const now = () => 1_000;
      arm({ now });
      await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), { settings, now });
      expect(settings.writes, `render_quality=${currentQuality}`).toEqual([]);
      expect(settings.ints.get(RENDER_QUALITY_KEY)).toBe(currentQuality);
    }
    // HIGH(2) 与 MAX(3) 才允许降级。
    for (const currentQuality of [RENDER_QUALITY_DEFAULT, 3]) {
      resetRenderRecoveryForTest();
      const settings = new FakeSettings();
      settings.ints.set(RENDER_QUALITY_KEY, currentQuality);
      const now = () => 1_000;
      arm({ now });
      await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), { settings, now });
      expect(settings.ints.get(RENDER_QUALITY_KEY), `render_quality=${currentQuality}`).toBe(
        RENDER_QUALITY_MINIMAL,
      );
    }
  });

  it('keeps the window armed when disarm receives a stale token', async () => {
    const settings = new FakeSettings();
    const now = () => 1_000;
    const stale = arm({ now });
    const current = arm({ now });
    expect(current).toBe(stale + 1);

    // 旧入口迟到的 onDispose —— Kotlin `if (activeToken == token)` 不成立，不解除武装。
    disarm(stale);
    await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), { settings, now });
    expect(settings.ints.get(RENDER_QUALITY_KEY)).toBe(RENDER_QUALITY_MINIMAL);
  });

  it('stops recovering once the matching token is disarmed', async () => {
    const settings = new FakeSettings();
    const now = () => 1_000;
    const token = arm({ now });
    disarm(token);
    await onUncaught(errorWithFrames('boom', [GLASS_FRAME]), { settings, now });
    expect(settings.writes).toEqual([]);
  });

  it('does nothing when no settings provider is installed (core stays side-effect free)', async () => {
    const now = () => 1_000;
    arm({ now });
    await expect(onUncaught(errorWithFrames('boom', [GLASS_FRAME]), { now })).resolves.toBeUndefined();
    await expect(consumeNotice({ now })).resolves.toBe(false);
  });
});

describe('consumeNotice — Kotlin consumeNotice（Kotlin L34-39）', () => {
  it('returns true once, clears the flag and reports false afterwards', async () => {
    const settings = new FakeSettings();
    settings.booleans.set(HOME_RENDER_RECOVERY_NOTICE_KEY, true);

    await expect(consumeNotice({ settings })).resolves.toBe(true);
    await expect(consumeNotice({ settings })).resolves.toBe(false);
    expect(settings.booleans.has(HOME_RENDER_RECOVERY_NOTICE_KEY)).toBe(false);
    expect(settings.writes).toEqual([`remove:${HOME_RENDER_RECOVERY_NOTICE_KEY}`]);
  });

  it('returns false without writing when there is no flag', async () => {
    const settings = new FakeSettings();
    await expect(consumeNotice({ settings })).resolves.toBe(false);
    expect(settings.writes).toEqual([]);
  });
});

describe('RenderRecoveryBoundary — getDerivedStateFromError / componentDidCatch', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it('renders the minimal fallback and hands the failure to onUncaught', async () => {
    const thrown = errorWithFrames('glass render failed', [GLASS_FRAME]);
    const reportSpy = vi.fn<(failure: unknown) => void>();
    function ExplodingHome(): ReactNode {
      throw thrown;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      /* React 会把边界捕获的异常打进 console.error，测试里静音 */
    });
    try {
      await act(async () =>
        root.render(
          <RenderRecoveryBoundary onUncaught={reportSpy}>
            <ExplodingHome />
          </RenderRecoveryBoundary>,
        ),
      );
    } finally {
      consoleError.mockRestore();
    }

    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[0]).toBe(thrown);
    expect(host.querySelector('[role=alert]')?.textContent).toContain('主页渲染失败，已切换到极简画质');
    expect(host.querySelector('button')?.textContent).toBe('重新加载');
  });

  it('renders children untouched while nothing throws', async () => {
    const reportSpy = vi.fn<(failure: unknown) => void>();
    await act(async () =>
      root.render(
        <RenderRecoveryBoundary onUncaught={reportSpy}>
          <p>书架</p>
        </RenderRecoveryBoundary>,
      ),
    );
    expect(host.textContent).toBe('书架');
    expect(reportSpy).not.toHaveBeenCalled();
  });
});

describe('StartupGate — E108 提示端（MainActivity.kt:698-703）', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    hideToast();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    hideToast();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it('toasts the Android notice once the hydrated home is on screen', async () => {
    await act(async () =>
      root.render(
        <>
          <StartupGate initialize={async () => undefined} consumeRecoveryNotice={async () => true}>
            <p>书架</p>
          </StartupGate>
          <Toast />
        </>,
      ),
    );
    await act(async () => undefined);
    expect(host.textContent).toContain('书架');
    expect(host.textContent).toContain('上次主页显示异常，已启用极简画质。可在设置中调整画质。');
  });

  it('stays silent when there is no pending notice', async () => {
    await act(async () =>
      root.render(
        <>
          <StartupGate initialize={async () => undefined} consumeRecoveryNotice={async () => false}>
            <p>书架</p>
          </StartupGate>
          <Toast />
        </>,
      ),
    );
    await act(async () => undefined);
    expect(host.textContent).toBe('书架');
  });
});
