# 下一个会话的交接提示词

> 直接复制下面「提示词正文」整段粘到新会话即可。本文档本身不需要再被读。
>
> 生成时间：2026-11-20 · 对应提交 `f603470`（已推送 `origin/main`）

---

## 提示词正文

```
你在 Windows 工作区 `C:\Users\GuanXingRen\Downloads\novel-reader (1)` 里继续一个已进行很久的移植工程。只读权威源是 `novel-reader/`（Android 1.6.4，497 个 .kt / 2108 个顶层声明），移植目标是 `IOS/`（TypeScript + Vite + React 19 + Capacitor 8，iOS 16.0，引擎是 WebKit）。

硬约束（不可谈判）
1. `novel-reader/` 只读，一个字节都不改。
2. 不删测试、不放宽断言、不加 continue-on-error 让门禁变绿。
3. 每条结论都要有读 androidReference() 真实 Kotlin 原文的测试；只校验字面量存在的弱断言不算。
4. 不用「Web 没有对应能力」收尾；缺端口就补 interfaces.ts + web/ + ios-native/ 三层。
5. 中文回答。

口径（2026-11-20 用户已确认，别再改回去）
docs/PARITY_MATRIX.md 四态，由 scripts/parityMatrix.mjs 机器判定：
- PORTED     = gap 0 且 TEST_COVERED 里登记了读 Kotlin 原文的强断言测试
- EQUIVALENT = gap 0 且 owners 里至少一个文件被 tests/** 直接 import（脚本递归扫 import，按 @core/@ui/@platform/@ 四个别名解析）
- ADAPTED    = gap 0 但两者皆无
- MISSING    = 仍有 gap 声明
当前：PORTED 282 / EQUIVALENT 197 / ADAPTED 8 / MISSING 10，gap 46。

当前门禁基线（别再往下掉）
- npx tsc --noEmit                                → 0 error
- npx eslint src tests --max-warnings=0            → 0 problem
- npx vite build                                  → 成功（275 文件 / 31.28 MB）
- npx vitest run                                  → 377/378 文件、7477/7478 用例
- npx playwright test --project=iphone-14-pro-webkit → 18/18 全绿（WebKit，5.7 分钟）
- node scripts/parityMatrix.mjs                   → 上面那组四态数字
- npx vitest run tests/parity/exceptionsAudit.test.ts → 228 条 / 592 引用 / kotlinLocator 100.0%
- npx vitest run tests/unit/coreLayerPurity.test.ts   → src/core/** 不引用 DOM 全局
唯一红的是 tests/parity/kotlinLiterals.test.ts（7 条 offender），原因是 9 个上游新文件还没搬。

下一步（按这个顺序）
1. 补 9 个上游新文件（都是新功能，不是既有功能漂移）：
   data/MarkupBookImporter.kt(100) / data/MdxDictionary.kt(164) / data/MobiDictionary.kt(131) /
   data/ReaderDictionaryStore.kt(345) / ui/reader/ReaderDictionarySheet.kt(228) /
   ui/reader/ReaderListeningPanel.kt(394) / ui/reader/ReaderSelection.kt(280) /
   ui/reader/VerticalNovelBody.kt(405) / source/js/WebViewPageLoader.kt(169)
   每个文件的流程：读 Kotlin 原文 → 写端口 → 写读 androidReference() 的 parity 测试 →
   在 scripts/parityMatrix.mjs 的 TEST_COVERED 登记 → node scripts/parityLedger.mjs &&
   node scripts/parityMatrix.mjs → 在 docs/PARITY_EXCEPTIONS.md 追加 E2xx（带 Kotlin 行号→iOS 行号）。
2. 给 tests/parity/kotlinLiterals.test.ts 加显式不移植豁免通道：从 PARITY_EXCEPTIONS.md 的
   E219 读「明确不移植」清单（当前只有 data/EdgeVoiceProof.kt），限 ≤3 条，并在测试输出里
   打印被豁免的文件名。不要用通配符或目录级豁免。
3. JS 书源补丁基线 49 → 51：src/core/source/js/jsSourcePatches49.ts 要补 patchJm 的
   jm_api_routes 恢复段（Kotlin JsSourceRepo.kt:495）与新的 patchWnacgInit 的 originReady
   守卫（Kotlin JsSourceRepo.kt:826），然后 python scripts/sync-js-source-patches.py（脚本
   护栏目前只接受 49，要同步放开），并把 IOS_PATCH_BASELINE 改回 PATCH_VERSION = 51。

IPA 出包（已完成，不需要重做）
- 已推送 origin/main（commit f603470）。ci.yml 拓扑：gates（独立，不阻塞产物）与
  web-build → cap-sync → {ios-build, ios-archive} 并行。
- 未签名 ipa 走 artifact ciallo-ios-ipa-unsigned，零 secret；要已签名就配三个 secret
  （IOS_CERT_P12_BASE64 / IOS_CERT_PASSWORD / IOS_PROVISIONING_PROFILE_BASE64）并在
  workflow_dispatch 勾 sign_device。
- docs/IPA_SECURITY_DECLARATION.md + ios/App/App/PrivacyInfo.xcprivacy +
  tests/unit/ipaSecurityDeclaration.test.ts（18 条）三方互锁：改 plist 就必须同步改文档。
- 构建/运行手册在 docs/BUILD_AND_RUN.md；Windows 双击 IOS/run-web.bat 就能跑生产产物
  （scripts/serve-web.mjs 零依赖静态服务，会打印局域网地址，手机同 Wi-Fi 可直接开）。

已知的坑（都踩过）
- novel-reader/ 的 Kotlin 是 CRLF：跨行断言必须用 /…\r?\n\s+…/，不能写裸 \n。
- PowerShell 双引号里的 `r / `v / `n 会被当转义符吃掉注释文本。注释一律用 write 工具写。
- 行级替换要先 split(/\r?\n/) 再按原 eol 回写，否则 CRLF 文件的锚点全部不匹配。
- not.toContain(...) 会命中你自己刚写的注释（已踩 6 次）。负断言前先滤掉以 * 或 // 开头的行。
- src/core/** 不许出现 document.（coreLayerPurity 用文本匹配）。把 jsoup 的 Document 局部变量
  命名为 document 会红。
- tests/parity/ 的 include 里没有 .test.tsx，UI 测试要用 .test.ts + createElement。
- PARITY_EXCEPTIONS.md 里写 pending.json / settings.json 会被 exceptionsAudit 当成 iOS 文件路径
  判缺失，要写成 pending·json。
- 测试标题里嵌单引号会 PARSE_ERROR，用括号或中文引号。
- 最高产的三类真 bug：① 同名占位（TS 里有同名符号但字段/方法全不对，已发现 9 例）；
  ② 端口照着旧版 Kotlin 写（文件头自述行数不对，要重新数一遍）；③ 用 grep | Select-Object -First N
  截断后误判「零实现」。
- 别给 pwsh 传 run_in_background / timeoutMs 这类布尔或数字参数（会被拒）；长命令让默认超时
  把它转成后台 job，再用 job_output 收。

每轮结束把总结追加到 docs/PORT_STATUS.md：PORTED 前后数字、门禁实测表、本轮自己写错的地方。
```

---

## 这份提示词为什么这么写

- **数字全是实测的**，不是记忆里的：497 个 Kotlin 文件 / 2108 声明 / 门禁逐条结果都来自本轮实际输出。
- **四态口径单独成段**，因为它是用户明确改过的决定，下个会话最容易「好心」改回「逐行等价」。
- **下一步给到文件级 + 行级**，避免下个会话重新做一遍调研。
- **坑列表是"错误历史"的浓缩**，每一条都对应本工程真实踩过的失败，比泛泛的"注意代码风格"有用得多。
