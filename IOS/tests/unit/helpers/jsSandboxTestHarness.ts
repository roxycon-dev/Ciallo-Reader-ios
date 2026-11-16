/**
 * 测试专用的沙箱传输：把生产沙箱体（`@platform/web/jsSandboxBody` 的
 * `SANDBOX_BODY`，与 Blob Worker **完全同一段代码**）跑在
 * **worker_threads 子线程的全新 `node:vm` context** 里。
 *
 * 为什么必须是子线程（2026-10-11 修正）：SECURITY_AUDIT P0-4 的看门狗回归
 * （未插桩 `while (true) {}` 被终止）要求宿主能**抢占**一个挂起的沙箱。
 * 初版把 vm context 跑在测试主线程上 —— `while (true) {}` 同步阻塞整个事件
 * 循环，主线程的看门狗 `setTimeout` 永远轮不到触发，进程整体挂死。
 * 生产 Blob Worker 是独立线程，`terminate()` 真实有效；worker_threads 提供同款
 * 抢占语义。`vm.createContext` 依旧提供全新全局（无 DOM、无宿主 realm 对象），
 * 隔离语义与 Worker realm 一致：沙箱内代码摸不到主线程的
 * `document` / `localStorage`。消息协议与生产 Worker 逐字段一致，
 * 因此这套传输也顺带回归了 RPC 桥本身。
 */
import { Worker } from 'node:worker_threads';
import { SANDBOX_BODY } from '@platform/web/jsSandboxBody';
import type {
  JsSandboxTransport,
  SandboxRequest,
  SandboxResponse,
} from '@platform/web/jsSourcePlatform';

export function createNodeSandboxTransport(): JsSandboxTransport | null {
  // 子线程引导脚本：self 垫片 + vm 全新 context + 消息桥。
  // SANDBOX_BODY 以 JSON 字符串字面量注入（其中含模板串与反引号，绝不能直接内插）。
  const boot = `
    const vm = require('node:vm');
    const { parentPort } = require('node:worker_threads');
    const SANDBOX_BODY = ${JSON.stringify(SANDBOX_BODY)};
    const self = {
      // sandbox → host（生产 Worker 里是结构化克隆；worker_threads 同为克隆传递）
      postMessage: (message) => { parentPort.postMessage(message); },
      // host → sandbox 的入口；SANDBOX_BODY 顶层会给它赋值 onmessage
      onmessage: null,
    };
    const context = vm.createContext({
      self,
      console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    });
    vm.runInContext(SANDBOX_BODY, context, { filename: 'js-sandbox-body.js' });
    parentPort.on('message', (message) => {
      if (self.onmessage !== null) self.onmessage({ data: message });
    });
  `;
  let worker: Worker;
  try {
    worker = new Worker(boot, { eval: true });
  } catch {
    return null;
  }
  let inbound: ((message: SandboxResponse) => void) | null = null;
  let errorOut: ((message: string) => void) | null = null;
  worker.on('message', (message: SandboxResponse): void => {
    if (inbound !== null) inbound(message);
  });
  worker.on('error', (err: Error): void => {
    if (errorOut !== null) errorOut(err.message || 'JS 沙箱发生未捕获错误');
  });
  return {
    postMessage: (message: SandboxRequest): void => {
      // 启动完成前投递的消息由 worker_threads 缓冲，无需「未就绪」分支。
      worker.postMessage(message);
    },
    setMessageHandler: (handler) => {
      inbound = handler;
    },
    setErrorHandler: (handler) => {
      errorOut = handler;
    },
    terminate: () => {
      void worker.terminate();
    },
  };
}
