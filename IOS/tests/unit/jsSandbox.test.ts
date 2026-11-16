/**
 * JS 书源沙箱隔离回归测试（SECURITY_AUDIT P0-1 ~ P0-4 / P1-2 / E86，2026-10-11）。
 *
 * 覆盖四条审计点名要补的回归线，全部跑在生产沙箱体上
 * （`@platform/web/jsSandboxBody` 的 SANDBOX_BODY，经 node:vm 全新 context 传输 ——
 * 与 Blob Worker 是同一段代码，realm 隔离语义一致，见 helpers/jsSandboxTestHarness.ts）：
 *  1. P0-1  Worker 内代码摸不到主 realm 的 document / localStorage / 宿主对象；
 *  2. P0-2  `evaluate` 保留**程序完成值**语义（调用方不带 return）；
 *  3. P0-3  host 函数（registerFunction / registerAsyncFunction）可从沙箱内调用，
 *           且主线程按到达顺序串行执行（HtmlDocument parse→query 的保序前提）；
 *  4. P0-4  while(true) 被预算打断 —— 插桩路径（tick 墙钟）与看门狗路径；
 *  5. P1-2  memoryLimit 对完成值编码长度的硬上限（近似检测，见 jsSandboxBody 文件头）；
 *  6. E86   boundedRegex / boundedRegexBatch 的「入口 + 扫描结束」两点 deadline；
 *  7. Kotlin 对齐：核心 `boundedRegex` 实现与沙箱内同源实现输出逐字节一致
 *     （BOUNDED_REGEX_SANDBOX_SOURCE 的 Function.prototype.toString 装配防漂移）。
 */
import { describe, expect, it, vi } from 'vitest';
import { boundedRegex, boundedRegexBatch } from '@core/source/js/boundedRegex';
import {
  createWebJsRuntime,
  type WebJsRuntime,
} from '@platform/web/jsSourcePlatform';
import { createNodeSandboxTransport } from './helpers/jsSandboxTestHarness';

function createTestRuntime(
  overrides: { budgetMs?: number; memoryLimit?: number } = {},
): WebJsRuntime {
  return createWebJsRuntime({
    createSandbox: createNodeSandboxTransport,
    ...overrides,
  }) as WebJsRuntime;
}

describe('P0-1 — sandbox realm isolation', () => {
  it('sandbox code cannot see document / localStorage of the host realm', async () => {
    // 在宿主（jsdom）realm 里种下凭据形状的数据 —— 书源脚本必须读不到。
    localStorage.setItem('privacy_pin_hash', 'top-secret');
    (globalThis as { __cialloHostSecret?: string }).__cialloHostSecret = 'top-secret';
    try {
      const rt = createTestRuntime();
      const probed = await rt.evaluate(
        `JSON.stringify({
           doc: typeof document,
           store: typeof localStorage,
           session: typeof sessionStorage,
           dom: typeof window,
           secret: (typeof localStorage !== 'undefined' && localStorage.getItem('privacy_pin_hash')) || '',
           hostSecret: (typeof globalThis !== 'undefined' && globalThis.__cialloHostSecret) || ''
         })`,
        'probe.js',
      );
      const parsed = JSON.parse(probed ?? '{}') as Record<string, string>;
      expect(parsed.doc).toBe('undefined');
      expect(parsed.store).toBe('undefined');
      expect(parsed.session).toBe('undefined');
      expect(parsed.dom).toBe('undefined');
      expect(parsed.secret).toBe('');
      expect(parsed.hostSecret).toBe('');
      rt.dispose();
    } finally {
      localStorage.removeItem('privacy_pin_hash');
      delete (globalThis as { __cialloHostSecret?: string }).__cialloHostSecret;
    }
  });

  it('top-level declarations persist across evaluates (QuickJS global context parity)', async () => {
    const rt = createTestRuntime();
    // Kotlin quickJs.evaluate 的全局 context：source.js 里 class 声明的类，
    // 后续 INSTANTIATE / call 必须还看得见。
    await rt.evaluate('class PersistenceProbe { ping() { return 42; } }', 'a.js');
    const out = await rt.evaluate('String(new PersistenceProbe().ping())', 'b.js');
    expect(out).toBe('42');
    await rt.evaluate('let persistenceLet = "persisted";', 'c.js');
    expect(await rt.evaluate('persistenceLet', 'd.js')).toBe('persisted');
    rt.dispose();
  });
});

