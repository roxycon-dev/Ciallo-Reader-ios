import type { TtsEngine, TtsSpeakOptions, TtsVoice } from '@platform/interfaces';

const MOCK_VOICES: TtsVoice[] = [
  { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US' },
  { identifier: 'com.apple.voice.compact.zh-CN.Tingting', name: 'Tingting', language: 'zh-CN' },
  { identifier: 'com.apple.voice.compact.ja-JP.Kyoko', name: 'Kyoko', language: 'ja-JP' },
];

export class MockTtsEngine implements TtsEngine {
  readonly calls: Array<{ method: string; text?: string; options?: TtsSpeakOptions }> = [];
  voices: TtsVoice[] = [...MOCK_VOICES];

  async speak(text: string, options?: TtsSpeakOptions): Promise<void> {
    this.calls.push({ method: 'speak', text, ...options });
  }

  async stop(): Promise<void> {
    this.calls.push({ method: 'stop' });
  }

  async pause(): Promise<void> {
    this.calls.push({ method: 'pause' });
  }

  async resume(): Promise<void> {
    this.calls.push({ method: 'resume' });
  }

  async getVoices(): Promise<TtsVoice[]> {
    this.calls.push({ method: 'getVoices' });
    return [...this.voices];
  }
}

export function createMockTtsEngine(): MockTtsEngine {
  return new MockTtsEngine();
}
