import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsVoice } from '@platform/interfaces';

const speak = vi.fn(async (_options: { text: string; rate?: number; pitch?: number; lang?: string; voice?: string }) => {});
const stop = vi.fn(async () => {});
const pause = vi.fn(async () => {});
const resume = vi.fn(async () => {});
const getVoices = vi.fn(async () => ({
  voices: [
    { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US' },
    { identifier: 'com.apple.voice.compact.zh-CN.Tingting', name: 'Tingting', language: 'zh-CN' },
  ] as TtsVoice[],
}));

const mockPlugin = { speak, stop, pause, resume, getVoices };

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn((name: string) => {
    if (name !== 'Tts') {
      throw new Error(`unexpected plugin name: ${name}`);
    }
    return mockPlugin;
  }),
}));

import { CapacitorTtsEngine, createCapacitorTtsEngine } from '@platform/ios-native/ttsPlugin';
import { MockTtsEngine, createMockTtsEngine } from '@platform/web-mock/mockTts';
import { createIosNativePlatform } from '@platform/ios-native';

describe('ttsPlugin', () => {
  beforeEach(() => {
    speak.mockClear();
    stop.mockClear();
    pause.mockClear();
    resume.mockClear();
    getVoices.mockClear();
  });

  it('createCapacitorTtsEngine returns a CapacitorTtsEngine', () => {
    const engine = createCapacitorTtsEngine();
    expect(engine).toBeInstanceOf(CapacitorTtsEngine);
  });

  it('speak forwards text and options to the native plugin', async () => {
    const engine = createCapacitorTtsEngine();
    await engine.speak('你好世界', { rate: 1.2, pitch: 0.9, lang: 'zh-CN', voice: 'voice-id' });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith({
      text: '你好世界',
      rate: 1.2,
      pitch: 0.9,
      lang: 'zh-CN',
      voice: 'voice-id',
    });
  });

  it('speak omits undefined optional fields', async () => {
    const engine = createCapacitorTtsEngine();
    await engine.speak('hello');
    expect(speak).toHaveBeenCalledWith({ text: 'hello' });
  });

  it('stop/pause/resume/getVoices delegate to the plugin', async () => {
    const engine = createCapacitorTtsEngine();
    await engine.stop();
    await engine.pause();
    await engine.resume();
    const voices = await engine.getVoices();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(getVoices).toHaveBeenCalledTimes(1);
    expect(voices).toEqual([
      { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US' },
      { identifier: 'com.apple.voice.compact.zh-CN.Tingting', name: 'Tingting', language: 'zh-CN' },
    ]);
  });

  it('throws tts plugin not bound when registerPlugin is unavailable', async () => {
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({}));
    const mod = await import('@platform/ios-native/ttsPlugin');
    const engine = new mod.CapacitorTtsEngine();
    await expect(engine.speak('x')).rejects.toThrow('tts plugin not bound');
    vi.doUnmock('@capacitor/core');
    vi.resetModules();
  });

  it('ios-native platform factory exposes the Capacitor TTS engine', () => {
    const platform = createIosNativePlatform();
    expect(platform.tts).toBeInstanceOf(CapacitorTtsEngine);
  });

  it('mock TTS engine records calls and returns voices', async () => {
    const mock = createMockTtsEngine();
    await mock.speak('测试', { rate: 1, lang: 'zh-CN' });
    await mock.stop();
    await mock.pause();
    await mock.resume();
    const voices = await mock.getVoices();
    expect(mock.calls.map((c) => c.method)).toEqual(['speak', 'stop', 'pause', 'resume', 'getVoices']);
    expect(mock.calls[0]?.text).toBe('测试');
    expect(voices.length).toBeGreaterThan(0);
    expect(mock).toBeInstanceOf(MockTtsEngine);
  });
});