describe('P0-2 — program completion value (no caller-side return)', () => {
  it('evaluate returns the completion value of a program, not undefined', async () => {
    const rt = createTestRuntime();
    // 修复前：new Function 丢弃 body 完成值 → 恒 null → 引擎初始化必炸。
    expect(await rt.evaluate('JSON.stringify({ok:true})', 'v.js')).toBe('{"ok":true}');
    expect(await rt.evaluate('1 + 1', 'v.js')).toBe('2');
    expect(await rt.evaluate('"instrumented-code"', 'v.js')).toBe('instrumented-code');
    // var 声明语句的完成值是 undefined → null（Kotlin evaluate<String?> 同语义）。
    expect(await rt.evaluate('var unused = 5;', 'v.js')).toBeNull();
    rt.dispose();
  });

  it('top-level await compiles and the awaited value is the completion value', async () => {
    const rt = createTestRuntime();
    // 修复前：new Function 遇到顶层 await 编译即抛 ReferenceError（P0-3c）。
    expect(await rt.evaluate('await Promise.resolve(7)', 'v.js')).toBe('7');
    expect(
      await rt.evaluate('await (async () => JSON.stringify({done:true}))()', 'v.js'),
    ).toBe('{"done":true}');
    rt.dispose();
  });
});

describe('P0-3 — host function RPC bridge', () => {
  it('registerAsyncFunction bindings are callable from the sandbox', async () => {
    const rt = createTestRuntime();
    const seen: unknown[] = [];
    rt.registerAsyncFunction('sendMessage', async (message: unknown) => {
      seen.push(message);
      return JSON.stringify({ echo: message, from: 'host' });
    });
    // ⚠️ 不要在外面再包一层 `JSON.stringify(...)`：`sendMessage` 的返回值
    // 已经是字符串化后的 JSON（宿主侧负责序列化），再 stringify 一次会得到
    // 双层转义字符串 —— 那正是本用例最初失败的原因。
    const out = await rt.evaluate(
      `await sendMessage({ method: 'probe', n: 1 })`,
      'rpc.js',
    );
    expect(JSON.parse(out ?? '{}')).toEqual({ echo: { method: 'probe', n: 1 }, from: 'host' });
    expect(seen).toEqual([{ method: 'probe', n: 1 }]);
    rt.dispose();
  });

  it('registerFunction bindings resolve through the same bridge and host calls stay ordered', async () => {
    const rt = createTestRuntime();
    const order: string[] = [];
    rt.registerFunction('sendMessageSync', (...args: unknown[]) => {
      const message = args[0] as { step: number };
      order.push(`sync:${String(message.step)}`);
      return `ack-${String(message.step)}`;
    });
    rt.registerAsyncFunction('sendMessage', async (...args: unknown[]) => {
      const message = args[0] as { step: number };
      // 让异步桥走得比同步桥慢，验证串行分发不被乱序穿插
      await new Promise((r) => setTimeout(r, 5));
      order.push(`async:${String(message.step)}`);
      return `async-ack-${String(message.step)}`;
    });
    const out = await rt.evaluate(
      `JSON.stringify([
         await sendMessageSync({ step: 1 }),
         await sendMessage({ step: 2 }),
         await sendMessageSync({ step: 3 })
       ])`,
      'rpc.js',
    );
    expect(JSON.parse(out ?? '[]')).toEqual(['ack-1', 'async-ack-2', 'ack-3']);
    // 主线程严格按到达顺序串行执行（HtmlDocument parse→querySelector 的保序前提）
    expect(order).toEqual(['sync:1', 'async:2', 'sync:3']);
    rt.dispose();
  });
});

describe('P0-4 — budget enforcement', () => {
  it('an instrumented while(true) is broken by the wall-clock tick budget', async () => {
    const rt = createTestRuntime({ budgetMs: 50 });
    // 用与 JsSourceEngine 相同的路径：先 __cialloInstrument（instrument.js 插桩
    // 进循环体），再求值。修复前：插桩从未装载，while(true){} 永久冻结线程。
    const instrumented = await rt.evaluate('__cialloInstrument("while (true) { }")', 'i.js');
    expect(instrumented).not.toBeNull();
    expect(instrumented).toContain('__cialloTick()');
    const startedAt = Date.now();
    await expect(rt.evaluate(instrumented ?? '', 'loop.js')).rejects.toThrow(
      '书源脚本执行超过 45 秒',
    );
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(10_000); // 注入的 50ms 预算，远小于 45s
    expect(rt.guardHits()).toBeGreaterThanOrEqual(1);
    rt.dispose();
  }, 20_000);

  it('an uninstrumented busy loop is terminated by the host watchdog and the realm is reset', async () => {
    const rt = createTestRuntime({ budgetMs: 50 });
    // 无插桩的原生悬挂（如灾难性正则回溯同类的「tick 管不到」路径）
    // → 看门狗终止 + JsSandboxResetError（引擎据此复位 ready 重新初始化）。
    await expect(rt.evaluate('while (true) { }', 'loop.js')).rejects.toThrow(
      '书源脚本执行超过 45 秒',
    );
    // 看门狗宽限 1s；50ms 预算下远小于测试超时
    // 沙箱被重建后仍可求值（realm 已重置为全新状态）
    const after = await rt.evaluate('1 + 1', 'fresh.js');
    expect(after).toBe('2');
    rt.dispose();
  }, 20_000);
});

