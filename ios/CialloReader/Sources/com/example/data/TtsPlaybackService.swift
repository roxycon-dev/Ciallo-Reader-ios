import Foundation
import AVFAudio

// 对齐 novel-reader/app/src/main/java/com/example/data/TtsPlaybackService.kt（42 行）
//
// 安卓侧是前台 Service（startForeground + 通知栏暂停按钮 + START_NOT_STICKY）。
// iOS 侧无对应进程模型：Info.plist 已配置 UIBackgroundModes=audio，只要
// AVAudioSession 处于 .playback 且会话激活，App 退到后台朗读即可继续。
// 本协调器承担 Service 的三个职责：
//   1. 持有 TtsManager 弱引用（对应 companion object { var manager: WeakReference<TtsManager>? }）；
//   2. 记录当前 generation（对应 onStartCommand 里的 intent extra "generation"）；
//   3. 会话被系统中断（来电/其他 App 抢占）时等价于通知栏"暂停"：
//      调 owner.pauseIfGeneration(generation) 并停机。

@MainActor
final class TtsPlaybackCoordinator {
    static let shared = TtsPlaybackCoordinator()

    private var owner: Weak<TtsManager>?
    private var generation: Int64 = -1
    private var observation: (any NSObjectProtocol)?

    struct Weak<T: AnyObject> {
        weak var value: T?
        init(_ value: T?) { self.value = value }
    }

    private init() {
        // AVAudioSession.interruptionNotification ≈ 通知栏"暂停"按钮 + onDestroy
        observation = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let self,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw),
                  type == .began else { return }
            Task { @MainActor in
                self.owner?.value?.pauseIfGeneration(self.generation) // onDestroy 语义
                self.generation = -1
                self.owner = nil
            }
        }
    }

    /// onStartCommand（非 pause action）：挂接 owner 与 generation（START_NOT_STICKY 语义：仅当 owner 存活）。
    func activate(generation gen: Int64, owner manager: TtsManager) {
        self.owner = Weak(manager)
        self.generation = gen
    }

    /// 通知栏"暂停"（action == "pause"）与 stopService：generation 匹配才暂停。
    func pauseRequest(generation gen: Int64) {
        if gen == generation {
            owner?.value?.pauseIfGeneration(generation)
            deactivate(generation: gen)
        }
    }

    /// stopService(Intent)：解除挂接。
    func deactivate(generation gen: Int64) {
        if gen == generation || gen > generation {
            owner = nil
            generation = -1
        }
    }

    deinit {
        if let observation { NotificationCenter.default.removeObserver(observation) }
    }
}
