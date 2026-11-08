import type { JsRuntime } from '@core/source/js/jsPlatform';
import { JsMutex } from '@core/source/js/jsPlatform';
import { SANDBOX_PREPARE } from '@platform/web/jsSandboxBody';

/** This runtime must only be instantiated inside the dedicated source Worker. */
export function createWorkerLocalRuntime(): JsRuntime {
  if (typeof document !== 'undefined') throw new Error('书源运行时禁止在主页面创建');
  const mutex = new JsMutex();
  const prepare = new Function(`${SANDBOX_PREPARE}; return __cialloPrepare;`)() as (code: string) => string;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => () => Promise<unknown>;
  let parserGuarded = false;
  const guardParser = (): void => {
    if (parserGuarded) return;
    const globals = globalThis as unknown as { acorn: { parse: (code: string, options: unknown) => unknown } };
    const parser = globals.acorn;
    const parse = parser.parse.bind(parser);
    Object.defineProperty(parser, 'parse', { configurable: false, writable: false, value(code: string, options: unknown) {
      const ast = parse(code, options);
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        const node = value as Record<string, unknown>;
        if (node.type === 'ImportExpression' || node.type === 'ImportDeclaration') throw new Error('书源不支持加载外部模块');
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(visit);
          else if (child && typeof child === 'object') visit(child);
        }
      };
      visit(ast);
      return ast;
    } });
    Object.defineProperty(globalThis, 'acorn', { value: parser, writable: false, configurable: false });
    parserGuarded = true;
  };
  const bind = (name: string, fn: (...args: unknown[]) => unknown): void => {
    if (Object.getOwnPropertyDescriptor(globalThis, name)?.configurable === false) return;
    Object.defineProperty(globalThis, name, { value: fn, writable: false, configurable: false });
  };
  return {
    synchronousBindings: true, memoryLimit: 32 * 1024 * 1024, maxStackSize: 512 * 1024,
    acquire: () => mutex.acquire(), gc() {}, armExecution() {},
    registerFunction: bind, registerAsyncFunction: bind,
    async evaluate(code, filename) {
      const hasParser = Object.prototype.hasOwnProperty.call(globalThis, 'acorn');
      if (hasParser) guardParser();
      const result = hasParser ? await new AsyncFunction(prepare(code))() : new Function(code)();
      if (result === null || result === undefined || typeof result === 'function') return null;
      const value = typeof result === 'object' ? JSON.stringify(result) : String(result);
      if (value.length * 2 > 32 * 1024 * 1024) throw new Error(`脚本返回数据超过内存预算：${filename}`);
      return value;
    },
  };
}