describe('P1-2 — enforced limits (approximate, see jsSandboxBody header)', () => {
  it('memoryLimit caps the encoded completion value', async () => {
    const rt = createTestRuntime({ memoryLimit: 64 });
    await expect(rt.evaluate(`'x'.repeat(128)`, 'mem.js')).rejects.toThrow(
      '书源脚本结果超过内存上限',
    );
    // 正常尺寸的结果不受影响
    expect(await rt.evaluate(`'y'.repeat(8)`, 'mem.js')).toBe('yyyyyyyy');
    rt.dispose();
  });
});

describe('E86 — bounded regex two-point deadline', () => {
  it('boundedRegex re-checks the deadline after the scan (post-scan timeout)', () => {
    // Date.now 调用序：openRegexBudget 的 nowElapsed(1) + isDeadlineExceeded(2)
    // → deadline 用第 1 次的值 +500 → exec → assertRegexBudget 读第 3 次。
    // 入口两点（1000）未超时，扫描结束后（2000）超过 500ms 预算 → 必须抛。
    const nowSpy = vi.spyOn(Date, 'now');
    let calls = 0;
    nowSpy.mockImplementation(() => {
      calls += 1;
      return calls <= 2 ? 1_000 : 2_000;
    });
    try {
      expect(() => boundedRegex(['a', 'g', 'aaa', 0])).toThrow('书源正则执行超时');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('boundedRegexBatch re-checks the deadline after each scan', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let calls = 0;
    nowSpy.mockImplementation(() => {
      calls += 1;
      return calls <= 2 ? 1_000 : 2_000;
    });
    try {
      expect(() => boundedRegexBatch(['a', 'g', 'a'.repeat(50), 0])).toThrow('书源正则执行超时');
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('sandbox assembly — core implementation ≡ sandbox implementation', () => {
  it('BOUNDED_REGEX_SANDBOX_SOURCE re-evaluates to the same outputs as the core module', async () => {
    // 防「Function.prototype.toString 装配」漂移：把装配源在新函数作用域里
    // 重建，与核心 TS 实现逐用例比对（含中文错误串与 org.json 输出形状）。
    const { BOUNDED_REGEX_SANDBOX_SOURCE } = await import('@core/source/js/boundedRegex');
    const factory = new Function(
      `${BOUNDED_REGEX_SANDBOX_SOURCE}; return { boundedRegex, boundedRegexBatch };`,
    );
    const sandboxed = factory() as {
      boundedRegex: typeof boundedRegex;
      boundedRegexBatch: typeof boundedRegexBatch;
    };

    const cases: Array<[string, string, string, number]> = [
      ['a(b)c', '', 'xxabcyy', 0],
      ['a', 'y', 'bab', 1],
      ['(\\d+)-(\\d+)', 'g', '10-20 30-40', 0],
      ['zzz', '', 'abc', 0],
      ['a', '', 'abc', 99],
    ];
    for (const [pattern, flags, input, start] of cases) {
      expect(sandboxed.boundedRegex([pattern, flags, input, start])).toBe(
        boundedRegex([pattern, flags, input, start]),
      );
      expect(sandboxed.boundedRegexBatch([pattern, flags, input, start])).toBe(
        boundedRegexBatch([pattern, flags, input, start]),
      );
    }
    // Kotlin require(cond) → "Check failed."（4096 字符 pattern 上限）
    expect(() => sandboxed.boundedRegex(['x'.repeat(4097), '', 'a', 0])).toThrow('Check failed.');
    expect(() => sandboxed.boundedRegexBatch(['x'.repeat(4097), '', 'a', 0])).toThrow('Check failed.');
    // 非法 pattern 的 SyntaxError 在两侧保持原样透传（Kotlin PatternSyntaxException 同语义）
    let coreMessage = '';
    try {
      boundedRegex(['([', '', 'a', 0]);
    } catch (e) {
      coreMessage = e instanceof Error ? e.message : String(e);
    }
    expect(() => sandboxed.boundedRegex(['([', '', 'a', 0])).toThrow(coreMessage);
  });

  it('sandbox exposes __cialloInstrument and the bounded regex natives before any eval', async () => {
    const rt = createTestRuntime();
    expect(await rt.evaluate('typeof __cialloInstrument', 'n.js')).toBe('function');
    expect(await rt.evaluate('typeof __cialloTick', 'n.js')).toBe('function');
    expect(await rt.evaluate('typeof __boundedRegex', 'n.js')).toBe('function');
    expect(await rt.evaluate('typeof __boundedRegexBatch', 'n.js')).toBe('function');
    // instrument.js 的动态代码防护已装载：globalThis.eval 被包装为「tick + 再插桩」
    expect(await rt.evaluate('String(eval).includes("instrument")', 'n.js')).toBe('true');
    // Function 构造器同样被包装（wrapConstructor 覆盖四种形态）
    expect(await rt.evaluate('Function.prototype.constructor.name !== "Function"', 'n.js')).toBe('true');
    rt.dispose();
  });
});
