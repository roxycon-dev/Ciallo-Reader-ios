import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: path.resolve(rootDir, 'node_modules/buffer/index.js'),
      '@': path.resolve(rootDir, 'src'),
      '@core': path.resolve(rootDir, 'src/core'),
      '@platform': path.resolve(rootDir, 'src/platform'),
      '@ui': path.resolve(rootDir, 'src/ui'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    /**
     * ⚠️ 部署目标是 **iOS 16.0**（`ios/App/App/Info.plist` 的
     * `MinimumOSVersion`），iOS 16.0 的 WKWebView 就是 **Safari 16.0 引擎**。
     *
     * `target` 决定打包器降级哪些语法/特性。原来写的是 `'es2022'` —— 那只是
     * **一个 ECMAScript 语言版本号，不带任何浏览器约束**，于是「Safari 16.0
     * 不支持但属于 ES2022」的东西会原样进产物（`es2022` 的静态类块 / `.at()`
     * / `Object.hasOwn` 在 Safari 16.0 恰好都还支持，纯属侥幸；一旦有人用了
     * 更新的语法就会直接炸在真机上）。
     *
     * 改成 esbuild/oxc 的浏览器 target `'safari16'` 之后，打包器按
     * **Safari 16.0 的真实特性表**降级，多余的语法自动被改写成 ES2017 形态，
     * 产物不再依赖「语言版本恰好落在 Safari 16.0 支持范围内」这个假设。
     *
     * 详见 `docs/SAFARI16_COMPAT.md`。
     */
    target: 'safari16',
  },
});
