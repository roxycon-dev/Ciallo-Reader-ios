# 对拍 fixtures

这里提交固定的输入和期望输出，保证新检出的仓库也能执行 `tests/parity/`。

`chapterMerger.generated.json`、`naturalOrder.generated.json` 和 `pinKdf.generated.json` 由 `parity/android-export/run-export.mjs` 产生；该导出器按 Android 算法实现，PIN 使用 Node crypto 独立计算。当前这些文件是 Node 导出结果，不能代替实际 JVM 与 iOS 的端到端验收。

重新导出：`npm run parity:fixtures`。更新算法或夹具后，需审阅生成文件的变化并重新运行对应测试。`parity/android-export/` 也保留 JVM 导出项目。
