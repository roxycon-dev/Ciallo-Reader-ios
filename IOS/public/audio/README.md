# 环境音（Ambient Audio）

已完成 OGG → M4A 转换（ffmpeg AAC 128k / 44100Hz）。

## 已转换文件

| 源文件（Android assets/ambient/） | 目标 | 大小 |
|---|---|---|
| scene_rain.ogg | `scene_rain.m4a` | 731 KB |
| scene_sakura.ogg | `scene_sakura.m4a` | 964 KB |
| scene_snow.ogg | `scene_snow.m4a` | 974 KB |
| scene_ocean.ogg | `scene_ocean.m4a` | 1.4 MB |
| scene_night.ogg | `scene_night.m4a` | 975 KB |
| scene_firefly.ogg | `scene_firefly.m4a` | 974 KB |
| scene_campfire.ogg | `scene_campfire.m4a` | 975 KB |
| page_flip.ogg（res/raw/） | `page_flip.m4a` | 8 KB |

## 播放实现

- `src/core/audio/ambientAudio.ts` — 环境音播放器（循环、音量 0–1，默认 0.4），对齐 Android `ComicAmbientAudio`
- `src/core/audio/pageFlipSound.ts` — 翻页声播放器（2 流并发、音量 0.8），对齐 Android `PaperFlipPlayer` + SoundPool
- `src/core/audio/sceneTypes.ts` — 场景枚举 + 标签 + 资产映射，对齐 Android `ComicScene`

## 接入点

- ReaderPage：翻页/翻章时播放 page_flip
- ComicReaderPage：场景选择器（关闭/雨夜/落雪/樱花/萤火/海边/篝火/夏夜）+ 音效开关 + 翻页声

对应 `PARITY_EXCEPTIONS.md` 条目 **E9**（已关闭）。
