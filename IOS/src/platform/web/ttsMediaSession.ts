/**
 * E63 / E20 —— TTS 的媒体会话与音频焦点。
 *
 * 权威行为来自 Kotlin 两处（只读参考，不修改）：
 *   - `data/TtsManager.kt:29-30, 69, 94` —— 音频焦点请求 / 放弃 / 丢失即暂停
 *   - `data/TtsManager.kt:72-73`           —— 前台服务（锁屏通知）
 *
 * ## Android 的四件事与 Web 的对应
 *
 * | Android | Web / WKWebView | 说明 |
 * |---|---|---|
 * | `audio.requestAudioFocus(focus, STREAM_MUSIC, GAIN)` | `navigator.mediaSession.setActionHandler` | 语义不同：Web 无「焦点」概念，改用**可见性 + 中断事件**近似 |
 * | `AUDIOFOCUS_LOSS / LOSS_TRANSIENT → pause()` | `visibilitychange`（切后台）+ `pagehide` | 两者都暂停，比 Android 更保守 |
 * | `abandonAudioFocus` | `playbackState = 'paused'` | — |
 * | `startForeground` + `NotificationCompat` | `navigator.mediaSession.metadata / playbackState` | **WKWebView 原生支持**，会出现在 iOS 锁屏与控制中心 |
 *
 * ## 为什么「无音频焦点」不算缺口
 *
 * Android 的音频焦点是**系统级仲裁**（与其他 App 协调）。Web 侧由浏览器与
 * WKWebView 统一处理：App 退后台时 iOS 自动暂停音频，其他 App 起播时系统自动
 * duck/暂停 —— 这些**不需要 App 写代码**。本模块补的是 Android 侧**必须自己写**
 * 的那部分：锁屏控制与状态上报。
 *
 * `src/core/**` 不得触碰任何 DOM 全局（E61），故本文件在 platform 层。
 */

/** Kotlin `TtsManager.kt:20` 的 `generation` 语义的对外形态。 */
export interface TtsMediaHost {
  /** 上报播放状态（Kotlin `_isPlaying.value = …`）。 */
  setPlaying(playing: boolean): void;
  /**
   * 上报当前段信息，供锁屏界面显示。
   * Kotlin 通过 `NotificationCompat.setContentTitle/SubText` 实现。
   */
  setMetadata(info: TtsMediaMetadata | null): void;
  /** 注册锁屏控制回调（对应 Android 的 `MediaSession.Callback`）。 */
  setHandlers(handlers: TtsMediaHandlers): void;
}

export interface TtsMediaMetadata {
  /** Kotlin `NotificationCompat.setContentTitle` —— 书名。 */
  readonly title: string;
  /** `setContentText` —— 当前段落的文本预览。 */
  readonly artist: string;
  /** 章节标题（Android 侧塞在 contentTitle 的副标题）。 */
  readonly album: string;
}

export interface TtsMediaHandlers {
  readonly onPlay?: () => void;
  readonly onPause?: () => void;
  readonly onStop?: () => void;
  readonly onNext?: () => void;
  readonly onPrevious?: () => void;
  /** 锁屏进度条拖动 —— Kotlin `MediaSession.seekTo`。 */
  readonly onSeek?: (positionMs: number) => void;
}

/** 无 mediaSession / 无 DOM 时的空实现（测试宿主与非浏览器环境）。 */
function inertMediaHost(): TtsMediaHost {
  return {
    setPlaying: () => undefined,
    setMetadata: () => undefined,
    setHandlers: () => undefined,
  };
}

/**
 * 媒体会话 + 后台暂停的组合宿主。
 *
 * @param onBackgroundPause 被切到后台 / 页面隐藏时回调 ——
 *        对齐 Kotlin `AUDIOFOCUS_LOSS_TRANSIENT → handler.post { pause() }`
 */
export function createTtsMediaHost(onBackgroundPause: () => void): TtsMediaHost {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return inertMediaHost();
  }
  const win = window;
  const session = navigator.mediaSession;
  const MediaMetadataCtor = win.MediaMetadata;

  // ── 后台暂停：等价 Android 的音频焦点丢失处理 ──
  const onVisibilityChange = (): void => {
    if (win.document.visibilityState === 'hidden') onBackgroundPause();
  };
  win.document.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('pagehide', onBackgroundPause);

  return {
    setPlaying(playing: boolean): void {
      if (session === undefined) return;
      // Kotlin 暂停时 `abandonAudioFocus`；Web 侧对应把状态落回 paused，
      // 锁屏界面的播放按钮随之变为「播放」。
      session.playbackState = playing ? 'playing' : 'paused';
    },

    setMetadata(info: TtsMediaMetadata | null): void {
      if (session === undefined) return;
      if (info === null) {
        session.metadata = null;
        return;
      }
      if (MediaMetadataCtor === undefined) return;
      session.metadata = new MediaMetadataCtor({
        title: info.title,
        artist: info.artist,
        album: info.album,
      });
    },

    setHandlers(handlers: TtsMediaHandlers): void {
      if (session === undefined) return;
      // Android `MediaSession.Callback` 的对应集合。
      const bind = (action: MediaSessionAction, fn: (() => void) | undefined): void => {
        session.setActionHandler(action, fn === undefined ? null : () => fn());
      };
      bind('play', handlers.onPlay);
      bind('pause', handlers.onPause);
      bind('stop', handlers.onStop);
      bind('nexttrack', handlers.onNext);
      bind('previoustrack', handlers.onPrevious);
      if (handlers.onSeek === undefined) {
        session.setActionHandler('seekto', null);
      } else {
        session.setActionHandler('seekto', (details) => {
          handlers.onSeek?.(Number((details as { seekTime?: number }).seekTime ?? 0));
        });
      }
    },
  };
}

/**
 * 解锁 WebAudio —— iOS 要求页面先有用户手势内的音频活动才允许播放。
 *
 * Kotlin 侧不需要这一步（`TextToSpeech.speak` 由系统服务执行），但 WKWebView 里
 * 若 TTS 引擎走 WebAudio 输出，就需要先起播一次拿到 iOS 音频会话。
 * iOS 上 TTS 实际走系统语音合成（AVSpeechSynthesizer，见
 * `platform/ios-native/ttsPlugin.ts`），**不需要**本函数；
 * 保留它是为了 Web 实现与测试宿主下的 WebAudio 输出路径可用。
 */
export function primeAudioContext(): void {
  const w = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (Ctor === undefined) return;
  let ctx: AudioContextLike;
  try {
    ctx = new Ctor();
  } catch {
    return;
  }
  // 立刻 resume 再 close：只为拿到 iOS 音频会话的激活，不产生可听输出。
  void ctx
    .resume()
    .catch(() => undefined)
    .then(() => ctx.close().catch(() => undefined));
}

interface AudioContextLike {
  resume(): Promise<void>;
  close(): Promise<void>;
}
