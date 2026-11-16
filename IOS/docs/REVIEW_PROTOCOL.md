# 逐行审查规约（所有审查代理共用）

## 背景
`C:\Users\GuanXingRen\Downloads\novel-reader (1)\IOS` 是一个把 Android 原生 App
（只读源在 `C:\Users\GuanXingRen\Downloads\novel-reader (1)\novel-reader`）
**逐行移植**到 TypeScript + Vite + React 19 + Capacitor 8.5.2 的 iOS 项目。

用户的硬要求（务必满足）：
1. **逐行读 Kotlin，逐行对照 TS**。不许凭印象、不许凭记忆写库 API。
2. 界面、功能、数据格式必须和安卓**完全一模一样**。
3. 不许静默砍功能。发现任何缺失/偏差，要么**修好**，要么在
   `docs/PARITY_EXCEPTIONS.md` 登记。**二选一，不许装看不见。**
4. 交付物要是能直接用的完整品，不是半成品。

## 你的审查职责（这是审查，不是重写）
对你被分配的 Kotlin 文件：
1. **完整读完**（大文件用 read 的 offset/limit 分块读完，不要只读开头）。
2. 逐段对照对应的 TS 文件，列出**每一处**差异，分四类：
   - `BUG` — 行为不同（数字/字符串/分支/顺序/边界条件错了）
   - `MISSING` — Kotlin 有、TS 没有
   - `EXTRA` — TS 有、Kotlin 没有（可能是凭空加的功能，也可能是移植时多写）
   - `COSMETIC` — 写法不同但等价（可以不改，但要在报告里说明为什么等价）
3. 对每一处 `BUG` / `MISSING`：**当场修好**，保持 Kotlin 的数值、字符串、
   分支顺序、边界语义逐字一致。
4. 对每一处 `EXTRA`：判断它是有意的平台适配（保留，加注释说明）
   还是移植时凭空加的（**删掉**）。判断依据只能是 Android 源码。
5. 每一处跳过/保留都要在文件头的行号映射表里写清理由。

## 判定纪律
- **数字必须回到 Kotlin 原文核对**，不许凭"看起来应该是"。
- **中文字符串必须逐字照抄**（用 node 读 utf-8 核对，别信 PowerShell 控制台的乱码）。
- Kotlin `Float` 是 32 位；本项目统一用 JS `number`（f64），不要给数值加
  `Math.fround()` 收窄，也**不要**因为这个报差异（这是全项目一致的既有约定）。
- Compose → Web 的平台适配（`Modifier` → CSS、`Canvas` → SVG/canvas、
  `LazyColumn` → scroll 容器、Room `Flow` → async getter + listener、
  coroutine `Mutex` → promise 链、`Bitmap` → 注入接口、`Coil` → `<img>`）
  都**不算** `MISSING`，但你必须逐条确认适配是否**真的等价**；不等价的要登记。

## 硬规则
1. **`novel-reader/` 全程只读**，绝不能创建/修改其中任何文件。
2. 只改**分配给你的文件**。别的代理正在并行改其它目录。
   需要动别人文件时，只在「确实缺一个符号」且「一行就能补」的情况下做，
   并在报告里逐个列出。
3. `src/core/**` 禁止 import React / DOM 全局 / Capacitor（ESLint 强制）。
4. React 19 lint（改 .tsx 必守）：渲染期不读 `ref.current`；渲染期不调
   `Math.random()`/`Date.now()`（提到模块级常量或 `useState` lazy init）；
   effect 里不同步 `setState`；`.map()` 回调里不许有 Hook（提成子组件）；
   不许条件 Hook；U+3000 必须写成 `\u3000`；ref 回调当 prop 传会污染整个
   props 对象（`react-hooks/refs`）。
5. 不许用 `eslint-disable` 消音、不许 `any`、不许 `@ts-expect-error`。
6. 每个改过的文件，头部行号映射表要补上你这次的改动说明。

## 验收门禁（从 IOS 目录跑，必须全绿）
```
npx tsc --noEmit     → 0 errors（你负责的文件里必须是 0）
npx eslint src       → 0 problems
npx vitest run       → 109 文件 / 2975 用例，0 失败
npx vite build       → 成功
```
如果你的改动让某个测试失败，说明**行为变了**——修实现，不要改测试。

## 报告格式（必须包含）
1. **逐文件对照表**：Kotlin 文件（非空行数）→ TS 文件（行数）→ BUG / MISSING / EXTRA / COSMETIC 各多少。
2. **每一处 BUG/MISSING/EXTRA 的明细**：Kotlin 行号 + 原文 → TS 位置 + 现状 → 你怎么改的 → 改完的验证方式（哪个测试覆盖它；如果没有覆盖，**补一个**）。
3. **你读但判定为等价的段落**，简要说明等价理由。
4. **仍未解决 / 需要平台原生能力**的部分，以及你建议登记到
   `docs/PARITY_EXCEPTIONS.md` 的具体条目（编号接在 E57 之后）。
5. 四个门禁的**原始输出**。
6. **诚实声明**：如果某个文件你没读完、或者某个判断你不确定，明确说出来。
   不要假装全部覆盖。宁可承认也不要谎报。

## 禁止
- 不要为了"看起来完成"而放宽测试断言。
- 不要把 Kotlin 的逻辑"优化"成你觉得更好的写法。
- 不要在没有 Kotlin 依据的情况下发明新功能。