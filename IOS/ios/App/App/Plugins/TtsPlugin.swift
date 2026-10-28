import Foundation
import AVFoundation
import Capacitor

@objc(TtsPlugin)
public class TtsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TtsPlugin"
    public let jsName = "Tts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var pendingSpeakCall: CAPPluginCall?
    private var currentUtteranceId: String?
    private var utteranceIds: [ObjectIdentifier: String] = [:]
    private var requestGeneration = 0
    private let voiceQueue = DispatchQueue(label: "ciallo.speech.voices", qos: .userInitiated)

    private func identifier(of utterance: AVSpeechUtterance) -> String {
        utteranceIds[ObjectIdentifier(utterance)] ?? ""
    }

    public override func load() {
        super.load()
        synthesizer.delegate = self
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("text is required"); return }
        DispatchQueue.main.async {
            self.requestGeneration += 1
            let generation = self.requestGeneration
            self.synthesizer.stopSpeaking(at: .immediate)
            self.finishPendingSpeak(rejectMessage: nil)
            self.pendingSpeakCall = call
            self.voiceQueue.async {
                // A cold system voice database can block on XPC for a minute.
                // Resolve voices and activate audio without blocking UIKit.
                let voiceId = call.getString("voice") ?? ""
                let language = call.getString("lang") ?? ""
                let voice = !voiceId.isEmpty ? AVSpeechSynthesisVoice(identifier: voiceId)
                    : !language.isEmpty ? AVSpeechSynthesisVoice(language: language) : nil
                var preparationError: String?
                if !voiceId.isEmpty && voice == nil { preparationError = "unknown voice identifier" }
                if preparationError == nil {
                    do {
                        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                        try AVAudioSession.sharedInstance().setActive(true)
                    } catch { preparationError = error.localizedDescription }
                }
                let resolvedError = preparationError
                DispatchQueue.main.async {
                    guard generation == self.requestGeneration else { return }
                    if let message = resolvedError { self.finishPendingSpeak(rejectMessage: message); return }
                    self.performSpeak(call, voice: voice)
                }
            }
        }
    }

    private func performSpeak(_ call: CAPPluginCall, voice: AVSpeechSynthesisVoice?) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text is required")
            return
        }

        let utterance = AVSpeechUtterance(string: text)
        let rawRate = call.getDouble("rate") ?? 1.0
        let rate = rawRate.isFinite ? rawRate : 1.0
        let clampedRate = min(max(rate, 0.25), 4.0)
        utterance.rate = Float(min(max(clampedRate * 0.5, 0.0), 1.0))

        let rawPitch = call.getDouble("pitch") ?? 1.0
        let pitch = rawPitch.isFinite ? rawPitch : 1.0
        let clampedPitch = min(max(pitch, 0.25), 4.0)
        utterance.pitchMultiplier = Float(min(max(clampedPitch, 0.5), 2.0))

        utterance.voice = voice

        let utteranceId = UUID().uuidString
        currentUtteranceId = utteranceId
        utteranceIds[ObjectIdentifier(utterance)] = utteranceId
        pendingSpeakCall = call
        synthesizer.speak(utterance)
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.performStop(call) }
    }

    private func performStop(_ call: CAPPluginCall) {
        requestGeneration += 1
        synthesizer.stopSpeaking(at: .immediate)
        finishPendingSpeak(rejectMessage: nil)
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.performPause(call) }
    }

    private func performPause(_ call: CAPPluginCall) {
        if synthesizer.isSpeaking {
            synthesizer.pauseSpeaking(at: .word)
        }
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.performResume(call) }
    }

    private func performResume(_ call: CAPPluginCall) {
        if synthesizer.isPaused {
            _ = synthesizer.continueSpeaking()
        }
        call.resolve()
    }

    @objc func getVoices(_ call: CAPPluginCall) {
        voiceQueue.async { self.performGetVoices(call) }
    }

    private func performGetVoices(_ call: CAPPluginCall) {
        let voices: [[String: String]] = AVSpeechSynthesisVoice.speechVoices().map { voice in
            [
                "identifier": voice.identifier,
                "name": voice.name,
                "language": voice.language
            ]
        }
        call.resolve(["voices": voices])
    }

    private func finishPendingSpeak(rejectMessage: String?) {
        guard let pending = pendingSpeakCall else {
            return
        }
        pendingSpeakCall = nil
        currentUtteranceId = nil
        voiceQueue.async { try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
        if let message = rejectMessage {
            pending.reject(message)
        } else {
            pending.resolve()
        }
    }
}

extension TtsPlugin: AVSpeechSynthesizerDelegate {
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if identifier(of: utterance) == currentUtteranceId {
            finishPendingSpeak(rejectMessage: nil)
        }
        notifyListeners("ttsFinish", data: ["utteranceId": identifier(of: utterance)])
        utteranceIds.removeValue(forKey: ObjectIdentifier(utterance))
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        if identifier(of: utterance) == currentUtteranceId {
            finishPendingSpeak(rejectMessage: nil)
        }
        notifyListeners("ttsCancel", data: ["utteranceId": identifier(of: utterance)])
        utteranceIds.removeValue(forKey: ObjectIdentifier(utterance))
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didPause utterance: AVSpeechUtterance) {
        notifyListeners("ttsPause", data: ["utteranceId": identifier(of: utterance)])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didContinue utterance: AVSpeechUtterance) {
        notifyListeners("ttsResume", data: ["utteranceId": identifier(of: utterance)])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        notifyListeners("ttsProgress", data: [
            "utteranceId": identifier(of: utterance),
            "location": characterRange.location,
            "length": characterRange.length
        ])
    }
}
