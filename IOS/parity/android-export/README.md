# Android 导出器（方案 A）

独立 JVM Gradle 工程：从 `novel-reader/` **只读复制**纯逻辑 Kotlin + 最小 shim，
产出 JSON fixtures 到 `../fixtures/`。

**规则**
- 绝不修改 `novel-reader/` 任何文件
- 副本为手写端口（PinKdf / ChapterMergerPort / NaturalOrderPort），与 Android 源算法逐行对齐
- 输出：输入→输出向量，供 iOS Vitest 对拍

## 运行

### 路径 1：Node（推荐，立即可用）

```bash
# 在 IOS/ 目录
npm run parity:fixtures
# 或
node parity/android-export/run-export.mjs
```

产出：
- `../fixtures/pinKdf.generated.json`
- `../fixtures/chapterMerger.generated.json`
- `../fixtures/naturalOrder.generated.json`

### 路径 2：JVM Gradle（需本机 JDK 17+）

```bash
cd parity/android-export
gradle run
# 或（wrapper jar 就位后）
gradlew.bat run
# 亦可在 IDE 中直接运行 parity.ExporterKt
```

> Windows 环境若只有 JDK 8，Kotlin JVM 2.0.21 / Gradle 8.10 无法执行；
> 请使用 Node 路径生成 fixtures，或安装 JDK 17+ 后再跑 `gradle run`。
> `gradle/wrapper/gradle-wrapper.properties` 已指向 `gradle-8.10-bin.zip`；
> 缺少 `gradle-wrapper.jar` 时，可用本机 Gradle 执行 `gradle wrapper` 再生成。

## 端口来源（只读）

| 本工程文件 | Android 源 |
|---|---|
| `PinKdf.kt` | `novel-reader/.../PrivacyManager.kt` (`hashPin` / `derivePin` / `newSaltHex`) |
| `ChapterMergerPort.kt` | `novel-reader/.../ChapterMerger.kt` + `Book.kt` Chapter 字段 |
| `NaturalOrderPort.kt` | `novel-reader/.../ComicParser.kt` (`naturalOrderCompare`) |
| `run-export.mjs` | 与上述 Kotlin 相同算法的 Node 实现 |

## 对拍测试

- `tests/parity/pinKdfParity.test.ts`
- `tests/parity/chapterMergerParity.test.ts`

在 `IOS/` 目录执行 `npm test`。

状态：实现完成；fixtures 由 Node 路径生成，JVM 路径代码就位待 JDK 17+ 环境验证。
