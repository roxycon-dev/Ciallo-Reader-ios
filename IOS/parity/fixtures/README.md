# 对拍 fixtures

此目录存放由 `parity/android-export/` JVM 导出器产出的 JSON 测试向量。

- 输入→输出成对出现
- iOS Vitest（`tests/parity/`）读取并断言 `src/core/` 实现一致
- 生成文件带 `.generated.json` 后缀（已 gitignore）；人工维护的期望文件直接提交

## 状态

阶段 1：目录已建，导出器待实现（方案 A 已获批准）。

## 当前已生成 fixtures

（2026-10-04 检查：`parity/fixtures/` 下暂无 `.generated.json` 文件，仅 `.gitkeep` 占位。导出器实现后此处追加清单。）
