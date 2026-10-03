import Foundation
import AVFAudio

// MARK: - TTS 朗读（data/TtsManager.kt + TtsPlaybackService.kt 对应物）
// 段落级 startReading/pause/next/previous/stop，isPlaying / currentParagraphIndex。

@MainActor
final class TtsManager: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = TtsManager()

    @Published private(set) var isPlaying = false
    @Published private(set) var currentParagraphIndex = 0

    private let synthesizer = AVSpeechSynthesizer()
    private var paragraphs: [String] = []
    private var generation = 0
    var rate: Float = 0.5

    override private init() {
        super.init()
        synthesizer.delegate = self
    }

    func startReading(paragraphs: [String], from index: Int = 0) {
        guard !paragraphs.isEmpty else { return }
        self.paragraphs = paragraphs
        generation += 1
        currentParagraphIndex = max(0, min(index, paragraphs.count - 1))
        isPlaying = true
        speakCurrent(generation: generation)
    }

    private func speakCurrent(generation gen: Int) {
        guard gen == generation, currentParagraphIndex < paragraphs.count else { return }
        // 长段安全拆分（AVSpeechSynthesizer 单段过长会被截断）
        let text = paragraphs[currentParagraphIndex]
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        utterance.rate = rate
        utterance.postUtteranceDelay = 0.15
        utterance.prefersAssistiveTechnologySettings = true
        synthesizer.speak(utterance)
    }

    func pause() {
        synthesizer.pause(at: .immediate)
        isPlaying = false
    }

    func resume() {
        guard !paragraphs.isEmpty else { return }
        if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            isPlaying = true
        } else if !synthesizer.isSpeaking {
            isPlaying = true
            speakCurrent(generation: generation)
        }
    }

    func next() {
        stopSpeaking()
        guard currentParagraphIndex + 1 < paragraphs.count else { stop(); return }
        currentParagraphIndex += 1
        isPlaying = true
        speakCurrent(generation: generation)
    }

    func previous() {
        stopSpeaking()
        currentParagraphIndex = max(0, currentParagraphIndex - 1)
        isPlaying = true
        speakCurrent(generation: generation)
    }

    func stop() {
        generation += 1
        stopSpeaking()
        isPlaying = false
        paragraphs = []
        currentParagraphIndex = 0
    }

    private func stopSpeaking() {
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard self.isPlaying else { return }
            if self.currentParagraphIndex + 1 < self.paragraphs.count {
                self.currentParagraphIndex += 1
                self.speakCurrent(generation: self.generation)
            } else {
                self.isPlaying = false
            }
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {}
}
