import type { TtsEngine, TtsSpeakOptions, TtsVoice } from '@platform/interfaces';

interface TtsPluginLike {
  speak(options: { text: string } & TtsSpeakOptions): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getVoices(): Promise<{ voices?: TtsVoice[] }>;
}

const TTS_PLUGIN_ERROR = 'tts plugin not bound';

async function loadTtsPlugin(): Promise<TtsPluginLike> {
  try {
    const mod = (await import('@capacitor/core')) as unknown as {
      registerPlugin?: <T>(name: string) => T;
    };
    const register = mod.registerPlugin;
    if (!register) {
      throw new Error('missing registerPlugin export');
    }
    return register<TtsPluginLike>('Tts');
  } catch {
    throw new Error(TTS_PLUGIN_ERROR);
  }
}

export class CapacitorTtsEngine implements TtsEngine {
  private plugin: TtsPluginLike | null = null;

  private async requirePlugin(): Promise<TtsPluginLike> {
    if (this.plugin === null) {
      this.plugin = await loadTtsPlugin();
    }
    return this.plugin;
  }

  async speak(text: string, options?: TtsSpeakOptions): Promise<void> {
    const plugin = await this.requirePlugin();
    const payload: { text: string } & TtsSpeakOptions = { text };
    if (options?.rate !== undefined) {
      payload.rate = options.rate;
    }
    if (options?.pitch !== undefined) {
      payload.pitch = options.pitch;
    }
    if (options?.lang !== undefined) {
      payload.lang = options.lang;
    }
    if (options?.voice !== undefined) {
      payload.voice = options.voice;
    }
    await plugin.speak(payload);
  }

  async stop(): Promise<void> {
    const plugin = await this.requirePlugin();
    await plugin.stop();
  }

  async pause(): Promise<void> {
    const plugin = await this.requirePlugin();
    await plugin.pause();
  }

  async resume(): Promise<void> {
    const plugin = await this.requirePlugin();
    await plugin.resume();
  }

  async getVoices(): Promise<TtsVoice[]> {
    const plugin = await this.requirePlugin();
    const res = await plugin.getVoices();
    return res.voices ?? [];
  }
}

export function createCapacitorTtsEngine(): CapacitorTtsEngine {
  return new CapacitorTtsEngine();
}
