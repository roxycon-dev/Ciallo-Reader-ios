import Foundation
import AVFAudio

// 对齐 novel-reader/app/src/main/java/com/example/data/TtsManager.kt（108 行）
// iOS 侧以 AVSpeechSynthesizer 替代 android.speech.tts.TextToSpeech；
// 后台朗读由 TtsPlaybackCoordinator（TtsPlaybackService.swift，UIBackgroundModes audio）承接。

@MainActor
final class TtsManager: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = TtsManager()

    private let synthesizer = AVSpeechSynthesizer()
    private var ready = false
    private var generation: Int64 = 0
    private var chunkIndex = 0
    /// (paragraph, text) 对应 Kotlin `List<Pair<Int, String>>`
    private var chunks: [(Int, String)] = []
    private var rateValue: Float = 1.0
    private var pitchValue: Float = 1.0

    @Published private(set) var isPlaying = false
    @Published private(set) var currentParagraphIndex = 0
    @Published private(set) var error: String? = nil

    override private init() {
        super.init()
        synthesizer.delegate = self
        // Kotlin：init 里 TextToSpeech(app, this) 异步初始化；AVSpeechSynthesizer 同步可用，
        // 中文语音可用性在 speak() 时由系统兜底（未安装语音会静默回退）。
        ready = AVSpeechSynthesisVoice(language: "zh-CN") != nil
        if !ready { error = "请先安装中文朗读语音" }
    }

    // MARK: 分句切块（startReading）

    /// maxSpeechInputLength（AVSpeechUtterance 无官方上限，按 Android 的 4000 取整对齐）
    private static let maxSpeechInputLength = 4000

    func startReading(content: String, speed: Float = 1, pitch: Float = 1) {
        if !ready { error = "朗读引擎尚未就绪"; return }
        pausePlayback(stopService: false)
        let max = max(Self.maxSpeechInputLength - 1, 2)
        let stripped = content.replacingOccurrences(of: "\\[IMG:[^\\]]*]", with: "", options: .regularExpression)
        var result: [(Int, String)] = []
        for (paragraph, text) in stripped.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let line = String(text)
            guard !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let pieces = (try? splitChapterText(line, limit: max)) ?? [line]
            for piece in pieces { result.append((paragraph, piece)) }
        }
        chunks = result
        chunkIndex = 0
        rateValue = speed.isFinite ? Float(min(max(speed, 0.25), 4)) : 1
        pitchValue = pitch.isFinite ? Float(min(max(pitch, 0.25), 4)) : 1
        if !chunks.isEmpty { begin() } else { pause() }
    }

    /// iOS 侧 facade 兼容旧签名（ReaderModel 使用）：外部传入已分好的段落。
    func startReading(paragraphs: [String], from index: Int = 0) {
        pausePlayback(stopService: false)
        chunks = paragraphs.enumerated().flatMap { (paragraph, text) -> [(Int, String)] in
            let pieces = (try? splitChapterText(text, limit: Self.maxSpeechInputLength - 1)) ?? [text]
            return pieces.map { (paragraph, $0) }
        }
        // 段落 → 首个 chunk 下标
        chunkIndex = chunks.firstIndex { $0.0 == max(0, min(index, paragraphs.count - 1)) } ?? 0
        rateValue = 1
        pitchValue = 1
        if !chunks.isEmpty { begin() } else { pause() }
    }

    /// begin()：AVAudioSession 激活（等价 requestAudioFocus）+ 前台服务 → TtsPlaybackCoordinator
    private func begin() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true)
        error = nil
        TtsPlaybackCoordinator.shared.activate(generation: generation, owner: self)
        isPlaying = true
        speak()
    }

    private func speak() {
        guard chunkIndex < chunks.count else { pause(); return }
        let chunk = chunks[chunkIndex]
        currentParagraphIndex = chunk.0
        let utterance = AVSpeechUtterance(string: chunk.1)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        // AVSpeechUtteranceRate：0.0(最慢)~1.0(最快)，把 0.25~4 的语速映射到系统区间中段
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate,
                             max(AVSpeechUtteranceMinimumSpeechRate,
                                 AVSpeechUtteranceDefaultSpeechRate * (rateValue - 1) / 3 + AVSpeechUtteranceDefaultSpeechRate))
        utterance.pitchMultiplier = Float(min(max(pitchValue, 0.5), 2.0))
        utterance.prefersAssistiveTechnologySettings = true
        synthesizer.speak(utterance)
    }

    func pause() {
        pausePlayback(stopService: true)
    }

    func pauseIfGeneration(_ expected: Int64) {
        if generation == expected && isPlaying { pause() }
    }

    private func pausePlayback(stopService: Bool) {
        generation += 1
        isPlaying = false
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if stopService { TtsPlaybackCoordinator.shared.deactivate(generation: generation) }
    }

    func nextParagraph() {
        if let target = chunks.firstIndex(where: { $0.0 > currentParagraphIndex }) {
            generation += 1
            chunkIndex = target
            begin()
        }
    }

    func previousParagraph() {
        let paragraph = max(currentParagraphIndex - 1, 0)
        if let target = chunks.firstIndex(where: { $0.0 == paragraph }) {
            generation += 1
            chunkIndex = target
            begin()
        }
    }

    // MARK: iOS 侧 facade 兼容旧签名（ReaderScreen 使用）

    func next() {
        // 旧 facade：按逻辑段推进；无段可进时等价 stop()
        let before = currentParagraphIndex
        nextParagraph()
        if currentParagraphIndex == before && !isPlaying { stop() }
    }

    func previous() {
        previousParagraph()
    }

    func resume() {
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            isPlaying = true
        } else if !synthesizer.isSpeaking, !chunks.isEmpty {
            begin()
        }
    }

    func stop() {
        pause()
        chunks = []
        chunkIndex = 0
        currentParagraphIndex = 0
    }

    func release() {
        pause()
        ready = false
        chunks = []
    }

    // MARK: AVSpeechSynthesizerDelegate（对应 UtteranceProgressListener）

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard self.isPlaying else { return }
            // onDone：若 id 匹配当前 generation:chunkIndex → 下一 chunk 或暂停
            self.chunkIndex += 1
            if self.chunkIndex < self.chunks.count {
                self.speak()
            } else {
                self.pause()
            }
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {}

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didError utterance: AVSpeechUtterance) {
        Task { @MainActor in
            // onError：当前 generation:chunkIndex 的请求失败 → 报错并暂停
            self.error = "朗读失败，请检查系统语音引擎"
            self.pause()
        }
    }
}
