import { defineConfig } from 'vitest/config';
import path from 'node:path';
import react from '@vitejs/plugin-react';

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@core': path.resolve(rootDir, 'src/core'),
      '@platform': path.resolve(rootDir, 'src/platform'),
      '@ui': path.resolve(rootDir, 'src/ui'),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/parity/**/*.test.ts',
      'tests/port/**/*.test.ts',
      'tests/port/**/*.test.tsx',
    ],

    // 门禁超时预算。
    //
    // Vitest 默认 5000ms。本套件里有若干**重数据测试**，单跑都在 1.5s 内通过
    // （实测：anilistSeeding 1.57s、importSafetyAudit 1.57s），但它们会与同批
    // 其余 11 个 jsdom 文件并发争 CPU/内存，饥饿后超过 5s 默认值被误判为失败。
    // 被测代码本身无问题（`readImportBytes(200KB)` 计算 0.4ms、
    // `parseAniListTsvGzip(94252 行)` 455ms —— 详见 .tmp 探针记录）。
    //
    // 因此把超时提到 20s：既能吸收并发饥饿，又远低于「真正的死循环」量级
    // （无限渲染循环会挂满整个预算才失败，仍能被稳定捕获）。
    testTimeout: 20_000,
    hookTimeout: 20_000,

    // 并发上限。默认按 CPU 数派生（实测机器 10 核），12 个 jsdom 环境同时
    // 常驻会触发内存压力与 transform 争用；限到 4 档后批次耗时更稳。
    maxWorkers: 4,
    // 显式声明使用 forks：jsdom + 大量 `await import()` 的用例在 threads 下
    // 有跨线程时序抖动，forks 隔离更彻底。
    pool: 'forks',
  },
});
