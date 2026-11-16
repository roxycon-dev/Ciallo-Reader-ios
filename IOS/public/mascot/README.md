# Roxy 吉祥物素材（public/mascot/）

来源（逐字节复制，SHA256 已核对一致）：

| 本目录文件 | Android 只读源 |
|---|---|
| `mascot_idle.webp` | `novel-reader/app/src/main/res/drawable-nodpi/mascot_idle.webp` |
| `mascot_sad.webp` | `novel-reader/app/src/main/res/drawable-nodpi/mascot_sad.webp` |
| `mascot_run.webp` | `novel-reader/app/src/main/res/drawable-nodpi/mascot_run.webp` |
| `mascot_reading.webp` | `novel-reader/app/src/main/res/drawable-nodpi/mascot_reading.webp` |
| `mascot_celebrate.webp` | `novel-reader/app/src/main/res/drawable-nodpi/mascot_celebrate.webp` |

对应 Kotlin `R.drawable.mascot_*`（`ui/mascot/MascotSpriteSheet.kt` L16-24）。
Android 侧也是 WebP，本目录保持同一编码，未做转码（WKWebView 自 iOS 14 起支持 WebP）。

绑定关系与 `MascotSpriteSheet.ts` 完全一致：

- `idleDrawable` / `idle` → `mascot_idle`
- `sadDrawable` / `sad` → `mascot_sad`
- `moveDrawable` / `runDrawable` / `move` / `run` → `mascot_run`
- `readingDrawable` / `reading` → `mascot_reading`
- `happyDrawable` / `celebrateDrawable` / `bookmarkDrawable` / `celebrate` → `mascot_celebrate`

（`happy` 与 `bookmark` 是兼容别名，Kotlin L23-24 就是这么写的 —— 书签成功 = 欢呼。）