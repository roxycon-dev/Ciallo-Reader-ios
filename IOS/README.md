# Ciallo阅读（EASYREADER）· iOS 移植工程

> 完整移植进行中。当前验收与待补功能见 [PORT_STATUS](docs/PORT_STATUS.md)；历史审计中的“已关闭”不等于当前 Android 版本已完整对齐。

基于 TypeScript + Vite + React 19 + Capacitor 8 的 iOS 移植，对应 Android 仓库 `novel-reader/`。

## 环境要求

- Node.js 22+（Capacitor 8 要求）
- Xcode 26+（Capacitor 8 要求）
- iOS Deployment Target：16.0

## 快速开始

```bash
npm install          # 安装依赖（会自动检查 Node 版本）
npm run dev          # 启动 Vite 开发服务器
npm run typecheck    # TypeScript 类型检查
npm test             # 运行 Vitest 单元测试
npm run tokens       # 从 Android 设计令牌生成 TS 常量
npm run lint         # ESLint 检查
npm run build        # 生产构建（tsc + vite build）
```

### Capacitor iOS

```bash
npm run cap:sync     # 构建并同步到 ios/ 目录
npm run cap:open     # 打开 Xcode 工程
```

### 测试

```bash
npm test             # 单元测试（vitest run）
npm run test:parity  # 对拍测试
npm run e2e          # Playwright e2e（需要构建产物）
```

## 相关文档

- [移植计划与阶段](docs/PORT_PLAN.md)
- [移植指南（已落地/踩坑）](docs/WEB_PORT_GUIDE.md)
- [差异登记表（PARITY_EXCEPTIONS）](docs/PARITY_EXCEPTIONS.md)

## 目录结构

```
IOS/
├─ public/            ← 静态资源（字体、js_safety、venera、js_extra、anilist）
├─ src/
│  ├─ ui/             ← React 组件 + 页面
│  ├─ core/           ← 纯 TS 逻辑（禁止 import DOM/Capacitor）
│  └─ platform/       ← 平台接口 + web-mock + ios-native
├─ ios/               ← Capacitor 原生壳
├─ parity/            ← 对拍 fixtures 与导出器
├─ tests/             ← unit / parity / e2e
└─ docs/              ← 移植文档
```
