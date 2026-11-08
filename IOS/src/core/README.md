# core/

纯 TS 算法层：从 Android Kotlin 权威移植，配 Vitest 对拍。

- 禁止 import react / DOM / Capacitor（ESLint `no-restricted-imports`）
- 每个模块对应 Android 源文件，见 `docs/PORT_PLAN.md` 第 2.7 节
- 对拍向量来自 `parity/fixtures/`（JVM 导出器产出）

## 已移植

| 模块 | Android 源 | 状态 |
|------|-----------|------|
| `privacy/pinKdf.ts` | `data/PrivacyManager.kt` | 逻辑已移植；向量对拍待 fixtures |
| `db/schemaV12.ts` | `schemas/.../12.json` | 表/索引/SQL 生成已落；DB 执行层待 platform |
